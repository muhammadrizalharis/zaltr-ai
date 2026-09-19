import { guarded, requireUser } from "@/server/auth";
import { revokeApiKey } from "@/server/apikeys";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** DELETE /api/apikeys/[id] — cabut (revoke) key milik user. */
export const DELETE = guarded(async (_req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const ok = await revokeApiKey(me.id, id);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
});
