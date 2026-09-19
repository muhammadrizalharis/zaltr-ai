import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { modelAllowed } from "@/server/auth";
import { userFromApiKey } from "@/server/apikeys";
import { effectiveDailyLimit } from "@/server/plans";
import { rateLimit } from "@/server/ratelimit";
import { dispatch } from "@/server/providers";
import type { HistoryItem } from "@/server/providers";

export const runtime = "nodejs";

/** Kredit per panggilan: Copilot pakai pool Enterprise -> 1; model lokal gratis. */
function creditCost(modelId: string): number {
  return modelId.startsWith("copilot:") ? 1 : 0;
}

// Semua pemakaian gateway dicatat di SATU percakapan sentinel per user, supaya
// ikut terhitung pada limit harian (yang menghitung Message user hari ini).
const API_CONV_TITLE = "\u{1F50C} Akses API (VS Code)";

function err(message: string, status: number, type = "invalid_request_error") {
  return Response.json({ error: { message, type } }, { status });
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
      .join("");
  }
  return content == null ? "" : String(content);
}

/** POST /v1/chat/completions — kompatibel OpenAI (stream & non-stream). */
export async function POST(req: Request) {
  const me = await userFromApiKey(req);
  if (!me) return err("API key tidak valid atau dicabut", 401, "authentication_error");

  // Rate limit: cegah spam yang menghabiskan kredit/kuota (60 permintaan/menit/user).
  const rl = rateLimit(`v1:${me.id}`, 60, 60_000);
  if (!rl.ok) {
    return Response.json(
      {
        error: {
          message: `Terlalu banyak permintaan — coba lagi dalam ${rl.retryAfter} detik.`,
          type: "rate_limit_error",
        },
      },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    model?: string;
    messages?: Array<{ role?: string; content?: unknown }>;
    stream?: boolean;
  } | null;
  if (!body || typeof body.model !== "string" || !Array.isArray(body.messages)) {
    return err("Wajib menyertakan 'model' dan 'messages'", 400);
  }

  const modelId = body.model;
  if (!modelAllowed(me.allowedModels, modelId)) {
    return err("Model ini tidak diizinkan untuk akunmu — hubungi admin", 403, "permission_error");
  }

  const dailyLimit = effectiveDailyLimit(me.plan, me.dailyMsgLimit);
  if (dailyLimit != null) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const sentToday = await db.message.count({
      where: { role: "user", createdAt: { gte: startOfDay }, conversation: { userId: me.id } },
    });
    if (sentToday >= dailyLimit) {
      return err(`Batas harian paket ${me.plan} (${dailyLimit}) tercapai — coba lagi besok`, 429, "rate_limit_error");
    }
  }

  const cost = creditCost(modelId);
  if (cost > 0 && me.creditBalance < cost) {
    return err("Kredit habis — hubungi admin untuk menambah kredit", 402, "insufficient_quota");
  }

  const history: HistoryItem[] = body.messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
    content: textOf(m.content),
  }));
  const lastUser = [...history].reverse().find((h) => h.role === "user");

  // Percakapan sentinel (utk pencatatan/limit); DIBUAT sekali per user.
  const existing = await db.conversation.findFirst({
    where: { userId: me.id, title: API_CONV_TITLE },
    select: { id: true },
  });
  const convId =
    existing?.id ??
    (await db.conversation.create({ data: { userId: me.id, title: API_CONV_TITLE }, select: { id: true } })).id;

  // WRITE-FIRST: catat pesan user + potong kredit dalam satu transaksi.
  await db.$transaction([
    db.message.create({
      data: { conversationId: convId, role: "user", content: (lastUser?.content ?? "").slice(0, 2_000), model: modelId },
    }),
    db.user.update({
      where: { id: me.id },
      data: { creditBalance: { decrement: cost }, creditUsed: { increment: cost } },
    }),
  ]);
  const refund = async () => {
    if (cost > 0) {
      await db.user
        .update({ where: { id: me.id }, data: { creditBalance: { increment: cost }, creditUsed: { decrement: cost } } })
        .catch(() => {});
    }
  };

  // conversationId UNIK per panggilan -> sesi Copilot ephemeral (tak bocor antar
  // permintaan; konteks penuh datang dari `messages` klien).
  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());
  const gen = dispatch(modelId, { history, conversationId: `api-${randomUUID()}`, signal: controller.signal });

  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const persistAssistant = (text: string) =>
    void db.message
      .create({ data: { conversationId: convId, role: "assistant", content: text.slice(0, 4_000), model: modelId } })
      .catch(() => {});

  if (body.stream === true) {
    const enc = new TextEncoder();
    const sse = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        const send = (o: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
        let acc = "";
        try {
          send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
          for await (const part of gen) {
            const text = part.kind === "text" ? part.text : `\n![${part.alt}](${part.url})\n`;
            if (!text) continue;
            acc += text;
            send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
          }
          send({ id, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
          ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
          persistAssistant(acc);
        } catch (e) {
          await refund();
          send({ error: { message: (e as Error).message || "gagal", type: "server_error" } });
        } finally {
          ctrl.close();
        }
      },
      cancel() {
        controller.abort();
      },
    });
    return new Response(sse, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  let acc = "";
  try {
    for await (const part of gen) {
      acc += part.kind === "text" ? part.text : `\n![${part.alt}](${part.url})\n`;
    }
  } catch (e) {
    await refund();
    return err((e as Error).message || "Gagal menghasilkan jawaban", 502, "server_error");
  }
  persistAssistant(acc);
  return Response.json({
    id,
    object: "chat.completion",
    created,
    model: modelId,
    choices: [{ index: 0, message: { role: "assistant", content: acc }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}
