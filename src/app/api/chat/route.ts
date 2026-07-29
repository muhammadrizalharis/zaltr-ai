import { z } from "zod";
import { db } from "@/lib/db";
import { dispatch } from "@/server/providers";
import { guarded, modelAllowed, requireUser } from "@/server/auth";
import type { StreamLine } from "@/lib/types";

export const runtime = "nodejs";

/** Kredit per pesan: Copilot memakai pool Enterprise -> 1 kredit; lokal gratis. */
function creditCost(modelId: string): number {
  return modelId.startsWith("copilot:") ? 1 : 0;
}

const bodySchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().trim().min(1).max(32_000),
  modelId: z.string().min(1),
});

export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  const { conversationId, content, modelId } = parsed.data;

  // Kebijakan akun (diatur admin): model diizinkan? limit harian? kredit cukup?
  if (!modelAllowed(me.allowedModels, modelId)) {
    return Response.json(
      { error: "Model ini tidak diizinkan untuk akunmu — hubungi admin" },
      { status: 403 },
    );
  }
  if (me.dailyMsgLimit != null) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const sentToday = await db.message.count({
      where: {
        role: "user",
        createdAt: { gte: startOfDay },
        conversation: { userId: me.id },
      },
    });
    if (sentToday >= me.dailyMsgLimit) {
      return Response.json(
        { error: `Batas harian ${me.dailyMsgLimit} pesan tercapai — coba lagi besok` },
        { status: 429 },
      );
    }
  }
  const cost = creditCost(modelId);
  if (cost > 0 && me.creditBalance < cost) {
    return Response.json(
      { error: "Kredit habis — hubungi admin untuk menambah kredit" },
      { status: 402 },
    );
  }

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, userId: me.id, trashedAt: null },
    select: { id: true, title: true },
  });
  if (!conversation) {
    return Response.json({ error: "Conversation tidak ditemukan" }, { status: 404 });
  }

  // WRITE-FIRST (kontrak README): prompt tersimpan durable SEBELUM provider jalan.
  // Kredit dipotong pada transaksi yang sama; refund otomatis bila provider failed.
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
    db.user.update({
      where: { id: me.id },
      data: { creditBalance: { decrement: cost }, creditUsed: { increment: cost } },
    }),
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
      // Provider gagal bukan salah user — kembalikan kreditnya.
      if (status === "failed" && cost > 0) {
        await db.user.update({
          where: { id: me.id },
          data: { creditBalance: { increment: cost }, creditUsed: { decrement: cost } },
        });
      }

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
});
