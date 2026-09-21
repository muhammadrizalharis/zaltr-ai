/**
 * Agent multi-langkah (ala ChatGPT tools / ReAct): model MEMILIH memakai alat
 * (web / kode) beruntun sampai cukup, lalu menjawab. Model-agnostik (tanpa
 * native tool-calling): pakai protokol teks "AKSI:" + "OBSERVASI:".
 *
 * Terisolasi di balik flag `agent` di /api/chat — chat biasa tidak terpengaruh.
 */

import { randomUUID } from "node:crypto";
import { dispatch } from "@/server/providers";
import type { HistoryItem } from "@/server/providers";
import { webSearch, formatSearchContext } from "@/server/search";
import { retrieve, formatKnowledge } from "@/server/knowledge";
import {
  parseDriveLinks,
  driveConfigured,
  listFolderTree,
  fetchDriveFile,
  driveMeta,
  formatTree,
} from "@/server/drive";
import { extractText, fileExt, IMAGE_EXT, isBinarySkip, needsFullDownload } from "@/server/extract";
import { runInWorkspace, writeWorkspaceFile, readWorkspaceFile, listWorkspace, TEXT_WRITE_EXT } from "@/server/workspace";
import { unfenceCode } from "@/server/intent";

const TOOL_INSTRUCTIONS =
  "Kamu AGEN calyzr.ai dengan WORKSPACE terisolasi (Linux, Python 3.12, tanpa internet). " +
  "Lampiran pengguna tersedia di folder input/ (nama asli). Berkas yang kamu buat di workspace " +
  "otomatis tersimpan & bisa diunduh pengguna. Pustaka tersedia: python-docx, openpyxl, python-pptx, " +
  "pypdf, reportlab, fpdf2, Pillow, pandas, numpy, matplotlib, sympy, markdown.\n" +
  "Untuk bertindak, jawab HANYA dengan SATU aksi (tanpa teks lain), format:\n" +
  "AKSI: shell <perintah sh>              (mkdir, ls, cat, mv, cp, sed, dll — di workspace)\n" +
  "AKSI: kode <python>                    (boleh multi-baris; simpan berkas hasil ke workspace)\n" +
  "AKSI: tulis <path>\\n<isi berkas>        (tulis/timpa berkas teks: .md .txt .py .csv .html .json)\n" +
  "AKSI: baca <path>                      (baca isi berkas workspace atau input/<nama> — pdf/docx/xlsx ok)\n" +
  "AKSI: daftar                           (lihat semua berkas workspace)\n" +
  "AKSI: web <kata kunci>                 (cari web)\n" +
  "AKSI: catatan <kata kunci>             (cari knowledge base pengguna)\n" +
  "AKSI: drive <link>                     (baca Google Drive publik)\n" +
  "Aturan: (1) Untuk membuat Word/PDF/Excel/PPT pakai AKSI: kode dgn pustaka di atas dan simpan ke " +
  "nama berkas yang jelas (mis. laporan.docx). (2) Untuk MENGEDIT dokumen pengguna: baca dari input/, " +
  "ubah, simpan sebagai berkas baru. (3) Bila hasil OBSERVASI error, perbaiki & coba lagi. " +
  "(4) Setelah selesai, tulis JAWABAN final untuk pengguna (TANPA awalan AKSI): ringkas apa yang " +
  "dilakukan; JANGAN mengarang isi berkas — berkas hasil akan ditautkan otomatis di bawah jawabanmu. " +
  "(5) Setiap permintaan BARU wajib dikerjakan ulang dengan AKSI nyata — JANGAN menyalin jawaban/tautan " +
  "dari giliran sebelumnya, dan JANGAN mengklaim berkas sudah dibuat bila belum ada OBSERVASI yang membuktikannya.";

async function callModel(
  modelId: string,
  history: HistoryItem[],
  conversationId: string,
  signal: AbortSignal,
): Promise<string> {
  let out = "";
  for await (const part of dispatch(modelId, { history, conversationId, signal })) {
    if (part.kind === "text") out += part.text;
    else out += `\n![${part.alt}](${part.url})\n`;
  }
  return out.trim();
}

const MAX_OBS = 6000;

/** Bersihkan fence ```lang ... ``` bila model membungkus kode/perintah. */
const unfence = unfenceCode;

function fmtRun(r: { stdout: string; stderr: string; exitCode: number; outputs: Array<{ path: string; size: number }> }): string {
  const parts: string[] = [];
  if (r.stdout.trim()) parts.push(r.stdout.trim());
  if (r.stderr.trim()) parts.push(`[stderr] ${r.stderr.trim()}`);
  parts.push(`[exit ${r.exitCode}]`);
  if (r.outputs.length) parts.push(`[berkas dihasilkan/berubah: ${r.outputs.map((o) => `${o.path} (${o.size} B)`).join(", ")}]`);
  const s = parts.join("\n");
  return s.length > MAX_OBS ? s.slice(0, MAX_OBS) + "\n…(dipotong)" : s;
}

/** Baca folder/berkas Google Drive publik -> teks ringkas untuk observasi agen. */
async function readDrive(link: string): Promise<string> {
  if (!driveConfigured()) return "(baca Drive belum aktif)";
  const refs = parseDriveLinks(link);
  if (refs.length === 0) return "(bukan link Google Drive yang valid)";
  const parts: string[] = [];
  const ref = refs[0];
  try {
    if (ref.kind === "folder") {
      const { root, files, truncated } = await listFolderTree(ref.id, { maxFiles: 200 });
      parts.push(formatTree(root, files, truncated));
      let read = 0;
      for (const f of files) {
        if (read >= 3) break;
        if (isBinarySkip(f.name) || IMAGE_EXT.has(fileExt(f.name)) || needsFullDownload(f.name)) continue;
        try {
          const { buf, name, partial } = await fetchDriveFile(f, 2 * 1024 * 1024);
          const text = await extractText(buf, name, 8_000, { partial, sourceBytes: f.size });
          if (text) {
            parts.push(`=== ${f.path} ===\n${text}`);
            read++;
          }
        } catch {
          /* lewati berkas gagal */
        }
      }
    } else {
      const meta = await driveMeta(ref.id);
      const { buf, name, partial } = await fetchDriveFile(meta, 4 * 1024 * 1024);
      const text = await extractText(buf, name, 12_000, { partial, sourceBytes: meta.size });
      parts.push(text ? `=== ${name} ===\n${text}` : "(berkas tak terbaca sebagai teks)");
    }
  } catch (e) {
    return `(gagal baca Drive: ${(e as Error).message.slice(0, 120)})`;
  }
  return parts.join("\n\n").slice(0, 12_000) || "(kosong)";
}

export type AgentChunk = { kind: "progress" | "final"; text: string };

export async function* runAgent(opts: {
  modelId: string;
  history: HistoryItem[];
  conversationId: string;
  signal: AbortSignal;
  userId: string;
  projectId?: string | null;
  /** Key MinIO lampiran percakapan (uploads/<uid>/...) untuk dihidrasi ke input/. */
  attachmentKeys?: string[];
  sessionId?: string | null;
  maxSteps?: number;
}): AsyncGenerator<AgentChunk> {
  const maxSteps = opts.maxSteps ?? 10;
  const base = `agent-${randomUUID()}`;
  const attachmentKeys = opts.attachmentKeys ?? [];
  const produced = new Map<string, { path: string; url: string }>();

  // Konteks workspace awal: berkas input + hasil sebelumnya (agar model tahu nama berkas).
  let wsNote = "";
  try {
    const ws = await listWorkspace(opts.userId, opts.conversationId);
    const inputs = attachmentKeys.map((k) => (k.split("/").pop() ?? k).replace(/^\d{10,}-[0-9a-f]{8}-/, ""));
    const lines: string[] = [];
    if (inputs.length) lines.push(`Lampiran pengguna (input/): ${inputs.map((n) => `input/${n}`).join(", ")}`);
    if (ws.length) lines.push(`Berkas workspace sebelumnya: ${ws.map((w) => w.path).join(", ")}`);
    if (lines.length) wsNote = `\n\nKONTEKS WORKSPACE:\n${lines.join("\n")}`;
  } catch {
    /* opsional */
  }

  // Instruksi alat sbg pesan sistem di depan; riwayat tumbuh tiap langkah.
  const history: HistoryItem[] = [{ role: "system", content: TOOL_INSTRUCTIONS + wsNote }, ...opts.history];
  const runOpts = {
    userId: opts.userId,
    conversationId: opts.conversationId,
    attachmentKeys,
    sessionId: opts.sessionId ?? null,
  };
  const note = (r: { outputs: Array<{ path: string; url: string }> }) => {
    for (const o of r.outputs) produced.set(o.path, o);
  };
  const observe = (reply: string, obs: string) => {
    // Log ringkas tiap langkah (diagnosa kualitas model/alat) — tanpa isi berkas.
    console.log(`[agent] ${reply.trim().split("\n")[0].slice(0, 100)} -> ${obs.replace(/\s+/g, " ").slice(0, 300)}`);
    history.push({ role: "assistant", content: reply });
    history.push({ role: "user", content: `OBSERVASI:\n${obs}` });
  };

  for (let step = 0; step < maxSteps; step++) {
    // Sesi model EPHEMERAL per langkah (id unik) -> selalu kirim riwayat penuh,
    // tak mengotori sesi Copilot percakapan asli.
    const reply = await callModel(opts.modelId, history, `${base}-${step}`, opts.signal);
    const shellM = reply.match(/^\s*AKSI:\s*shell\s+([\s\S]+)$/im);
    const codeM = reply.match(/^\s*AKSI:\s*kode\s+([\s\S]+)$/im);
    const writeM = reply.match(/^\s*AKSI:\s*tulis\s+([^\n]+)\n([\s\S]*)$/im);
    const readM = reply.match(/^\s*AKSI:\s*baca\s+(.+)$/im);
    const listM = reply.match(/^\s*AKSI:\s*daftar\s*$/im);
    const webM = reply.match(/^\s*AKSI:\s*web\s+(.+)$/im);
    const kbM = reply.match(/^\s*AKSI:\s*catatan\s+(.+)$/im);
    const driveM = reply.match(/^\s*AKSI:\s*drive\s+(.+)$/im);

    if (shellM) {
      const cmd = unfence(shellM[1]);
      yield { kind: "progress", text: `\n🖥️ Menjalankan perintah: \`${cmd.split("\n")[0].slice(0, 80)}\`…\n` };
      try {
        const r = await runInWorkspace({ ...runOpts, lang: "sh", code: cmd, timeoutS: 60 });
        note(r);
        observe(reply, fmtRun(r));
      } catch (e) {
        observe(reply, `(shell gagal: ${(e as Error).message.slice(0, 200)})`);
      }
      continue;
    }
    if (codeM) {
      yield { kind: "progress", text: `\n🧮 Menjalankan kode Python…\n` };
      try {
        const r = await runInWorkspace({ ...runOpts, lang: "python", code: unfence(codeM[1]), timeoutS: 90 });
        note(r);
        observe(reply, fmtRun(r));
      } catch (e) {
        observe(reply, `(kode gagal: ${(e as Error).message.slice(0, 200)})`);
      }
      continue;
    }
    if (writeM) {
      // Path = token pertama baris (model kadang menulis "\n" literal atau teks lain di belakangnya).
      const rawPath = writeM[1].trim().split(/\\n|\s/)[0].replace(/^["'`]|["'`]$/g, "");
      const path = rawPath;
      const body = unfence(writeM[2]);
      const ext = (path.split(".").pop() ?? "").toLowerCase();
      if (!TEXT_WRITE_EXT.has(ext)) {
        observe(
          reply,
          `(AKSI: tulis hanya untuk berkas TEKS (${[...TEXT_WRITE_EXT].slice(0, 8).join(", ")}, ...). ` +
            `Untuk .${ext || "?"} (biner: pdf/docx/xlsx/pptx/png) gunakan AKSI: kode dengan pustaka Python yang tersedia, lalu simpan ke berkas.)`,
        );
        continue;
      }
      yield { kind: "progress", text: `\n📝 Menulis berkas ${path}…\n` };
      try {
        const w = await writeWorkspaceFile({ ...runOpts, path, content: body });
        if (w) {
          produced.set(w.path, w);
          observe(reply, `Berkas ${w.path} tersimpan (${Buffer.byteLength(body, "utf8")} B).`);
        } else observe(reply, `(path tidak valid: ${path})`);
      } catch (e) {
        observe(reply, `(tulis gagal: ${(e as Error).message.slice(0, 200)})`);
      }
      continue;
    }
    if (readM) {
      const path = readM[1].trim().replace(/^["'`]|["'`]$/g, "");
      yield { kind: "progress", text: `\n📖 Membaca ${path}…\n` };
      const text = await readWorkspaceFile({ ...runOpts, path, limit: 40_000 });
      observe(reply, text ? `=== ${path} ===\n${text}` : `(berkas ${path} tidak ditemukan / tak terbaca)`);
      continue;
    }
    if (listM) {
      yield { kind: "progress", text: `\n📂 Melihat workspace…\n` };
      const ws = await listWorkspace(opts.userId, opts.conversationId);
      const inputs = attachmentKeys.map((k) => `input/${(k.split("/").pop() ?? k).replace(/^\d{10,}-[0-9a-f]{8}-/, "")}`);
      observe(reply, [...inputs, ...ws.map((w) => `${w.path} (${w.size} B)`)].join("\n") || "(workspace kosong)");
      continue;
    }

    if (driveM) {
      const link = driveM[1].trim();
      yield { kind: "progress", text: `\n📁 Membaca Google Drive…\n` };
      observe(reply, await readDrive(link));
      continue;
    }
    if (kbM) {
      const q = kbM[1].trim().slice(0, 200);
      yield { kind: "progress", text: `\n📚 Mencari di dokumenmu: “${q}”…\n` };
      let obs: string;
      try {
        const hits = await retrieve({ userId: opts.userId, projectId: opts.projectId, query: q });
        obs = formatKnowledge(hits) || "(tak ada dokumen relevan di knowledge base)";
      } catch {
        obs = "(pencarian dokumen gagal)";
      }
      observe(reply, obs);
      continue;
    }
    if (webM) {
      const q = webM[1].trim().slice(0, 200);
      yield { kind: "progress", text: `\n🔎 Mencari web: “${q}”…\n` };
      let obs: string;
      try {
        obs = formatSearchContext(q, await webSearch(q));
      } catch {
        obs = "(pencarian web gagal)";
      }
      observe(reply, obs);
      continue;
    }

    // Tidak ada aksi -> ini jawaban final.
    yield { kind: "final", text: reply + filesFooter(produced) };
    return;
  }

  // Langkah habis -> paksa jawaban final.
  const finalReply = await callModel(
    opts.modelId,
    [...history, { role: "user", content: "Cukup. Berikan JAWABAN final untuk pengguna sekarang, tanpa AKSI." }],
    `${base}-final`,
    opts.signal,
  );
  yield { kind: "final", text: finalReply + filesFooter(produced) };
}

/** Tautan unduh berkas yang dihasilkan agen (ditambahkan di bawah jawaban). */
function filesFooter(produced: Map<string, { path: string; url: string }>): string {
  if (produced.size === 0) return "";
  const lines = [...produced.values()].map((o) => `- [${o.path}](${o.url})`);
  return `\n\n**Berkas hasil:**\n${lines.join("\n")}\n`;
}
