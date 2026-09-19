import { modelAllowed } from "@/server/auth";
import { userFromApiKey } from "@/server/apikeys";
import { listModels } from "@/server/models";

export const runtime = "nodejs";

/** GET /v1/models — daftar model (format OpenAI) yang DIIZINKAN untuk key ini. */
export async function GET(req: Request) {
  const me = await userFromApiKey(req);
  if (!me) {
    return Response.json(
      { error: { message: "API key tidak valid atau dicabut", type: "authentication_error" } },
      { status: 401 },
    );
  }
  const all = await listModels();
  const data = all
    .filter((m) => m.available !== false && modelAllowed(me.allowedModels, m.id))
    .map((m) => ({ id: m.id, object: "model", created: 0, owned_by: "calyzr" }));
  return Response.json({ object: "list", data });
}
