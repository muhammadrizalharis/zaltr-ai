export type ProviderId = "zaltr" | "copilot" | "ollama";

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
}

export interface ConversationSummary {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string | null;
  status?: string;
  createdAt: string;
}

/** Baris protokol stream JSONL dari /api/chat */
export type StreamLine =
  | { type: "meta"; userMessageId: string; conversationTitle: string }
  | { type: "delta"; text: string }
  | { type: "done"; messageId: string; content: string; status: "completed" | "stopped" | "failed" }
  | { type: "error"; message: string };
