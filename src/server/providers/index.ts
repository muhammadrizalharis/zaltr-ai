import type { ChatRequest, ProviderGenerator } from "./contract";
import { demoChat } from "./demo";
import { copilotChat } from "./copilot";
import { ollamaChat } from "./ollama";
import { comfyGenerate } from "./comfyui";

export type { ChatRequest, HistoryItem, ProviderGenerator, StreamPart } from "./contract";

/** Dispatch modelId "provider:model" ke provider yang tepat. */
export function dispatch(
  modelId: string,
  base: Omit<ChatRequest, "model">,
): ProviderGenerator {
  const sep = modelId.indexOf(":");
  const provider = sep === -1 ? "zaltr" : modelId.slice(0, sep);
  const model = sep === -1 ? modelId : modelId.slice(sep + 1);
  const req: ChatRequest = { ...base, model };

  switch (provider) {
    case "copilot":
      return copilotChat(req);
    case "ollama":
      return ollamaChat(req);
    case "comfyui":
      return comfyGenerate(req);
    default:
      return demoChat(req);
  }
}
