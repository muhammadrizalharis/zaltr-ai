import type { ChatRequest, ProviderGenerator } from "./contract";
import { ollamaChat } from "./ollama";

/**
 * Zaltr Free — model gratis untuk semua akun baru.
 * Di balik layar memakai model lokal kecil (gratis, GPU sendiri), dengan
 * batasan khas paket free: riwayat pendek (6 pesan), tanpa memori
 * antar-percakapan, tanpa web search, jawaban ringkas.
 */

const FREE_MODEL = process.env.ZALTR_FREE_MODEL ?? "llama3.2:latest";
const FREE_HISTORY = 6;

const FREE_SYSTEM =
  "Kamu adalah Zaltr Free — versi gratis asisten zaltr.ai. Jawab dalam bahasa " +
  "pengguna (default Bahasa Indonesia), ramah dan ringkas (umumnya 1-4 paragraf). " +
  "Kamu model ringan: untuk tugas berat (analisis dokumen panjang, koding rumit, " +
  "riset mendalam, gambar/video/musik) sarankan dengan sopan upgrade ke model " +
  "premium lewat tombol Beli Kredit. Jangan mengarang fakta; bila tidak yakin, " +
  "katakan. Gunakan Markdown seperlunya.";

export async function* demoChat(req: ChatRequest): ProviderGenerator {
  // Paket free: konteks dipangkas + persona free menggantikan prompt utama.
  const shortHistory = [
    { role: "system", content: FREE_SYSTEM },
    ...req.history.slice(-FREE_HISTORY).map((m) => ({ role: m.role, content: m.content })),
  ];
  yield* ollamaChat({ ...req, model: FREE_MODEL, history: shortHistory });
}
