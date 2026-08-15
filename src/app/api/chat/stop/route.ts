import { z } from "zod";
import { guarded, requireUser } from "@/server/auth";
import { abortRun } from "@/server/runs";

export const runtime = "nodejs";

const bodySchema = z.object({ runId: z.string().min(1).max(80) });

/** Hentikan generasi yang sedang berjalan (tombol Stop di composer). */
export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "runId tidak valid" }, { status: 400 });
  }
  return Response.json({ stopped: abortRun(parsed.data.runId, me.id) });
});
