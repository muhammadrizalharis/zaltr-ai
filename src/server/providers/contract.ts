/**
 * Kontrak provider calyzr.ai (lihat README: AI Orchestrator).
 * Semua provider menghasilkan stream StreamPart yang sudah dinormalisasi;
 * route /api/chat tidak pernah melihat format mentah Copilot/Ollama/ComfyUI.
 */

export type AttachedImage = {
  /** base64 tanpa prefix data: */
  data: string;
  mimeType: string;
  name?: string;
};

export type HistoryItem = {
  role: string;
  content: string;
  /** Lampiran gambar; dikirim apa adanya ke model yang mampu melihat gambar. */
  images?: AttachedImage[];
};

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export type ContextTier = "default" | "long_context";

export type StreamPart =
  | { kind: "text"; text: string }
  /** Gambar yang SUDAH dipersistenkan ke MinIO; url = path internal /api/files/... */
  | { kind: "image"; url: string; alt: string }
  /** Pemakaian riil provider berbayar (Copilot): nanoAiu = satuan kredit yang dipotong. */
  | { kind: "usage"; nanoAiu: number; inputTokens?: number; outputTokens?: number };

export interface ChatRequest {
  /** id model tanpa prefix provider, mis. "gpt-5.4" atau "llama3.2:3b" */
  model: string;
  history: HistoryItem[];
  conversationId: string;
  signal: AbortSignal;
  /** Thinking level (hanya dipakai model yang mendukung reasoningEffort). */
  reasoningEffort?: ReasoningEffort;
  /** Mode context window: "long_context" bila model mendukung & user memilihnya. */
  contextTier?: ContextTier;
}

export type ProviderGenerator = AsyncGenerator<StreamPart, void, unknown>;
