import { z } from "zod";
import { db } from "@/lib/db";
import { dispatch } from "@/server/providers";
import type { StreamLine } from "@/lib/types";

export const runtime = "nodejs";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().trim().min(1).max(32_000),
  modelId: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  const { conversationId, content, modelId } = parsed.data;

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, trashedAt: null },
    select: { id: true, title: true },
  });
  if (!conversation) {
    return Response.json({ error: "Conversation tidak ditemukan" }, { status: 404 });
  }

  // WRITE-FIRST (kontrak README): prompt tersimpan durable SEBELUM provider jalan.
  const title =
    conversation.title === "Chat baru"
      ? content.replace(/\s+/g, " ").slice(0, 60)
      : conversation.title;
  const [userMessage] = await db.$transaction([
    db.message.create({
      data: { conversationId, role: "user", content, model: modelId },
      select: { id: true },
    }),
    db.conversation.update({ where: { id: conversationId }, data: { title } }),
  ]);

  const history = await db.message.findMany({
    where: { conversationId, status: { not: "failed" } },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
    take: 40,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: StreamLine) =>
        controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));

      send({ type: "meta", userMessageId: userMessage.id, conversationTitle: title });

      let acc = "";
      let status: "completed" | "stopped" | "failed" = "completed";
      try {
        const gen = dispatch(modelId, {
          history,
          conversationId,
          signal: req.signal,
        });
        for await (const part of gen) {
          if (part.kind === "text") {
            acc += part.text;
            send({ type: "delta", text: part.text });
          } else {
            // Gambar sudah dipersistenkan ke MinIO oleh provider;
            // simpan sebagai markdown agar ikut kontrak "chat = markdown".
            const md = `\n\n![${part.alt}](${part.url})\n`;
            acc += md;
            send({ type: "delta", text: md });
          }
        }
      } catch (err) {
        if (req.signal.aborted) {
          status = "stopped";
        } else {
          status = "failed";
          const message = err instanceof Error ? err.message : "Provider gagal";
          send({ type: "error", message });
        }
      }

      const assistant = await db.message.create({
        data: {
          conversationId,
          role: "assistant",
          content: acc,
          model: modelId,
          provider: modelId.includes(":") ? modelId.split(":")[0] : "zaltr",
          status,
        },
        select: { id: true },
      });
      await db.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      send({ type: "done", messageId: assistant.id, content: acc, status });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
