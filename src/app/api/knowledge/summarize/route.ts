import { guarded, requireUser } from "@/server/auth";
import { rateLimit } from "@/server/ratelimit";
import { summarizeTarget } from "@/server/summarize";

export const runtime = "nodejs";

/** POST: rangkum menyeluruh (map-reduce) sebuah sumber { sourceId } atau seluruh
 *  folder { folder, projectId?, assistantId? } dari basis pengetahuan. */
export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const rl = rateLimit(`sum:${me.id}`, 8, 60_000);
  if (!rl.ok) {
    return Response.json(
      { error: `Terlalu banyak permintaan ringkasan — coba lagi dalam ${rl.retryAfter} detik.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  const body = (await req.json().catch(() => null)) as {
    sourceId?: string;
    folder?: string;
    projectId?: string | null;
    assistantId?: string | null;
  } | null;
  if (!body) return Response.json({ error: "Body tidak valid" }, { status: 400 });

  try {
    const result = body.sourceId
      ? await summarizeTarget(me.id, { sourceId: body.sourceId })
      : body.folder
        ? await summarizeTarget(me.id, {
            folder: body.folder,
            projectId: body.projectId ?? null,
            assistantId: body.assistantId ?? null,
          })
        : null;
    if (!result) return Response.json({ error: "Sebutkan sourceId atau folder" }, { status: 400 });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message || "Gagal merangkum" }, { status: 500 });
  }
});
