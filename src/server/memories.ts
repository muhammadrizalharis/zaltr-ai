import { db } from "@/lib/db";

/**
 * Memori antar-percakapan (ala ChatGPT Memory).
 * Ekstraksi GRATIS via model lokal Ollama (llama3.2) — dijalankan
 * fire-and-forget setelah pesan user tersimpan; gagal = diam (best-effort).
 */

const OLLAMA_URL = process.env.ZALTR_OLLAMA_URL ?? "http://127.0.0.1:46434";
const EXTRACT_MODEL = process.env.ZALTR_MEMORY_MODEL ?? "llama3.2:latest";
const MAX_MEMORIES = 100;

const EXTRACT_PROMPT =
  "Kamu pengekstrak memori jangka panjang. Dari pesan pengguna, ambil HANYA fakta/preferensi " +
  "STABIL yang berguna diingat: nama, studi/pekerjaan, lokasi, proyek yang sedang dikerjakan, " +
  "orang penting, DAN preferensi cara menjawab (mis. suka ringkas atau detail, bahasa formal " +
  "atau santai, suka contoh kode, level pemula atau ahli). " +
  "ATURAN KERAS: (1) Bila TIDAK ADA fakta/preferensi konkret yang baru, jawab PERSIS satu kata: NONE. " +
  "(2) DILARANG menulis 'tidak tersedia', 'tidak disediakan', 'N/A', label kosong, atau tebakan. " +
  "(3) Tiap baris HARUS memuat NILAI konkret (mis. \"Sedang menulis jurnal tentang deep RL\"), bukan label kosong. " +
  "Format: maksimal 3 baris, satu fakta per baris, Bahasa Indonesia ringkas. " +
  "ABAIKAN pertanyaan, perintah tugas, opini sesaat, dan isi lampiran/dokumen.";

// Tolak baris "non-fakta" yang sering dikeluarkan model saat tak ada info nyata
// (mis. "Tidak tersedia", "Lokasi: [Tidak disediakan]", "Fakta Personal:").
// Sampah semacam ini kalau tersimpan malah membanjiri prompt & menurunkan kualitas.
export function looksLikeJunkMemory(line: string): boolean {
  const t = line.trim();
  if (t.length < 8) return true;
  if (/\btidak (tersedia|disediakan|diberikan|disebut(kan)?|ada|diketahui|jelas)\b/i.test(t)) return true;
  if (/\b(n\/?a|none|unknown|not (available|provided|specified|given)|no info(rmation)?)\b/i.test(t)) return true;
  if (/:\s*$/.test(t)) return true; // label tanpa nilai, mis. "Fakta Personal:"
  if (/:\s*\[[^\]]*\]\s*$/.test(t)) return true; // nilai placeholder "...: [..]"
  if (/^\[[^\]]*\]$/.test(t)) return true; // seluruhnya "[..]"
  return false;
}

export async function extractMemories(userId: string, userText: string): Promise<void> {
  try {
    // Pesan sangat pendek/berisi lampiran besar jarang berisi fakta baru yang bersih.
    const text = userText.split("\n\nLampiran:")[0].slice(0, 2_000);
    if (text.trim().length < 15) return;

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EXTRACT_MODEL,
        stream: false,
        keep_alive: "10m",
        messages: [
          { role: "system", content: EXTRACT_PROMPT },
          { role: "user", content: text },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { message?: { content?: string } };
    const out = (data.message?.content ?? "").trim();
    if (!out || out.toUpperCase().includes("NONE")) return;

    const existing = await db.memory.findMany({
      where: { userId },
      select: { content: true },
    });
    if (existing.length >= MAX_MEMORIES) return;
    const known = new Set(existing.map((m) => m.content.toLowerCase()));

    const lines = out
      .split("\n")
      .map((l) => l.replace(/^[-*\d.\s]+/, "").trim())
      .filter((l) => l.length >= 8 && l.length <= 200)
      // Tolak fragmen markdown/tautan/berkas yang bocor (mis. "…](…png)").
      .filter((l) => !/\]\(|!\[|https?:\/\/|\/api\/|\.(png|jpe?g|webp|gif|mp4|mp3|pdf)\b/i.test(l))
      // Tolak baris placeholder "tidak ada info" (jaga memori tetap bersih).
      .filter((l) => !looksLikeJunkMemory(l))
      .slice(0, 3);
    for (const line of lines) {
      if (known.has(line.toLowerCase())) continue;
      await db.memory.create({ data: { userId, content: line } });
    }
  } catch {
    // best-effort — jangan pernah mengganggu alur chat
  }
}

/** Ambil memori user untuk disuntik ke prompt (terbaru dulu, dibatasi). */
export async function memoryContext(userId: string): Promise<string | null> {
  const memories = await db.memory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { content: true },
  });
  if (memories.length === 0) return null;
  return `Yang kamu ketahui tentang pengguna ini dari percakapan sebelumnya (pakai untuk menyesuaikan isi & gaya jawaban):\n${memories
    .map((m) => `- ${m.content}`)
    .join("\n")}`;
}
