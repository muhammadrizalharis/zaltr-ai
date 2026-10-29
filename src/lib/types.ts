export type ProviderId = "zaltr" | "copilot" | "ollama" | "comfyui";

export type Capability = "chat" | "vision" | "reasoning" | "tools" | "image";

export interface ModelDescriptor {
  id: string;
  label: string;
  provider: ProviderId;
  providerLabel: string;
  capabilities: Capability[];
  available: boolean;
  local: boolean;
  note?: string;
  /** Freemium: model di luar paket akun — terlihat tapi tak bisa dipilih. */
  locked?: boolean;
  /** Ukuran context window asli model (token); dari katalog Copilot. */
  contextWindow?: number;
  /** True bila model mendukung pengaturan thinking level (reasoningEffort). */
  supportsReasoning?: boolean;
  /** Daftar level thinking yang didukung model (dari katalog Copilot). */
  reasoningEfforts?: string[];
  /** Multiplier biaya Copilot relatif ke base rate (untuk info kredit). */
  costMultiplier?: number;
  /** Rincian harga kredit per batch token (input/output/cache), tier default. */
  pricing?: {
    /** Jumlah token per batch penagihan (biasanya 1.000.000). */
    batchSize?: number;
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  /** Harga kredit untuk tier long-context (bila berbeda dari default). */
  pricingLongContext?: {
    batchSize?: number;
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

export interface ProjectSummary {
  id: string;
  name: string;
  count: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  pinned: boolean;
  projectId: string | null;
  updatedAt: string;
}

export type Citation = { k: number; name: string; snippet: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string | null;
  status?: string;
  createdAt: string;
  citations?: Citation[];
}

/** Baris protokol stream JSONL dari /api/chat */
export type StreamLine =
  | { type: "meta"; userMessageId: string; conversationTitle: string; runId: string; citations?: Citation[] }
  | { type: "delta"; text: string }
  /** Langkah alat agen (UI-only, tidak dipersist): mis. "Menjalankan kode Python…". */
  | { type: "step"; text: string }
  | { type: "done"; messageId: string; content: string; status: "completed" | "stopped" | "failed" }
  | { type: "error"; message: string };
