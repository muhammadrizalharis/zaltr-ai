import type { ModelDescriptor } from "@/lib/types";

const OLLAMA_URL = process.env.ZALTR_OLLAMA_URL ?? "http://127.0.0.1:46434";

/**
 * Registry model fase preview.
 * - zaltr-core: provider demo internal, selalu tersedia (untuk melihat UI/streaming).
 * - copilot: terdaftar tetapi disabled sampai secrets/copilot_github_token diisi
 *   dan profile `ai` dinyalakan (fase berikut, lihat README).
 * - ollama: dibaca live dari container zaltr-ollama (profile gpu) bila hidup.
 */
export async function listModels(): Promise<ModelDescriptor[]> {
  const models: ModelDescriptor[] = [
    {
      id: "zaltr-core",
      label: "Zaltr Core",
      provider: "zaltr",
      providerLabel: "Zaltr (demo lokal)",
      capabilities: ["chat"],
      available: true,
      local: true,
      note: "Provider demo untuk pratinjau UI — tanpa model eksternal",
    },
    ...copilotCatalog(),
    ...(await ollamaCatalog()),
  ];
  return models;
}

function copilotCatalog(): ModelDescriptor[] {
  const note = "Menunggu token service account (profile ai belum aktif)";
  const defs: Array<[string, string, ModelDescriptor["capabilities"]]> = [
    ["gpt-5.4", "GPT-5.4", ["chat", "vision", "tools"]],
    ["claude-sonnet-4.6", "Claude Sonnet 4.6", ["chat", "vision", "reasoning", "tools"]],
    ["gemini-3-flash", "Gemini 3 Flash", ["chat", "vision"]],
  ];
  return defs.map(([id, label, capabilities]) => ({
    id: `copilot:${id}`,
    label,
    provider: "copilot" as const,
    providerLabel: "GitHub Copilot Enterprise",
    capabilities,
    available: false,
    local: false,
    note,
  }));
}

async function ollamaCatalog(): Promise<ModelDescriptor[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(500),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => ({
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

export function ollamaBaseUrl(): string {
  return OLLAMA_URL;
}
