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
  "Kamu adalah pengekstrak memori. Dari pesan pengguna berikut, ambil fakta PERSONAL " +
  "yang berguna diingat jangka panjang (nama, pekerjaan/studi, lokasi, preferensi, " +
  "proyek yang sedang dikerjakan, orang penting). ABAIKAN: pertanyaan, perintah tugas, " +
  "opini sesaat, isi lampiran/dokumen. Jawab HANYA daftar fakta, satu per baris, " +
  "maksimal 3 baris, bahasa Indonesia ringkas (mis. \"Nama pengguna: Rizal\"). " +
  "Bila tidak ada fakta personal baru, jawab persis: NONE";

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
  return `Yang kamu ingat tentang pengguna ini dari percakapan sebelumnya:\n${memories
    .map((m) => `- ${m.content}`)
    .join("\n")}`;
}
