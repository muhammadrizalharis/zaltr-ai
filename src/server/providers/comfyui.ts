import { randomUUID } from "node:crypto";
import type { ModelDescriptor } from "@/lib/types";
import { putObject } from "@/lib/storage";
import type { ChatRequest, ProviderGenerator } from "./contract";

/**
 * Provider ComfyUI (README: generasi visual — kini gambar/video/audio).
 * - Endpoint diatur ZALTR_COMFYUI_URL (kosong = provider tampil disabled).
 * - Instalasi server GPU memakai model SPLIT (bukan checkpoint tunggal):
 *   FLUX.2 dev (UNET+CLIP+VAE+LoRA turbo), Wan 2.2 (video), ACE-Step (audio).
 *   Karena itu katalog = daftar KURASI (id stabil), bukan hasil scan file.
 * - Alur: POST /prompt -> poll /history/<id> -> unduh /view -> persist MinIO
 *   -> pesan assistant markdown (renderer mendeteksi ekstensi video/audio).
 */

const COMFY_URL = (process.env.ZALTR_COMFYUI_URL ?? "").replace(/\/$/, "");

export function comfyBaseUrl(): string {
  return COMFY_URL;
}

/** File model terpasang di server ComfyUI (dicek saat katalog). */
const FLUX_UNET = "flux2_dev_fp8mixed.safetensors";
const FLUX_CLIP = "mistral_3_small_flux2_fp8.safetensors";
const FLUX_VAE = "flux2-vae.safetensors";
const FLUX_LORA = "Flux2TurboComfyv2.safetensors";
const WAN_UNET = "wan2.2_ti2v_5B_fp16.safetensors";
const WAN_CLIP = "umt5_xxl_fp8_e4m3fn_scaled.safetensors";
const WAN_VAE = "wan2.2_vae.safetensors";
const ACE_CKPT = "ace_step_v1_3.5b.safetensors";

type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

type CuratedModel = {
  id: string;
  label: string;
  capabilities: ModelDescriptor["capabilities"];
  note: string;
  /** node loader yang harus punya file ini agar model dianggap tersedia */
  requires: { node: string; field: string; file: string };
  build: (prompt: string, seed: number) => Workflow;
  /** batas tunggu render (ms) */
  timeoutMs: number;
};

/** Workflow FLUX.2 dev + LoRA turbo (8 step, guidance 4) — teks ke gambar. */
function fluxWorkflow(prompt: string, seed: number): Workflow {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: FLUX_UNET, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: FLUX_CLIP, type: "flux2" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: FLUX_VAE } },
    "4": {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["1", 0], lora_name: FLUX_LORA, strength_model: 1 },
    },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "6": { class_type: "FluxGuidance", inputs: { conditioning: ["5", 0], guidance: 4 } },
    "7": {
      class_type: "EmptyFlux2LatentImage",
      inputs: { width: 1024, height: 1024, batch_size: 1 },
    },
    "8": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    "9": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "10": { class_type: "Flux2Scheduler", inputs: { steps: 8, width: 1024, height: 1024 } },
    "11": { class_type: "BasicGuider", inputs: { model: ["4", 0], conditioning: ["6", 0] } },
    "12": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["8", 0],
        guider: ["11", 0],
        sampler: ["9", 0],
        sigmas: ["10", 0],
        latent_image: ["7", 0],
      },
    },
    "13": { class_type: "VAEDecode", inputs: { samples: ["12", 0], vae: ["3", 0] } },
    "14": { class_type: "SaveImage", inputs: { images: ["13", 0], filename_prefix: "zaltr" } },
  };
}

/** Workflow Wan 2.2 TI2V 5B — teks ke video pendek (~3 dtk, 24 fps, 640x480). */
function wanWorkflow(prompt: string, seed: number): Workflow {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: WAN_UNET, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: WAN_CLIP, type: "wan" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: WAN_VAE } },
    "4": { class_type: "ModelSamplingSD3", inputs: { model: ["1", 0], shift: 8 } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: "blurry, distorted, low quality, watermark" },
    },
    "7": {
      class_type: "Wan22ImageToVideoLatent",
      inputs: { vae: ["3", 0], width: 640, height: 480, length: 73, batch_size: 1 },
    },
    "8": {
      class_type: "KSampler",
      inputs: {
        model: ["4", 0],
        positive: ["5", 0],
        negative: ["6", 0],
        latent_image: ["7", 0],
        seed,
        steps: 20,
        cfg: 5,
        sampler_name: "uni_pc",
        scheduler: "simple",
        denoise: 1,
      },
    },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "CreateVideo", inputs: { images: ["9", 0], fps: 24 } },
    "11": {
      class_type: "SaveVideo",
      inputs: { video: ["10", 0], filename_prefix: "zaltr", format: "mp4", codec: "h264" },
    },
  };
}

/** Workflow ACE-Step 3.5B — teks (tags genre/mood) ke musik 30 dtk. */
function aceWorkflow(prompt: string, seed: number): Workflow {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ACE_CKPT } },
    "2": {
      class_type: "TextEncodeAceStepAudio",
      inputs: { clip: ["1", 1], tags: prompt, lyrics: "", lyrics_strength: 1 },
    },
    "3": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["2", 0] } },
    "4": { class_type: "EmptyAceStepLatentAudio", inputs: { seconds: 30, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
        seed,
        steps: 27,
        cfg: 5,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1,
      },
    },
    "6": { class_type: "VAEDecodeAudio", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": {
      class_type: "SaveAudioMP3",
      inputs: { audio: ["6", 0], filename_prefix: "zaltr", quality: "320k" },
    },
  };
}

const CURATED: CuratedModel[] = [
  {
    id: "flux2-image",
    label: "FLUX.2 dev (gambar)",
    capabilities: ["image"],
    note: "Teks ke gambar 1024x1024, LoRA turbo 8 step",
    requires: { node: "UNETLoader", field: "unet_name", file: FLUX_UNET },
    build: fluxWorkflow,
    timeoutMs: 5 * 60_000,
  },
  {
    id: "wan22-video",
    label: "Wan 2.2 (video)",
    capabilities: ["image"],
    note: "Teks ke video ~3 detik 640x480 24fps (bisa beberapa menit)",
    requires: { node: "UNETLoader", field: "unet_name", file: WAN_UNET },
    build: wanWorkflow,
    timeoutMs: 15 * 60_000,
  },
  {
    id: "acestep-audio",
    label: "ACE-Step (musik/audio)",
    capabilities: ["image"],
    note: "Teks (genre/mood/instrumen) ke musik 30 detik",
    requires: { node: "CheckpointLoaderSimple", field: "ckpt_name", file: ACE_CKPT },
    build: aceWorkflow,
    timeoutMs: 10 * 60_000,
  },
];

export async function comfyCatalog(): Promise<ModelDescriptor[]> {
  const base = {
    provider: "comfyui" as const,
    providerLabel: "Zaltr Studio",
    local: true,
  };
  if (!COMFY_URL) {
    return [
      {
        ...base,
        id: "comfyui:offline",
        label: "ComfyUI belum terhubung",
        capabilities: ["image"] as ModelDescriptor["capabilities"],
        available: false,
        note: "Studio sedang offline",
      },
    ];
  }
  try {
    // Satu fetch object_info penuh untuk memeriksa file semua model kurasi.
    const res = await fetch(`${COMFY_URL}/object_info`, {
      signal: AbortSignal.timeout(2_500),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
    const info = (await res.json()) as Record<
      string,
      { input?: { required?: Record<string, [unknown]> } }
    >;
    const hasFile = (node: string, field: string, file: string) => {
      const opts = info[node]?.input?.required?.[field]?.[0];
      return Array.isArray(opts) && opts.includes(file);
    };
    return CURATED.map((m) => {
      const ok = hasFile(m.requires.node, m.requires.field, m.requires.file);
      return {
        ...base,
        id: `comfyui:${m.id}`,
        label: m.label,
        capabilities: m.capabilities,
        available: ok,
        note: ok ? m.note : `File ${m.requires.file} tidak ditemukan di ComfyUI`,
      };
    });
  } catch {
    return [
      {
        ...base,
        id: "comfyui:offline",
        label: "ComfyUI offline",
        capabilities: ["image"] as ModelDescriptor["capabilities"],
        available: false,
        note: "Studio sedang offline",
      },
    ];
  }
}

type HistoryOutput = { filename: string; subfolder: string; type: string };

export async function* comfyGenerate(req: ChatRequest): ProviderGenerator {
  if (!COMFY_URL) {
    throw new Error("ComfyUI belum terhubung. Isi ZALTR_COMFYUI_URL di .env.");
  }
  const curated = CURATED.find((m) => m.id === req.model);
  if (!curated) {
    throw new Error(`Model ComfyUI tidak dikenal: ${req.model}`);
  }
  const prompt = req.history.at(-1)?.content ?? "";
  const clientId = randomUUID();
  const seed = Math.floor(Math.random() * 2 ** 32);

  yield { kind: "text", text: `Membuat media dengan **${curated.label}**…\n\n` };

  const submit = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: curated.build(prompt, seed), client_id: clientId }),
    signal: req.signal,
  });
  if (!submit.ok) {
    const body = await submit.text().catch(() => "");
    throw new Error(`ComfyUI menolak workflow (${submit.status}): ${body.slice(0, 300)}`);
  }
  const { prompt_id: promptId } = (await submit.json()) as { prompt_id: string };

  // Poll history sampai selesai (interval 1.5s, batas sesuai model).
  const deadline = Date.now() + curated.timeoutMs;
  let outputs: HistoryOutput[] = [];
  for (;;) {
    if (req.signal.aborted) {
      await fetch(`${COMFY_URL}/interrupt`, { method: "POST" }).catch(() => {});
      throw new Error("aborted");
    }
    if (Date.now() > deadline) {
      await fetch(`${COMFY_URL}/interrupt`, { method: "POST" }).catch(() => {});
      throw new Error(`ComfyUI timeout (${Math.round(curated.timeoutMs / 60_000)} menit)`);
    }
    const res = await fetch(`${COMFY_URL}/history/${promptId}`, {
      cache: "no-store",
      signal: req.signal,
    });
    if (res.ok) {
      const hist = (await res.json()) as Record<
        string,
        {
          status?: { status_str?: string; completed?: boolean };
          outputs?: Record<
            string,
            { images?: HistoryOutput[]; video?: HistoryOutput[]; audio?: HistoryOutput[] }
          >;
        }
      >;
      const entry = hist[promptId];
      if (entry?.status?.status_str === "error") {
        throw new Error("ComfyUI gagal mengeksekusi workflow (cek log ComfyUI)");
      }
      if (entry?.outputs) {
        outputs = Object.values(entry.outputs).flatMap((o) => [
          ...(o.images ?? []),
          ...(o.video ?? []),
          ...(o.audio ?? []),
        ]);
        if (outputs.length > 0) break;
      }
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }

  const MIME: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    flac: "audio/flac",
    wav: "audio/wav",
    opus: "audio/ogg",
  };

  // Unduh tiap hasil lalu persist ke MinIO (write-first sebelum ditampilkan).
  for (const out of outputs) {
    const qs = new URLSearchParams({
      filename: out.filename,
      subfolder: out.subfolder,
      type: out.type,
    });
    const dl = await fetch(`${COMFY_URL}/view?${qs}`, { signal: req.signal });
    if (!dl.ok) throw new Error(`Gagal mengunduh hasil (${dl.status})`);
    const buf = Buffer.from(await dl.arrayBuffer());
    const ext = (out.filename.split(".").pop() || "png").toLowerCase();
    const key = `comfy/${req.conversationId}/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    await putObject(key, buf, MIME[ext] ?? "application/octet-stream");
    // Semua jenis media dikirim sebagai part image; renderer web mendeteksi
    // ekstensi url dan menampilkan <video>/<audio> bila perlu.
    yield { kind: "image", url: `/api/files/${key}`, alt: prompt.slice(0, 120) };
  }
}
