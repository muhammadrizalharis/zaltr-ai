import { randomUUID } from "node:crypto";
import type { ModelDescriptor } from "@/lib/types";
import { putObject } from "@/lib/storage";
import type { ChatRequest, ProviderGenerator } from "./contract";

/**
 * Provider ComfyUI (README: generasi visual).
 * - Endpoint diatur ZALTR_COMFYUI_URL (kosong = provider tampil disabled).
 * - Alur: POST /prompt (workflow text2img) -> poll /history/<id> -> unduh
 *   gambar -> persist ke MinIO (kontrak: hasil ikut backup harian) ->
 *   pesan assistant berisi markdown ![](/api/files/...).
 */

const COMFY_URL = (process.env.ZALTR_COMFYUI_URL ?? "").replace(/\/$/, "");

export function comfyBaseUrl(): string {
  return COMFY_URL;
}

export async function comfyCatalog(): Promise<ModelDescriptor[]> {
  const base: Omit<ModelDescriptor, "id" | "label" | "available" | "note"> = {
    provider: "comfyui",
    providerLabel: "ComfyUI (gambar)",
    capabilities: ["image"],
    local: true,
  };
  if (!COMFY_URL) {
    return [
      {
        ...base,
        id: "comfyui:offline",
        label: "ComfyUI belum terhubung",
        available: false,
        note: "Isi ZALTR_COMFYUI_URL di .env lalu restart web",
      },
    ];
  }
  try {
    const res = await fetch(`${COMFY_URL}/object_info/CheckpointLoaderSimple`, {
      signal: AbortSignal.timeout(1_200),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as {
      CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } };
    };
    const ckpts = data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
    if (ckpts.length === 0) {
      return [
        {
          ...base,
          id: "comfyui:tanpa-checkpoint",
          label: "Tanpa checkpoint",
          available: false,
          note: "Taruh model .safetensors di folder checkpoints ComfyUI",
        },
      ];
    }
    return ckpts.map((name) => ({
      ...base,
      id: `comfyui:${name}`,
      label: name.replace(/\.(safetensors|ckpt)$/i, ""),
      available: true,
    }));
  } catch {
    return [
      {
        ...base,
        id: "comfyui:offline",
        label: "ComfyUI offline",
        available: false,
        note: `Tidak bisa menghubungi ${COMFY_URL}`,
      },
    ];
  }
}

/** Workflow text2img minimal (API format) — checkpoint dari id model. */
function buildWorkflow(ckpt: string, prompt: string, seed: number) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt } },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 1], text: prompt },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 1], text: "blurry, low quality, watermark, text" },
    },
    "4": {
      class_type: "EmptyLatentImage",
      inputs: { width: 1024, height: 1024, batch_size: 1 },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
        seed,
        steps: 25,
        cfg: 6.5,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": {
      class_type: "SaveImage",
      inputs: { images: ["6", 0], filename_prefix: "zaltr" },
    },
  };
}

export async function* comfyGenerate(req: ChatRequest): ProviderGenerator {
  if (!COMFY_URL) {
    throw new Error("ComfyUI belum terhubung. Isi ZALTR_COMFYUI_URL di .env.");
  }
  const prompt = req.history.at(-1)?.content ?? "";
  const clientId = randomUUID();
  const seed = Math.floor(Math.random() * 2 ** 32);

  yield { kind: "text", text: `Membuat gambar dengan **${req.model}**…\n\n` };

  const submit = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: buildWorkflow(req.model, prompt, seed), client_id: clientId }),
    signal: req.signal,
  });
  if (!submit.ok) {
    const body = await submit.text().catch(() => "");
    throw new Error(`ComfyUI menolak workflow (${submit.status}): ${body.slice(0, 300)}`);
  }
  const { prompt_id: promptId } = (await submit.json()) as { prompt_id: string };

  // Poll history sampai selesai (interval 1s, batas 5 menit).
  const deadline = Date.now() + 5 * 60_000;
  let images: Array<{ filename: string; subfolder: string; type: string }> = [];
  for (;;) {
    if (req.signal.aborted) {
      await fetch(`${COMFY_URL}/interrupt`, { method: "POST" }).catch(() => {});
      throw new Error("aborted");
    }
    if (Date.now() > deadline) throw new Error("ComfyUI timeout (5 menit)");
    const res = await fetch(`${COMFY_URL}/history/${promptId}`, {
      cache: "no-store",
      signal: req.signal,
    });
    if (res.ok) {
      const hist = (await res.json()) as Record<
        string,
        {
          status?: { status_str?: string; completed?: boolean };
          outputs?: Record<string, { images?: typeof images }>;
        }
      >;
      const entry = hist[promptId];
      if (entry?.status?.status_str === "error") {
        throw new Error("ComfyUI gagal mengeksekusi workflow (cek log ComfyUI)");
      }
      if (entry?.outputs) {
        images = Object.values(entry.outputs).flatMap((o) => o.images ?? []);
        if (images.length > 0) break;
      }
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }

  // Unduh tiap gambar lalu persist ke MinIO (write-first sebelum ditampilkan).
  for (const img of images) {
    const qs = new URLSearchParams({
      filename: img.filename,
      subfolder: img.subfolder,
      type: img.type,
    });
    const dl = await fetch(`${COMFY_URL}/view?${qs}`, { signal: req.signal });
    if (!dl.ok) throw new Error(`Gagal mengunduh hasil (${dl.status})`);
    const buf = Buffer.from(await dl.arrayBuffer());
    const ext = img.filename.split(".").pop() || "png";
    const key = `comfy/${req.conversationId}/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    await putObject(key, buf, ext === "png" ? "image/png" : "image/jpeg");
    yield { kind: "image", url: `/api/files/${key}`, alt: prompt.slice(0, 120) };
  }
}
