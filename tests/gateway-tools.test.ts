import { describe, it, expect } from "vitest";
import { extractToolCalls, flattenToolMessages, normalizeTools, toolsSystemPrompt } from "@/server/gateway-tools";

describe("gateway-tools (emulasi function-calling)", () => {
  it("normalizeTools: format chat.completions & responses", () => {
    const t = normalizeTools([
      { type: "function", function: { name: "read_file", description: "baca", parameters: { type: "object" } } },
      { type: "function", name: "run_cmd", description: "jalankan", parameters: { type: "object" } },
      { type: "function" },
    ]);
    expect(t.map((x) => x.name)).toEqual(["read_file", "run_cmd"]);
    expect(toolsSystemPrompt(t)).toContain("<<TOOL_CALL>>");
    expect(toolsSystemPrompt(t)).toContain("read_file");
  });

  it("extractToolCalls: blok marker -> tool_calls, teks sisa bersih", () => {
    const r = extractToolCalls(
      'Saya akan membaca berkas.\n<<TOOL_CALL>>{"name":"read_file","arguments":{"path":"a.py"}}<</TOOL_CALL>>',
    );
    expect(r.content).toBe("Saya akan membaca berkas.");
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].name).toBe("read_file");
    expect(JSON.parse(r.calls[0].arguments)).toEqual({ path: "a.py" });
    expect(r.calls[0].id).toMatch(/^call_/);
  });

  it("extractToolCalls: beberapa blok", () => {
    const r = extractToolCalls(
      '<<TOOL_CALL>>{"name":"a","arguments":{}}<</TOOL_CALL>>\n<<TOOL_CALL>>{"name":"b","arguments":{"x":1}}<</TOOL_CALL>>',
    );
    expect(r.calls.map((c) => c.name)).toEqual(["a", "b"]);
  });

  it("extractToolCalls: fallback fence json tanpa marker", () => {
    const r = extractToolCalls('Panggil:\n```json\n{"name":"ls","arguments":{"dir":"."}}\n```');
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].name).toBe("ls");
  });

  it("extractToolCalls: tanpa tool -> content apa adanya", () => {
    const r = extractToolCalls("Jawaban biasa saja.");
    expect(r.calls).toHaveLength(0);
    expect(r.content).toBe("Jawaban biasa saja.");
  });

  it("flattenToolMessages: role tool & assistant.tool_calls -> teks", () => {
    const out = flattenToolMessages([
      { role: "system", content: "sys" },
      { role: "user", content: [{ type: "text", text: "halo" }] },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", function: { name: "ls", arguments: '{"d":"."}' } }] },
      { role: "tool", tool_call_id: "call_1", content: "a.py\nb.py" },
    ]);
    expect(out[0]).toEqual({ role: "system", content: "sys" });
    expect(out[1]).toEqual({ role: "user", content: "halo" });
    expect(out[2].role).toBe("assistant");
    expect(out[2].content).toContain('<<TOOL_CALL>>{"name":"ls","arguments":{"d":"."}}<</TOOL_CALL>>');
    expect(out[3].role).toBe("user");
    expect(out[3].content).toContain("[TOOL RESULT call_1]");
    expect(out[3].content).toContain("a.py");
  });
});
