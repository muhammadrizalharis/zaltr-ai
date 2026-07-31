import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import type { ModelDescriptor } from "@/lib/types";
import type { ChatRequest, ProviderGenerator, StreamPart } from "./contract";

/**
 * Provider GitHub Copilot Enterprise (README §C):
 * - SDK resmi @github/copilot-sdk -> Copilot CLI headless (container
 *   zaltr-copilot-runtime, profile "ai"), token service account via Docker secret.
 * - mode "empty": fitur/tool opsional mati; sesi chat murni tanpa akses tool.
 * - Sesi CLI di-persist per conversation (sessionId = id conversation) sehingga
 *   konteks berlanjut tanpa mengirim ulang seluruh riwayat.
 */

const COPILOT_URL = process.env.ZALTR_COPILOT_URL ?? "127.0.0.1:46321";

const globalForCopilot = globalThis as unknown as {
  zaltrCopilot?: { client: CopilotClient; ready: Promise<unknown> };
};

/**
 * Klien SDK singleton. `start()` wajib dipanggil sebelum RPC apa pun
 * (tanpa itu SDK selalu melempar "Client not connected"). Bila start
 * gagal (runtime mati), cache dibuang supaya request berikut mencoba lagi.
 */
async function client(): Promise<CopilotClient> {
  if (!globalForCopilot.zaltrCopilot) {
    const c = new CopilotClient({
      connection: RuntimeConnection.forUri(COPILOT_URL),
      mode: "empty",
    });
    const entry = {
      client: c,
      ready: c.start().catch((err: unknown) => {
        if (globalForCopilot.zaltrCopilot === entry) {
          globalForCopilot.zaltrCopilot = undefined;
        }
        throw err;
      }),
    };
    globalForCopilot.zaltrCopilot = entry;
  }
  const entry = globalForCopilot.zaltrCopilot;
  await entry.ready;
  // Runtime bisa saja direstart; koneksi mati -> buang cache dan sambung ulang.
  try {
    await entry.client.ping();
  } catch {
    globalForCopilot.zaltrCopilot = undefined;
    await entry.client.forceStop().catch(() => {});
    return client();
  }
  return entry.client;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("copilot runtime timeout")), ms),
    ),
  ]);
}

/** Daftar kurasi saat runtime mati — id harus id model Copilot yang valid. */
const FALLBACK_MODELS: Array<[string, string, ModelDescriptor["capabilities"]]> = [
  ["gpt-5.4", "GPT-5.4", ["chat", "vision", "tools"]],
  ["claude-sonnet-4.6", "Claude Sonnet 4.6", ["chat", "vision", "reasoning", "tools"]],
  ["gemini-3-flash", "Gemini 3 Flash", ["chat", "vision"]],
];

export async function copilotCatalog(): Promise<ModelDescriptor[]> {
  try {
    const models = await withTimeout(
      client().then((c) => c.listModels()),
      3_000,
    );
    return models.map((m) => ({
      id: `copilot:${m.id}`,
      label: m.name || m.id,
      provider: "copilot" as const,
      providerLabel: "Calyzr Pro",
      capabilities: ["chat"] as ModelDescriptor["capabilities"],
      available: true,
      local: false,
    }));
  } catch {
    return FALLBACK_MODELS.map(([id, label, capabilities]) => ({
      id: `copilot:${id}`,
      label,
      provider: "copilot" as const,
      providerLabel: "Calyzr Pro",
      capabilities,
      available: false,
      local: false,
      note: "Sedang offline — coba lagi nanti",
    }));
  }
}

import { SYSTEM_MESSAGE } from "./prompt";

export async function* copilotChat(req: ChatRequest): ProviderGenerator {
  const c = await client();
  const sessionId = `zaltr-${req.conversationId}`;

  // Resume sesi CLI milik conversation ini; bila belum ada, buat baru.
  let session;
  let created = false;
  try {
    session = await c.resumeSession(sessionId, {});
  } catch {
    session = await c.createSession({
      sessionId,
      model: req.model,
      streaming: true,
      systemMessage: { content: SYSTEM_MESSAGE },
      // mode "empty" + tanpa tool: deny-by-default sesuai README.
      availableTools: [],
    });
    created = true;
  }

  // Bridge event SDK -> async generator.
  const queue: StreamPart[] = [];
  let finished = false;
  let failure: Error | null = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };

  const unsubscribe = session.on((event) => {
    if (event.type === "assistant.message_delta") {
      queue.push({ kind: "text", text: event.data.deltaContent });
      notify();
    } else if (event.type === "session.error") {
      const data = event.data as { message?: string };
      failure = new Error(data.message ?? "Copilot session error");
      finished = true;
      notify();
    } else if (event.type === "session.idle") {
      finished = true;
      notify();
    }
  });

  const onAbort = () => {
    void session.abort().catch(() => {});
    finished = true;
    notify();
  };
  req.signal.addEventListener("abort", onAbort, { once: true });

  try {
    const last = req.history.at(-1)?.content ?? "";
    // Sesi baru untuk conversation lama: sisipkan ringkasan riwayat sekali saja.
    const prompt =
      created && req.history.length > 1
        ? `Riwayat percakapan sebelumnya:\n\n${req.history
            .slice(0, -1)
            .slice(-20)
            .map((m) => `${m.role === "user" ? "Pengguna" : "Asisten"}: ${m.content}`)
            .join("\n\n")}\n\n---\n\nPesan baru pengguna:\n${last}`
        : last;

    await session.send({ prompt });

    while (!finished || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }
      const part = queue.shift()!;
      yield part;
    }
    if (failure) throw failure;
    if (req.signal.aborted) throw new Error("aborted");
  } finally {
    unsubscribe();
    req.signal.removeEventListener("abort", onAbort);
    // Lepas koneksi tanpa menghapus sesi — konteks CLI tetap tersimpan.
    await session.disconnect().catch(() => {});
  }
}
