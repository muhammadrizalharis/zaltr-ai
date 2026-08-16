/**
 * Baca folder/berkas Google Drive PUBLIK ("Anyone with the link") lewat
 * Drive API v3 + API key (ZALTR_GOOGLE_API_KEY) — TANPA OAuth.
 *
 * Dipakai route chat saat pengguna menempel link Drive: server menyusun
 * pohon folder (nama berkas saja, murah) lalu MEMBUKA berkas yang relevan
 * dengan pertanyaan secara on-demand, dan menyuntikkannya ke konteks model.
 *
 * Keamanan: host di-hardcode ke googleapis.com dan ID divalidasi regex
 * ([\w-]+), jadi tidak ada risiko SSRF. Hanya operasi baca.
 */

const API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

const apiKey = () => (process.env.ZALTR_GOOGLE_API_KEY ?? "").trim();

export function driveConfigured(): boolean {
  return apiKey().length > 0;
}

export type DriveRef = { kind: "folder" | "file"; id: string };

export type DriveNode = {
  id: string;
  name: string;
  mimeType: string;
  /** Path relatif dari folder akar (mis. "notebook/preprocessing.ipynb"). */
  path: string;
  size?: number;
};

interface DriveFileRes {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}
interface DriveListRes {
  files?: DriveFileRes[];
  nextPageToken?: string;
}

/** Temukan semua link Drive (folder/berkas) di sebuah teks. */
export function parseDriveLinks(text: string): DriveRef[] {
  const refs: DriveRef[] = [];
  const seen = new Set<string>();
  const add = (kind: DriveRef["kind"], id: string) => {
    const k = `${kind}:${id}`;
    if (!seen.has(k)) {
      seen.add(k);
      refs.push({ kind, id });
    }
  };
  for (const m of text.matchAll(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/g)) {
    add("folder", m[1]);
  }
  for (const m of text.matchAll(/drive\.google\.com\/file\/d\/([\w-]+)/g)) add("file", m[1]);
  for (const m of text.matchAll(/drive\.google\.com\/open\?id=([\w-]+)/g)) add("file", m[1]);
  for (const m of text.matchAll(
    /docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/([\w-]+)/g,
  )) {
    add("file", m[1]);
  }
  return refs;
}

async function driveFetch(
  path: string,
  params: Record<string, string>,
  init?: { headers?: Record<string, string>; timeoutMs?: number },
): Promise<Response> {
  const key = apiKey();
  if (!key) throw new Error("ZALTR_GOOGLE_API_KEY belum diset");
  const qs = new URLSearchParams({ ...params, key });
  const res = await fetch(`${API}${path}?${qs}`, {
    signal: AbortSignal.timeout(init?.timeoutMs ?? 20_000),
    cache: "no-store",
    headers: init?.headers,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${body.slice(0, 160)}`);
  }
  return res;
}

/** Metadata satu berkas/folder. */
export async function driveMeta(id: string): Promise<DriveNode> {
  const res = await driveFetch(`/files/${id}`, {
    fields: "id,name,mimeType,size",
    supportsAllDrives: "true",
  });
  const j = (await res.json()) as DriveFileRes;
  return {
    id: j.id,
    name: j.name,
    mimeType: j.mimeType,
    path: j.name,
    size: j.size ? Number(j.size) : undefined,
  };
}

/**
 * Susuri folder secara rekursif -> daftar BERKAS (bukan folder) beserta path.
 * Dibatasi agar aman: maks `maxFiles` berkas & kedalaman `maxDepth`.
 */
export async function listFolderTree(
  folderId: string,
  opts: { maxFiles?: number; maxDepth?: number } = {},
): Promise<{ root: string; files: DriveNode[]; truncated: boolean }> {
  const maxFiles = opts.maxFiles ?? 300;
  const maxDepth = opts.maxDepth ?? 6;
  const root = await driveMeta(folderId)
    .then((m) => m.name)
    .catch(() => "folder");
  const files: DriveNode[] = [];
  let truncated = false;
  const queue: Array<{ id: string; path: string; depth: number }> = [
    { id: folderId, path: "", depth: 0 },
  ];
  while (queue.length) {
    if (files.length >= maxFiles) {
      truncated = true;
      break;
    }
    const cur = queue.shift()!;
    if (cur.depth > maxDepth) {
      truncated = true;
      continue;
    }
    let pageToken: string | undefined;
    do {
      const res = await driveFetch("/files", {
        q: `'${cur.id}' in parents and trashed=false`,
        fields: "nextPageToken,files(id,name,mimeType,size)",
        pageSize: "1000",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        ...(pageToken ? { pageToken } : {}),
      });
      const j = (await res.json()) as DriveListRes;
      for (const f of j.files ?? []) {
        const p = cur.path ? `${cur.path}/${f.name}` : f.name;
        if (f.mimeType === FOLDER_MIME) {
          queue.push({ id: f.id, path: p, depth: cur.depth + 1 });
        } else if (files.length < maxFiles) {
          files.push({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            path: p,
            size: f.size ? Number(f.size) : undefined,
          });
        } else {
          truncated = true;
        }
      }
      pageToken = j.nextPageToken;
    } while (pageToken && files.length < maxFiles);
  }
  return { root, files, truncated };
}

const GOOGLE_EXPORT: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "text/plain", ext: "txt" },
  "application/vnd.google-apps.spreadsheet": { mime: "text/csv", ext: "csv" },
  "application/vnd.google-apps.presentation": { mime: "text/plain", ext: "txt" },
};

/** Ceiling mutlak agar unduhan tak pernah membanjiri RAM container. */
const ABS_MAX_BYTES = 64 * 1024 * 1024;

/** Baca body respons TERBATAS: berhenti setelah `maxBytes` walau server abaikan Range. */
async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const cap = Math.min(maxBytes, ABS_MAX_BYTES);
  const reader = res.body?.getReader();
  if (!reader) return Buffer.from(await res.arrayBuffer()).subarray(0, cap);
  const chunks: Buffer[] = [];
  let total = 0;
  while (total < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, cap);
}

/**
 * Unduh isi berkas Drive sebagai Buffer. Google-native (Docs/Sheets/Slides)
 * diekspor ke format teks/csv. Bila `maxBytes` diberikan dan berkas lebih besar,
 * hanya bagian AWAL yang diunduh (Range) -> aman untuk berkas GB (partial=true).
 */
export async function fetchDriveFile(
  node: DriveNode,
  maxBytes?: number,
): Promise<{ buf: Buffer; name: string; partial: boolean }> {
  let name = node.name;
  const g = GOOGLE_EXPORT[node.mimeType];
  if (g) {
    const res = await driveFetch(`/files/${node.id}/export`, { mimeType: g.mime }, { timeoutMs: 60_000 });
    if (!/\.\w+$/.test(name)) name = `${name}.${g.ext}`;
    return { buf: await readLimited(res, maxBytes ?? ABS_MAX_BYTES), name, partial: false };
  }
  const useRange = !!(maxBytes && node.size && node.size > maxBytes);
  const res = await driveFetch(
    `/files/${node.id}`,
    { alt: "media", supportsAllDrives: "true" },
    {
      headers: useRange ? { Range: `bytes=0-${maxBytes! - 1}` } : undefined,
      timeoutMs: 60_000,
    },
  );
  return { buf: await readLimited(res, maxBytes ?? ABS_MAX_BYTES), name, partial: useRange };
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Format pohon folder menjadi blok konteks untuk prompt model. */
export function formatTree(root: string, files: DriveNode[], truncated: boolean): string {
  const lines = files
    .slice(0, 200)
    .map((f) => `- ${f.path}${f.size ? ` (${humanSize(f.size)})` : ""}`)
    .join("\n");
  return (
    `=== Struktur folder Google Drive "${root}" (${files.length} berkas` +
    `${truncated ? "+, dipangkas" : ""}) ===\n${lines}\n=== Akhir struktur folder ===\n` +
    `Berkas di atas BELUM tentu semuanya dibuka. Bila pengguna menyebut berkas yang ` +
    `isinya belum kamu terima, sebutkan berkas yang tersedia di daftar ini atau minta ` +
    `pengguna memperjelas berkas mana yang dimaksud.`
  );
}

/** Skor relevansi berkas terhadap kata kunci pertanyaan (makin tinggi makin relevan). */
export function scoreFile(node: DriveNode, queryWords: string[]): number {
  const hay = node.path.toLowerCase();
  let s = 0;
  for (const w of queryWords) if (w.length >= 3 && hay.includes(w)) s += 3;
  const ext = (node.name.split(".").pop() ?? "").toLowerCase();
  if (["ipynb", "py", "md", "txt", "csv", "tsv", "json", "sql", "r"].includes(ext)) s += 1;
  return s;
}
