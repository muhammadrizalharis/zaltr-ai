import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";
import { suggestFollowups } from "@/server/suggestions";

export const runtime = "nodejs";

/** POST { conversationId } -> 3 saran pertanyaan lanjutan (dari pertukaran terakhir). */
export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const { conversationId } = (await req.json().catch(() => ({}))) as { conversationId?: string };
  if (!conversationId) return Response.json({ suggestions: [] });
  const convo = await db.conversation.findFirst({
    where: { id: conversationId, userId: me.id },
    select: { id: true },
  });
  if (!convo) return Response.json({ suggestions: [] });
  const msgs = await db.message.findMany({
    where: { conversationId, status: { not: "failed" } },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { role: true, content: true },
  });
  const lastAssistant = msgs.find((m) => m.role === "assistant")?.content ?? "";
  const lastUser = msgs.find((m) => m.role === "user")?.content ?? "";
  if (!lastAssistant) return Response.json({ suggestions: [] });
  const suggestions = await suggestFollowups(lastUser, lastAssistant);
  return Response.json({ suggestions });
});
