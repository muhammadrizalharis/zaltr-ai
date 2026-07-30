/**
 * Vision-proxy: model teks (Copilot GPT/Claude/Gemini, ollama non-vision)
 * tetap bisa "melihat" gambar — gambar dideskripsikan dulu oleh model vision
 * lokal (qwen2.5vl via Ollama), deskripsinya disuntik ke prompt.
 */

const OLLAMA_URL = process.env.ZALTR_OLLAMA_URL ?? "http://127.0.0.1:46434";
const VISION_MODEL = process.env.ZALTR_VISION_MODEL ?? "qwen2.5vl:latest";

/** Model yang bisa menerima gambar langsung (tanpa proxy). */
export function isNativeVisionModel(modelId: string): boolean {
  return modelId.startsWith("ollama:") && /vl|vision|llava/i.test(modelId);
}

export async function describeImages(imagesBase64: string[]): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: VISION_MODEL,
        stream: false,
        keep_alive: "10m",
        messages: [
          {
            role: "user",
            content:
              "Deskripsikan gambar berikut secara detail dan objektif dalam Bahasa " +
              "Indonesia: objek, teks yang terbaca, warna, tata letak, dan konteks. " +
              "Bila lebih dari satu gambar, beri nomor.",
            images: imagesBase64.slice(0, 3),
          },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    const text = (data.message?.content ?? "").trim();
    return text ? text.slice(0, 4_000) : null;
  } catch {
    return null;
  }
}
