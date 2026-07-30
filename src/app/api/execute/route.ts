import { z } from "zod";
import { guarded, requireUser } from "@/server/auth";

export const runtime = "nodejs";

const RUNNER_URL = (process.env.ZALTR_RUNNER_URL ?? "").replace(/\/$/, "");

const bodySchema = z.object({ code: z.string().min(1).max(20_000) });

/**
 * Code interpreter: jalankan blok Python di container runner terisolasi
 * (network internal tanpa internet, non-root, read-only, mem/CPU dibatasi).
 * Dipicu tombol "Jalankan" pada code block Python di chat.
 */
export const POST = guarded(async (req: Request) => {
  await requireUser();
  if (!RUNNER_URL) {
    return Response.json({ error: "Runner belum dikonfigurasi" }, { status: 503 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Kode kosong atau terlalu panjang" }, { status: 400 });
  }
  try {
    const res = await fetch(`${RUNNER_URL}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: parsed.data.code }),
      signal: AbortSignal.timeout(40_000),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "Runner tidak merespons" }, { status: 502 });
  }
});
