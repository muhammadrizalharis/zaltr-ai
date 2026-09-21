import { userFromApiKey } from "@/server/apikeys";
import { rateLimit } from "@/server/ratelimit";
import { embed, EMBED_MODEL } from "@/server/embeddings";

export const runtime = "nodejs";

function err(message: string, status: number, type = "invalid_request_error") {
  return Response.json({ error: { message, type } }, { status });
}

/**
 * POST /v1/embeddings — kompatibel OpenAI. Memakai model embedding LOKAL
 * (bge-m3 via Ollama) sehingga GRATIS (tak memotong kredit). Dipakai mis. oleh
 * Continue untuk indeks @codebase.
 */
export async function POST(req: Request) {
  const me = await userFromApiKey(req);
  if (!me) return err("API key tidak valid atau dicabut", 401, "authentication_error");

  const rl = await rateLimit(`emb:${me.id}`, 120, 60_000);
  if (!rl.ok) {
    return Response.json(
      { error: { message: `Terlalu banyak permintaan — coba lagi dalam ${rl.retryAfter} detik.`, type: "rate_limit_error" } },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => null)) as { input?: unknown; model?: string } | null;
  if (!body || body.input == null) return err("Wajib menyertakan 'input'", 400);
  const inputs = (Array.isArray(body.input) ? body.input : [body.input]).map((x) => String(x));
  if (inputs.length === 0 || inputs.every((s) => s.trim() === "")) return err("'input' kosong", 400);
  if (inputs.length > 256) return err("Maksimum 256 input per permintaan", 400);

  let vecs: number[][];
  try {
    vecs = await embed(inputs);
  } catch (e) {
    return err((e as Error).message || "Gagal membuat embedding", 502, "server_error");
  }

  return Response.json({
    object: "list",
    data: vecs.map((embedding, index) => ({ object: "embedding", index, embedding })),
    model: body.model || EMBED_MODEL,
    usage: { prompt_tokens: 0, total_tokens: 0 },
  });
}
