import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ChatView } from "@/components/chat-view";
import { getSessionUser } from "@/server/auth";
import type { ChatMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getSessionUser();
  if (!me) redirect("/login");
  const { id } = await params;
  const conversation = await db.conversation.findFirst({
    where: { id, userId: me.id, trashedAt: null },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) notFound();

  const initialMessages: ChatMessage[] = conversation.messages.map((m) => ({
    id: m.id,
    role: m.role as ChatMessage["role"],
    content: m.content,
    model: m.model,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  }));

  return <ChatView key={conversation.id} conversationId={conversation.id} initialMessages={initialMessages} />;
}
