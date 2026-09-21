import { randomUUID } from "node:crypto";
import { POST as chatCompletions } from "@/app/v1/chat/completions/route";
import { normalizeTools } from "@/server/gateway-tools";

export const runtime = "nodejs";

/**
 * POST /v1/responses — adaptor OpenAI *Responses API* (dipakai Continue mode
 * Agent untuk model gpt-*). Menerjemahkan `input`/`instructions` -> `messages`,
 * memanggil route /v1/chat/completions yang sudah ada (auth, rate-limit, kredit,
 * limit harian, pencatatan ikut otomatis), lalu membungkus hasilnya ke format
 * Responses (stream & non-stream). Tools/function-calling TIDAK didukung
 * (diabaikan) — model tetap menjawab sebagai teks.
 */

type Part = { type?: string; text?: string };
type InputItem = {
  type?: string;
  role?: string;
  content?: string | Part[];
  output?: unknown;
  call_id?: string;
  name?: string;
  arguments?: string;
};
type Msg =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: string; tool_calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

function partsText(c: string | Part[] | undefined): string {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
}

function toMessages(input: unknown, instructions?: unknown): Msg[] {
  const out: Msg[] = [];
  if (typeof instructions === "string" && instructions.trim()) {
    out.push({ role: "system", content: instructions });
  }
  if (typeof input === "string") {
    out.push({ role: "user", content: input });
    return out;
  }
  if (!Array.isArray(input)) return out;
  for (const raw of input as InputItem[]) {
    if (!raw) continue;
    if (raw.type === "function_call_output") {
      const o = typeof raw.output === "string" ? raw.output : JSON.stringify(raw.output ?? "");
      out.push({ role: "tool", tool_call_id: raw.call_id ?? "", content: o });
      continue;
    }
    if (raw.type === "function_call") {
      out.push({
        role: "assistant",
        content: "",
        tool_calls: [{ id: raw.call_id ?? "", type: "function", function: { name: raw.name ?? "", arguments: raw.arguments ?? "{}" } }],
      });
      continue;
    }
    if (raw.type === "reasoning") continue;
    const role = raw.role === "assistant" ? "assistant" : raw.role === "system" || raw.role === "developer" ? "system" : "user";
    const text = partsText(raw.content);
    if (text) out.push({ role, content: text });
  }
  return out;
}

function responseObject(
  id: string,
  model: string,
  created: number,
  text: string,
  status: "in_progress" | "completed",
  calls: Array<{ id: string; name: string; arguments: string }> = [],
) {
  const output: unknown[] = [];
  if (status === "completed") {
    if (text) {
      output.push({
        type: "message",
        id: `msg_${id}`,
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      });
    }
    for (const c of calls) {
      output.push({ type: "function_call", id: `fc_${c.id}`, call_id: c.id, name: c.name, arguments: c.arguments, status: "completed" });
    }
  }
  return {
    id,
    object: "response",
    created_at: created,
    status,
    model,
    output,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    model?: string;
    input?: unknown;
    instructions?: unknown;
    stream?: boolean;
    tools?: unknown;
    tool_choice?: unknown;
  } | null;
  if (!body || typeof body.model !== "string" || body.input == null) {
    return Response.json(
      { error: { message: "Wajib menyertakan 'model' dan 'input'", type: "invalid_request_error" } },
      { status: 400 },
    );
  }
  const messages = toMessages(body.input, body.instructions);
  if (messages.length === 0) {
    return Response.json({ error: { message: "'input' kosong", type: "invalid_request_error" } }, { status: 400 });
  }

  const stream = body.stream === true;
  const tools = normalizeTools(body.tools);
  const inner = new Request(new URL("/v1/chat/completions", req.url), {
    method: "POST",
    headers: { authorization: req.headers.get("authorization") ?? "", "content-type": "application/json" },
    body: JSON.stringify({
      model: body.model,
      messages,
      stream,
      ...(tools.length ? { tools: tools.map((t) => ({ type: "function", function: t })), tool_choice: body.tool_choice } : {}),
    }),
    signal: req.signal,
  });
  const res = await chatCompletions(inner);
  // Error (401/403/429/...) sudah berformat {error:{message,type}} -> teruskan apa adanya.
  if (!res.ok) return res;

  const id = `resp_${randomUUID().replace(/-/g, "")}`;
  const created = Math.floor(Date.now() / 1000);
  const model = body.model;

  if (!stream) {
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
    };
    const msg = data.choices?.[0]?.message;
    const text = msg?.content ?? "";
    const calls = (msg?.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments }));
    return Response.json(responseObject(id, model, created, text, "completed", calls));
  }

  // Stream: terjemahkan SSE chat.completion.chunk -> event Responses API.
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const reader = res.body!.getReader();
  const itemId = `msg_${id}`;
  let seq = 0;
  const out = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const emit = (type: string, payload: Record<string, unknown>) =>
        ctrl.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...payload })}\n\n`));
      let acc = "";
      let buf = "";
      const calls: Array<{ id: string; name: string; arguments: string }> = [];
      emit("response.created", { response: responseObject(id, model, created, "", "in_progress") });
      emit("response.in_progress", { response: responseObject(id, model, created, "", "in_progress") });
      emit("response.output_item.added", {
        output_index: 0,
        item: { type: "message", id: itemId, status: "in_progress", role: "assistant", content: [] },
      });
      emit("response.content_part.added", {
        item_id: itemId,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      });
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            let obj: {
              choices?: Array<{
                delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> };
              }>;
              error?: { message?: string };
            };
            try {
              obj = JSON.parse(payload);
            } catch {
              continue;
            }
            if (obj.error) {
              emit("error", { code: "server_error", message: obj.error.message ?? "gagal", param: null });
              continue;
            }
            const d = obj.choices?.[0]?.delta;
            const delta = d?.content;
            if (delta) {
              acc += delta;
              emit("response.output_text.delta", { item_id: itemId, output_index: 0, content_index: 0, delta });
            }
            for (const tc of d?.tool_calls ?? []) {
              if (tc.id && tc.function?.name) {
                calls.push({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments ?? "{}" });
              }
            }
          }
        }
        emit("response.output_text.done", { item_id: itemId, output_index: 0, content_index: 0, text: acc });
        emit("response.content_part.done", {
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: acc, annotations: [] },
        });
        emit("response.output_item.done", {
          output_index: 0,
          item: {
            type: "message",
            id: itemId,
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: acc, annotations: [] }],
          },
        });
        // Tool calls (emulasi) -> item function_call agar klien mengeksekusi tool-nya.
        calls.forEach((c, i) => {
          const idx = i + 1;
          const item = { type: "function_call", id: `fc_${c.id}`, call_id: c.id, name: c.name, arguments: "", status: "in_progress" };
          emit("response.output_item.added", { output_index: idx, item });
          emit("response.function_call_arguments.delta", { item_id: item.id, output_index: idx, delta: c.arguments });
          emit("response.function_call_arguments.done", { item_id: item.id, output_index: idx, arguments: c.arguments });
          emit("response.output_item.done", { output_index: idx, item: { ...item, arguments: c.arguments, status: "completed" } });
        });
        emit("response.completed", { response: responseObject(id, model, created, acc, "completed", calls) });
      } catch (e) {
        emit("error", { code: "server_error", message: (e as Error).message || "gagal", param: null });
      } finally {
        ctrl.close();
      }
    },
    cancel() {
      void reader.cancel().catch(() => {});
    },
  });
  return new Response(out, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
