/**
 * EMULASI function-calling OpenAI untuk gateway /v1 (chat/completions & responses).
 * Model di balik calyzr (Copilot SDK availableTools:[] / Ollama) tidak punya
 * tool-calling native ke klien, jadi: definisi tools disuntik sebagai instruksi
 * sistem; bila model ingin memanggil tool ia menulis blok
 *   <<TOOL_CALL>>{"name":"...","arguments":{...}}<</TOOL_CALL>>
 * (boleh beberapa). Gateway mem-parse & mengembalikannya sebagai `tool_calls`
 * (finish_reason "tool_calls") sehingga klien (Continue/Cline/dll) mengeksekusi
 * tool secara lokal lalu mengirim balik pesan role "tool" -> diterjemahkan ke teks.
 */
import { randomUUID } from "node:crypto";

export type OaiTool = {
  type?: string;
  function?: { name: string; description?: string; parameters?: unknown };
  // Responses API: {type:"function", name, description, parameters}
  name?: string;
  description?: string;
  parameters?: unknown;
};

export type ToolCall = { id: string; name: string; arguments: string };

const OPEN = "<<TOOL_CALL>>";
const CLOSE = "<</TOOL_CALL>>";

/** Normalisasi definisi tool dari kedua format (chat.completions & responses). */
export function normalizeTools(tools: unknown): Array<{ name: string; description: string; parameters: unknown }> {
  if (!Array.isArray(tools)) return [];
  const out: Array<{ name: string; description: string; parameters: unknown }> = [];
  for (const t of tools as OaiTool[]) {
    const fn = t?.function ?? (t?.name ? { name: t.name, description: t.description, parameters: t.parameters } : null);
    if (!fn?.name) continue;
    out.push({ name: fn.name, description: fn.description ?? "", parameters: fn.parameters ?? { type: "object", properties: {} } });
  }
  return out.slice(0, 64);
}

/** Instruksi sistem yang mengajari model protokol tool-call. */
export function toolsSystemPrompt(tools: ReturnType<typeof normalizeTools>): string {
  const defs = tools
    .map((t) => `- ${t.name}: ${t.description || "(tanpa deskripsi)"}\n  parameters(JSON Schema): ${JSON.stringify(t.parameters).slice(0, 1500)}`)
    .join("\n");
  return (
    "Kamu punya akses ke TOOLS berikut yang dieksekusi oleh klien (bukan olehmu):\n" +
    defs +
    "\n\nCARA MEMANGGIL TOOL: tulis satu blok per panggilan, PERSIS format ini, tanpa teks lain di dalam blok:\n" +
    `${OPEN}{"name":"<nama_tool>","arguments":{...sesuai schema...}}${CLOSE}\n` +
    "Boleh menulis penjelasan singkat sebelum blok. Boleh beberapa blok bila perlu beberapa tool sekaligus. " +
    "Setelah kamu memanggil tool, BERHENTI dan tunggu hasilnya (akan dikirim sebagai pesan berawalan [TOOL RESULT]). " +
    "Jangan mengarang hasil tool. Bila tidak perlu tool, jawab langsung seperti biasa tanpa blok."
  );
}

/** Ekstrak tool calls dari teks model; kembalikan teks sisa (tanpa blok) + daftar panggilan. */
export function extractToolCalls(text: string): { content: string; calls: ToolCall[] } {
  const calls: ToolCall[] = [];
  let rest = "";
  let i = 0;
  for (;;) {
    const a = text.indexOf(OPEN, i);
    if (a < 0) {
      rest += text.slice(i);
      break;
    }
    rest += text.slice(i, a);
    const b = text.indexOf(CLOSE, a + OPEN.length);
    const raw = (b < 0 ? text.slice(a + OPEN.length) : text.slice(a + OPEN.length, b)).trim();
    i = b < 0 ? text.length : b + CLOSE.length;
    const parsed = parseCall(raw);
    if (parsed) calls.push(parsed);
  }
  // Fallback: model menulis JSON {"name":..,"arguments":..} dalam fence tanpa marker.
  if (calls.length === 0) {
    const m = text.match(/```(?:json)?\s*(\{[\s\S]*?"name"\s*:\s*"[^"]+"[\s\S]*?"arguments"[\s\S]*?\})\s*```/);
    if (m) {
      const p = parseCall(m[1]);
      if (p) {
        calls.push(p);
        rest = text.replace(m[0], "").trim();
      }
    }
  }
  return { content: rest.trim(), calls };
}

function parseCall(raw: string): ToolCall | null {
  try {
    const o = JSON.parse(raw) as { name?: string; arguments?: unknown; parameters?: unknown; input?: unknown };
    if (!o?.name || typeof o.name !== "string") return null;
    const args = o.arguments ?? o.parameters ?? o.input ?? {};
    return {
      id: `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      name: o.name,
      arguments: typeof args === "string" ? args : JSON.stringify(args),
    };
  } catch {
    return null;
  }
}

/** Apakah teks (mungkin belum lengkap) mengandung/terlihat akan memuat tool call. */
export function looksLikeToolCall(text: string): boolean {
  return text.includes(OPEN) || text.includes("<<TOOL");
}

/**
 * Terjemahkan pesan riwayat format OpenAI (termasuk role "tool" & assistant.tool_calls)
 * ke teks polos untuk model calyzr.
 */
export function flattenToolMessages(messages: Array<Record<string, unknown>>): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const out: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    const role = String(m.role ?? "user");
    if (role === "tool") {
      const id = String(m.tool_call_id ?? "");
      out.push({ role: "user", content: `[TOOL RESULT${id ? ` ${id}` : ""}]\n${textOf(m.content)}` });
      continue;
    }
    if (role === "assistant") {
      let content = textOf(m.content);
      const tcs = Array.isArray(m.tool_calls) ? (m.tool_calls as Array<{ id?: string; function?: { name?: string; arguments?: string } }>) : [];
      for (const tc of tcs) {
        content += `\n${OPEN}${JSON.stringify({ name: tc.function?.name, arguments: safeJson(tc.function?.arguments) })}${CLOSE}`;
      }
      out.push({ role: "assistant", content: content.trim() });
      continue;
    }
    out.push({ role: role === "system" || role === "developer" ? "system" : "user", content: textOf(m.content) });
  }
  return out;
}

function safeJson(s: unknown): unknown {
  if (typeof s !== "string") return s ?? {};
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        const q = p as { text?: unknown; type?: string; output?: unknown };
        if (typeof q?.text === "string") return q.text;
        if (typeof q?.output === "string") return q.output;
        return "";
      })
      .join("");
  }
  return content == null ? "" : String(content);
}
