import type { ModelDescriptor } from "@/lib/types";
import { copilotCatalog } from "./providers/copilot";
import { ollamaCatalog } from "./providers/ollama";
import { comfyCatalog } from "./providers/comfyui";

export { ollamaBaseUrl } from "./providers/ollama";

/**
 * Registry model zaltr.ai — status setiap provider dicek live secara paralel:
 * - zaltr-core : demo internal, selalu tersedia.
 * - copilot    : listModels() dari runtime CLI headless; fallback kurasi bila mati.
 * - ollama     : /api/tags container zaltr-ollama.
 * - comfyui    : daftar checkpoint dari /object_info.
 */
export async function listModels(): Promise<ModelDescriptor[]> {
  const core: ModelDescriptor = {
    id: "zaltr-core",
    label: "Zaltr Core",
    provider: "zaltr",
    providerLabel: "Zaltr (demo lokal)",
    capabilities: ["chat"],
    available: true,
    local: true,
    note: "Provider demo untuk pratinjau UI — tanpa model eksternal",
  };
  const [copilot, ollama, comfy] = await Promise.all([
    copilotCatalog(),
    ollamaCatalog(),
    comfyCatalog(),
  ]);
  return [core, ...copilot, ...ollama, ...comfy];
}
