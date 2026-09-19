import { z } from "zod";
import { guarded, requireUser } from "@/server/auth";
import { createApiKey, listApiKeys } from "@/server/apikeys";

export const runtime = "nodejs";

/** GET /api/apikeys — daftar key milik user (tanpa nilai rahasia). */
export const GET = guarded(async () => {
  const me = await requireUser();
  return Response.json({ keys: await listApiKeys(me.id) });
});

const schema = z.object({ name: z.string().trim().max(60).optional() });

/** POST /api/apikeys — buat key baru; `raw` HANYA dikembalikan sekali di sini. */
export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const body = schema.safeParse(await req.json().catch(() => ({})));
  const name = body.success ? body.data.name ?? "" : "";
  const existing = await listApiKeys(me.id);
  if (existing.length >= 10) {
    return Response.json(
      { error: "Maksimal 10 API key aktif — cabut yang lama dulu" },
      { status: 400 },
    );
  }
  const key = await createApiKey(me.id, name);
  return Response.json({ key });
});
