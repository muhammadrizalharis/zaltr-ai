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
