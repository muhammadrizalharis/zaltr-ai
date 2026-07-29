import { z } from "zod";
import { db } from "@/lib/db";
import { ollamaBaseUrl } from "@/server/models";
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
        for await (const chunk of generate(modelId, history, req.signal)) {
          acc += chunk;
          send({ type: "delta", text: chunk });
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
          provider: modelId.split(":")[0] === modelId ? "zaltr" : modelId.split(":")[0],
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

type HistoryItem = { role: string; content: string };

async function* generate(
  modelId: string,
  history: HistoryItem[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  if (modelId.startsWith("ollama:")) {
    yield* ollamaChat(modelId.slice("ollama:".length), history, signal);
    return;
  }
  if (modelId.startsWith("copilot:")) {
    throw new Error(
      "Provider Copilot belum aktif pada fase preview. Isi secrets/copilot_github_token lalu nyalakan profile ai.",
    );
  }
  yield* demoChat(history, signal);
}

/** Provider demo: streaming lokal tanpa model eksternal, untuk pratinjau UI. */
async function* demoChat(history: HistoryItem[], signal: AbortSignal): AsyncGenerator<string> {
  const prompt = history.at(-1)?.content ?? "";
  const jumlahPesan = history.length;
  const reply =
    `Ini **Zaltr Core**, provider demo internal zaltr.ai — dipakai untuk menguji ` +
    `antarmuka sebelum Copilot Enterprise dan Ollama diaktifkan.\n\n` +
    `Pesanmu barusan:\n\n> ${prompt.slice(0, 500)}\n\n` +
    `Beberapa hal yang sudah bekerja pada pratinjau ini:\n\n` +
    `- Streaming token seperti ini, kata demi kata\n` +
    `- Riwayat tersimpan di PostgreSQL (percakapan ini berisi ${jumlahPesan} pesan)\n` +
    `- Tombol **model picker** di samping kolom chat\n` +
    `- Markdown: \`inline code\`, daftar, dan blok kode\n\n` +
    "```ts\n" +
    `const provider = "zaltr-core"; // ganti ke Copilot/Ollama dari tombol model\n` +
    "```\n\n" +
    `Ganti model dari tombol di kiri kolom chat untuk melihat status provider lain.`;

  for (const token of reply.split(/(?<=\s)/)) {
    if (signal.aborted) throw new Error("aborted");
    yield token;
    await new Promise((r) => setTimeout(r, 12));
  }
}

async function* ollamaChat(
  model: string,
  history: HistoryItem[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  const res = await fetch(`${ollamaBaseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama menolak permintaan (${res.status}). Cek: bin/zaltrctl up gpu`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const data = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
      const text = data.message?.content;
      if (text) yield text;
    }
  }
}
