import type { ModelDescriptor } from "@/lib/types";
import type { ChatRequest, ProviderGenerator } from "./contract";

const OLLAMA_URL = process.env.ZALTR_OLLAMA_URL ?? "http://127.0.0.1:46434";

export function ollamaBaseUrl(): string {
  return OLLAMA_URL;
}

/** Katalog live dari /api/tags; offline -> satu entri disabled dengan petunjuk. */
export async function ollamaCatalog(): Promise<ModelDescriptor[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(800),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = data.models ?? [];
    if (models.length === 0) {
      return [
        {
          id: "ollama:kosong",
          label: "Belum ada model",
          provider: "ollama",
          providerLabel: "Ollama (zaltr)",
          capabilities: ["chat"],
          available: false,
          local: true,
          note: "Tarik model: sudo docker exec zaltr-ollama ollama pull llama3.2",
        },
      ];
    }
    return models.map((m) => ({
      id: `ollama:${m.name}`,
      label: m.name,
      provider: "ollama" as const,
      providerLabel: "Ollama (zaltr)",
      capabilities: ["chat"] as ModelDescriptor["capabilities"],
      available: true,
      local: true,
    }));
  } catch {
    return [
      {
        id: "ollama:offline",
        label: "Ollama offline",
        provider: "ollama",
        providerLabel: "Ollama (zaltr)",
        capabilities: ["chat"],
        available: false,
        local: true,
        note: "Nyalakan dengan: bin/zaltrctl up gpu",
      },
    ];
  }
}

/** Chat streaming Ollama /api/chat (JSONL). */
export async function* ollamaChat(req: ChatRequest): ProviderGenerator {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: req.model,
      stream: true,
      // Ollama tetap hangat 10 menit agar pergantian pesan tidak reload model.
      keep_alive: "10m",
      messages: req.history.map((m) => ({ role: m.role, content: m.content })),
    }),
    signal: req.signal,
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
      const data = JSON.parse(line) as {
        message?: { content?: string };
        done?: boolean;
        error?: string;
      };
      if (data.error) throw new Error(`Ollama: ${data.error}`);
      const text = data.message?.content;
      if (text) yield { kind: "text", text };
    }
  }
}
