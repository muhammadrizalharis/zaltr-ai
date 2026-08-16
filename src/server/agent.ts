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

const RUNNER_URL = (process.env.ZALTR_RUNNER_URL ?? "").replace(/\/$/, "");

const TOOL_INSTRUCTIONS =
  "Kamu agen yang boleh memakai ALAT untuk menjawab lebih akurat. Bila perlu " +
  "informasi terkini atau perhitungan, jawab HANYA dengan SATU baris aksi " +
  "(tanpa teks lain):\n" +
  "AKSI: web <kata kunci>\n" +
  "AKSI: kode <python>\n" +
  "Setelah menerima OBSERVASI, lanjutkan berpikir. Bila sudah cukup, tulis " +
  "JAWABAN final untuk pengguna secara normal (TANPA awalan AKSI) dan sebutkan " +
  "sumber bila memakai web.";

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

async function runCode(code: string): Promise<string> {
  if (!RUNNER_URL) return "(runner tidak tersedia)";
  try {
    const res = await fetch(`${RUNNER_URL}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.slice(0, 20_000) }),
      signal: AbortSignal.timeout(40_000),
    });
    const d = (await res.json()) as { stdout?: string; stderr?: string };
    const text = `${d.stdout ?? ""}${d.stderr ? `\n[stderr] ${d.stderr}` : ""}`.trim();
    return text.slice(0, 2000) || "(tanpa output)";
  } catch {
    return "(runner gagal)";
  }
}

export type AgentChunk = { kind: "progress" | "final"; text: string };

export async function* runAgent(opts: {
  modelId: string;
  history: HistoryItem[];
  conversationId: string;
  signal: AbortSignal;
  maxSteps?: number;
}): AsyncGenerator<AgentChunk> {
  const maxSteps = opts.maxSteps ?? 4;
  const base = `agent-${randomUUID()}`;
  // Instruksi alat sbg pesan sistem di depan; riwayat tumbuh tiap langkah.
  const history: HistoryItem[] = [{ role: "system", content: TOOL_INSTRUCTIONS }, ...opts.history];

  for (let step = 0; step < maxSteps; step++) {
    // Sesi model EPHEMERAL per langkah (id unik) -> selalu kirim riwayat penuh,
    // tak mengotori sesi Copilot percakapan asli.
    const reply = await callModel(opts.modelId, history, `${base}-${step}`, opts.signal);
    const webM = reply.match(/^\s*AKSI:\s*web\s+(.+)$/im);
    const codeM = reply.match(/^\s*AKSI:\s*kode\s+([\s\S]+)$/im);

    if (webM) {
      const q = webM[1].trim().slice(0, 200);
      yield { kind: "progress", text: `\n🔎 Mencari web: “${q}”…\n` };
      let obs: string;
      try {
        obs = formatSearchContext(q, await webSearch(q));
      } catch {
        obs = "(pencarian web gagal)";
      }
      history.push({ role: "assistant", content: reply });
      history.push({ role: "user", content: `OBSERVASI:\n${obs}` });
      continue;
    }
    if (codeM) {
      yield { kind: "progress", text: `\n🧮 Menjalankan kode…\n` };
      const obs = await runCode(codeM[1].trim());
      history.push({ role: "assistant", content: reply });
      history.push({ role: "user", content: `OBSERVASI (hasil kode):\n${obs}` });
      continue;
    }

    // Tidak ada aksi -> ini jawaban final.
    yield { kind: "final", text: reply };
    return;
  }

  // Langkah habis -> paksa jawaban final.
  const finalReply = await callModel(
    opts.modelId,
    [...history, { role: "user", content: "Cukup. Berikan JAWABAN final untuk pengguna sekarang, tanpa AKSI." }],
    `${base}-final`,
    opts.signal,
  );
  yield { kind: "final", text: finalReply };
}
