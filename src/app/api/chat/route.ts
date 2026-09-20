import { z } from "zod";
import { db } from "@/lib/db";
import { dispatch } from "@/server/providers";
import { guarded, modelAllowed, requireUser } from "@/server/auth";
import { getObjectBuffer } from "@/lib/storage";
import {
  extractText,
  fileExt,
  imageMime,
  IMAGE_EXT,
  MAX_CHARS_PER_FILE,
  needsFullDownload,
  isBinarySkip,
} from "@/server/extract";
import {
  parseDriveLinks,
  driveConfigured,
  listFolderTree,
  fetchDriveFile,
  driveMeta,
  formatTree,
  scoreFile,
} from "@/server/drive";
import { retrieve, formatKnowledge, countIndexed, ingestUploadOnce, listSourceNames } from "@/server/knowledge";
import { runAgent } from "@/server/agent";
import { webSearch, formatSearchContext } from "@/server/search";
import { extractMemories, memoryContext } from "@/server/memories";
import { embedMessage } from "@/server/msgsearch";
import { describeImages, isNativeVisionModel } from "@/server/vision";
import { copilotSupportsVision } from "@/server/providers/copilot";
import type { AttachedImage, HistoryItem } from "@/server/providers/contract";
import { generateTitle } from "@/server/titles";
import { isModeParafrase, promptParafrase } from "@/server/paraphrase";
import { effectiveDailyLimit } from "@/server/plans";
import { startRun, endRun } from "@/server/runs";
import type { StreamLine } from "@/lib/types";

export const runtime = "nodejs";

/** Kredit per pesan: Copilot memakai pool Enterprise -> 1 kredit; lokal gratis. */
function creditCost(modelId: string): number {
  return modelId.startsWith("copilot:") ? 1 : 0;
}

const bodySchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().trim().max(32_000).default(""),
  modelId: z.string().min(1),
  /** Toggle "Cari web" dari composer. */
  web: z.boolean().optional(),
  /** Mode parafrase dari menu "+" (kosong = chat biasa). */
  paraphrase: z.string().max(20).optional(),
  /** Regenerate: buat ulang jawaban untuk pesan user TERAKHIR (tanpa pesan baru). */
  regenerate: z.boolean().optional(),
  /** Mode agen: model boleh memakai alat (web/kode) beruntun. */
  agent: z.boolean().optional(),
});

export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  const { conversationId, modelId, web, regenerate, agent } = parsed.data;
  let content = parsed.data.content;
  if (!regenerate && !content) {
    return Response.json({ error: "Pesan kosong" }, { status: 400 });
  }

  // Kebijakan akun (diatur admin): model diizinkan? limit harian? kredit cukup?
  if (!modelAllowed(me.allowedModels, modelId)) {
    return Response.json(
      { error: "Model ini tidak diizinkan untuk akunmu — hubungi admin" },
      { status: 403 },
    );
  }
  // Limit harian: override admin menang; selain itu ikut paket
  // (free 100 / starter 1000 / plus 3000 / power tanpa batas).
  const dailyLimit = effectiveDailyLimit(me.plan, me.dailyMsgLimit);
  if (dailyLimit != null) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const sentToday = await db.message.count({
      where: {
        role: "user",
        createdAt: { gte: startOfDay },
        conversation: { userId: me.id },
      },
    });
    if (sentToday >= dailyLimit) {
      return Response.json(
        {
          error: `Batas harian paket ${me.plan} (${dailyLimit} pesan) tercapai — upgrade paket atau coba lagi besok`,
        },
        { status: 429 },
      );
    }
  }
  const cost = creditCost(modelId);
  if (cost > 0 && me.creditBalance < cost) {
    return Response.json(
      { error: "Kredit habis — hubungi admin untuk menambah kredit" },
      { status: 402 },
    );
  }

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, userId: me.id, trashedAt: null },
    select: { id: true, title: true, projectId: true, assistantId: true },
  });
  if (!conversation) {
    return Response.json({ error: "Conversation tidak ditemukan" }, { status: 404 });
  }

  // WRITE-FIRST (kontrak README): prompt tersimpan durable SEBELUM provider jalan.
  // Kredit dipotong pada transaksi yang sama; refund otomatis bila provider failed.
  // Mode regenerate: TIDAK membuat pesan user baru — pakai pesan user terakhir.
  let userMessageId: string;
  let title = conversation.title;
  let judulPromise: Promise<string | null> | null = null;
  if (regenerate) {
    const lastUser = await db.message.findFirst({
      where: { conversationId, role: "user" },
      orderBy: { createdAt: "desc" },
      select: { id: true, content: true },
    });
    if (!lastUser) {
      return Response.json({ error: "Belum ada pesan untuk diulang" }, { status: 400 });
    }
    userMessageId = lastUser.id;
    content = lastUser.content;
    await db.user.update({
      where: { id: me.id },
      data: { creditBalance: { decrement: cost }, creditUsed: { increment: cost } },
    });
  } else {
    title =
      conversation.title === "Chat baru"
        ? content.replace(/\s+/g, " ").slice(0, 60)
        : conversation.title;
    const [userMessage] = await db.$transaction([
      db.message.create({
        data: { conversationId, role: "user", content, model: modelId },
        select: { id: true },
      }),
      db.conversation.update({ where: { id: conversationId }, data: { title } }),
      db.user.update({
        where: { id: me.id },
        data: { creditBalance: { decrement: cost }, creditUsed: { increment: cost } },
      }),
    ]);
    userMessageId = userMessage.id;
    // Memori antar-percakapan: ekstrak fakta personal (async, gratis via Ollama).
    void extractMemories(me.id, content);
    void embedMessage(userMessageId, content);
    // Judul ringkas dibuat paralel dengan jawaban model; hasilnya dipastikan
    // tersimpan sebelum stream ditutup (judul potongan di atas jadi cadangan).
    if (conversation.title === "Chat baru") judulPromise = generateTitle(content);
  }

  // Ambil 40 pesan TERBARU (bukan terlama), lalu kembalikan ke urutan kronologis.
  // `asc` + `take` mengambil pesan paling awal — di percakapan panjang pesan baru
  // pengguna tidak pernah sampai ke model.
  const history = (
    await db.message.findMany({
      where: { conversationId, status: { not: "failed" } },
      orderBy: { createdAt: "desc" },
      select: { role: true, content: true },
      take: 40,
    })
  ).reverse();

  // Lampiran: baca file /api/files/uploads/... di pesan terakhir, ekstrak
  // isinya untuk PROMPT saja (DB tetap menyimpan konten asli + link).
  const providerHistory: HistoryItem[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const last = providerHistory.at(-1);
  // Sitasi RAG untuk ditampilkan di klien ([K#] -> nama sumber + cuplikan).
  const citations: Array<{ k: number; name: string; snippet: string }> = [];
  /** Peringatan untuk pengguna (mis. gambar tak terbaca), dikirim di awal stream. */
  let peringatan = "";
  if (last) {
    const keys = [...content.matchAll(/\]\(\/api\/files\/(uploads\/[\w./-]+)\)/g)].map(
      (m) => m[1],
    );
    const extras: string[] = [];
    const images: AttachedImage[] = [];
    // Pagu total teks semua lampiran (jaga context window model). Bisa diubah
    // via env ZALTR_MAX_TOTAL_CHARS. 300rb karakter ≈ 75rb token.
    let sisaBudget = Math.max(4_000, Number(process.env.ZALTR_MAX_TOTAL_CHARS) || 300_000);
    for (const key of keys.slice(0, 5)) {
      if (!key.startsWith(`uploads/${me.id}/`)) continue; // hanya file miliknya
      const name = key.split("/").pop() ?? key;
      try {
        const buf = await getObjectBuffer(key);
        if (IMAGE_EXT.has(fileExt(name))) {
          images.push({
            data: buf.toString("base64"),
            mimeType: imageMime(name),
            name,
          });
          extras.push(`[Lampiran gambar: ${name}]`);
        } else {
          const limit = Math.min(MAX_CHARS_PER_FILE, sisaBudget);
          const text = limit > 0 ? await extractText(buf, name, limit) : null;
          if (text) {
            sisaBudget -= text.length;
            // Ingest ke RAG sekali (dedupe via key) supaya dokumen ini tetap bisa
            // dirujuk di giliran berikutnya. Async — tak memblok jawaban.
            void ingestUploadOnce({ userId: me.id, key, name, text, bytes: buf.length }).catch(
              () => {},
            );
          }
          extras.push(
            text
              ? `=== Isi lampiran "${name}" ===\n${text}\n=== Akhir lampiran ===`
              : sisaBudget <= 0
                ? `[Lampiran "${name}" tidak dibaca: total teks lampiran sudah mencapai batas]`
                : `[Lampiran "${name}" tidak bisa dibaca sebagai teks]`,
          );
        }
      } catch {
        extras.push(`[Lampiran "${name}" gagal dibaca]`);
      }
    }

    // Google Drive PUBLIK: bila pengguna menempel link folder/berkas, susun
    // pohon folder + buka berkas yang relevan dgn pertanyaan (on-demand).
    // Folder dipindai dari SELURUH percakapan (konteks bertahan antar giliran);
    // link berkas langsung hanya dari pesan terakhir (sekali baca saat ditempel).
    const convoText = providerHistory.map((m) => m.content).join("\n");
    const folderRefs = parseDriveLinks(convoText).filter((r) => r.kind === "folder").slice(-2);
    const fileRefs = parseDriveLinks(content).filter((r) => r.kind === "file").slice(0, 4);
    if (folderRefs.length > 0 || fileRefs.length > 0) {
      if (!driveConfigured()) {
        extras.push(
          "[Pengguna menempel link Google Drive, tetapi pembacaan Drive belum aktif " +
            "(admin belum mengisi API key). Beri tahu pengguna dengan sopan.]",
        );
        peringatan =
          "Link Google Drive terdeteksi, tapi fitur baca Drive belum diaktifkan admin.";
      } else {
        // Teks besar (CSV/txt/jsonl) dibaca SEBAGIAN (byte awal) agar berkas GB
        // tetap terbaca tanpa membanjiri RAM; terstruktur (pdf/docx/xlsx) perlu utuh.
        const DRIVE_PARTIAL_BYTES = Math.max(
          Number(process.env.ZALTR_DRIVE_MAX_BYTES) || 0,
          MAX_CHARS_PER_FILE * 4,
          1024 * 1024,
        );
        const DRIVE_FULL_MAX = 50 * 1024 * 1024;
        const qWords = content.toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length >= 3);
        const bacaBerkas = async (node: { id: string; name: string; mimeType: string; path: string; size?: number }) => {
          if (sisaBudget <= 500) return;
          const ext = fileExt(node.name);
          if (isBinarySkip(node.name) || IMAGE_EXT.has(ext)) {
            extras.push(
              `[Berkas Drive "${node.path}" dilewati: ${IMAGE_EXT.has(ext) ? "gambar" : "biner"}, bukan teks/dokumen]`,
            );
            return;
          }
          const fullOnly = needsFullDownload(node.name);
          if (fullOnly && node.size && node.size > DRIVE_FULL_MAX) {
            extras.push(
              `[Berkas Drive "${node.path}" dilewati: format ${ext} harus utuh tapi terlalu besar (${Math.round(node.size / 1024 / 1024)} MB)]`,
            );
            return;
          }
          try {
            const { buf, name, partial } = await fetchDriveFile(
              node,
              fullOnly ? undefined : DRIVE_PARTIAL_BYTES,
            );
            const limit = Math.min(MAX_CHARS_PER_FILE, sisaBudget);
            const text = await extractText(buf, name, limit, { partial, sourceBytes: node.size });
            if (text) {
              sisaBudget -= text.length;
              const catatan = partial ? " (berkas besar — hanya bagian awal dibaca)" : "";
              extras.push(`=== Isi berkas Drive "${node.path}"${catatan} ===\n${text}\n=== Akhir berkas ===`);
            } else {
              extras.push(`[Berkas Drive "${node.path}" tidak bisa dibaca sebagai teks]`);
            }
          } catch {
            extras.push(`[Berkas Drive "${node.path}" gagal diunduh]`);
          }
        };
        for (const ref of folderRefs) {
          try {
            const { root, files, truncated } = await listFolderTree(ref.id, { maxFiles: 300 });
            const tree = formatTree(root, files, truncated);
            if (tree.length <= sisaBudget) {
              extras.push(tree);
              sisaBudget -= tree.length;
            }
            const ranked = files
              .map((f) => ({ f, s: scoreFile(f, qWords) }))
              .filter((x) => x.s > 0)
              .sort((a, b) => b.s - a.s)
              .slice(0, 6);
            for (const { f } of ranked) await bacaBerkas(f);
          } catch (e) {
            extras.push(`[Gagal membaca folder Drive: ${(e as Error).message}]`);
          }
        }
        for (const ref of fileRefs) {
          try {
            await bacaBerkas(await driveMeta(ref.id));
          } catch (e) {
            extras.push(`[Gagal membaca berkas Drive: ${(e as Error).message}]`);
          }
        }
      }
    }

    // RECALL gambar dari pesan SEBELUMNYA: sertakan lagi gambar yang diunggah
    // lebih awal agar pengguna bisa merujuknya (mis. "seperti di gambar X")
    // TANPA unggah ulang. Model vision menerima gambarnya langsung lagi; untuk
    // non-vision, deskripsi lamanya tetap ada di riwayat. Dibatasi beberapa
    // gambar terbaru (env ZALTR_MAX_CTX_IMAGES, default 6) demi context window.
    const MAX_CTX_IMAGES = Math.max(1, Number(process.env.ZALTR_MAX_CTX_IMAGES) || 6);
    const recalledImages: AttachedImage[] = [];
    if (images.length < MAX_CTX_IMAGES) {
      const seen = new Set(keys);
      const olderKeys: string[] = [];
      // Telusuri riwayat (tanpa pesan terakhir) dari yang TERBARU ke terlama.
      for (let i = history.length - 2; i >= 0 && olderKeys.length < MAX_CTX_IMAGES; i--) {
        for (const k of [
          ...history[i].content.matchAll(/\]\(\/api\/files\/(uploads\/[\w./-]+)\)/g),
        ].map((m) => m[1])) {
          const nm = k.split("/").pop() ?? k;
          if (!k.startsWith(`uploads/${me.id}/`) || !IMAGE_EXT.has(fileExt(nm)) || seen.has(k)) continue;
          seen.add(k);
          olderKeys.push(k);
        }
      }
      // Hemat token: hanya kirim ulang gambar lama bila pesan menyinggung visual
      // atau menyebut nama berkas gambarnya (tak perlu di giliran teks biasa).
      const wantsImages =
        /gambar|foto|image|picture|screenshot|tangkapan|lihat|tampak|warna|desain|diagram|grafik|chart|logo|ikon|visual|di atas/i.test(
          content,
        ) ||
        olderKeys.some((k) =>
          content.toLowerCase().includes((k.split("/").pop() ?? "").toLowerCase()),
        );
      if (wantsImages) {
        for (const k of olderKeys.slice(0, MAX_CTX_IMAGES - images.length)) {
          const nm = k.split("/").pop() ?? k;
          try {
            const buf = await getObjectBuffer(k);
            recalledImages.push({ data: buf.toString("base64"), mimeType: imageMime(nm), name: nm });
          } catch {
            /* berkas mungkin sudah dihapus (mis. sementara/ephemeral) — abaikan */
          }
        }
      }
      if (recalledImages.length > 0) {
        recalledImages.reverse(); // urutan kronologis: lama -> baru
        extras.push(
          `[Gambar dari pesan sebelumnya ikut disertakan agar bisa dirujuk kembali: ` +
            `${recalledImages.map((r) => r.name).join(", ")}. ` +
            `Kamu masih bisa melihatnya — JANGAN minta pengguna mengunggah ulang.]`,
        );
      }
    }

    if (extras.length > 0) last.content = `${last.content}\n\n${extras.join("\n\n")}`;
    const ctxImages = recalledImages.concat(images);
    if (ctxImages.length > 0) last.images = ctxImages;

    // Model yang bisa melihat gambar sendiri (Copilot vision & Ollama VL)
    // menerima gambar langsung. Sisanya dibantu model vision lokal.
    if (images.length > 0) {
      const nativeVision =
        isNativeVisionModel(modelId) ||
        (modelId.startsWith("copilot:") &&
          (await copilotSupportsVision(modelId.slice("copilot:".length))));
      if (!nativeVision) {
        const desc = await describeImages(images.map((i) => i.data));
        if (desc) {
          last.content += `\n\n=== Deskripsi gambar terlampir (oleh model vision lokal) ===\n${desc}\n=== Akhir deskripsi ===`;
        } else {
          peringatan =
            "Model ini tidak bisa membaca gambar, dan pembaca gambar cadangan sedang " +
            "tidak tersedia. Pilih model dengan badge “vision” agar gambarmu terbaca.";
          last.content +=
            "\n\n[Gambar terlampir TIDAK terbaca. Katakan terus terang kepada pengguna " +
            "bahwa kamu tidak bisa melihat gambarnya, dan sarankan memilih model bervision.]";
        }
      }
    }

    // Konteks personal: custom instructions + memori antar-percakapan.
    // Paket FREE (zaltr-core): tanpa memori/instruksi/web — konteks pendek.
    const isFree = modelId === "zaltr-core";
    // Model generasi gambar (ComfyUI) hanya butuh prompt mentah pengguna —
    // JANGAN suntikkan memori/instruksi/RAG/web (mengotori prompt & alt gambar).
    const isImageGen = modelId.startsWith("comfyui:");
    const noContext = isFree || isImageGen;
    const preamble: string[] = [];
    if (!noContext && me.customInstructions?.trim()) {
      preamble.push(`Instruksi pribadi dari pengguna (patuhi):\n${me.customInstructions.trim().slice(0, 2_000)}`);
    }
    // Instruksi khusus project (ala Claude Projects) — hanya untuk chat di dalam project.
    if (!noContext && conversation.projectId) {
      const proj = await db.project.findUnique({
        where: { id: conversation.projectId },
        select: { instructions: true },
      });
      if (proj?.instructions?.trim()) {
        preamble.push(`Instruksi khusus untuk project ini (patuhi):\n${proj.instructions.trim().slice(0, 4_000)}`);
      }
    }
    // Custom assistant (ala GPTs): instruksi khusus — DIBINGKAI sebagai instruksi
    // pengguna yang harus dipatuhi (BUKAN "berperan sebagai persona lain", yang
    // ditolak system prompt karena melindungi identitas).
    if (!noContext && conversation.assistantId) {
      const asst = await db.assistant.findUnique({
        where: { id: conversation.assistantId },
        select: { name: true, instructions: true },
      });
      if (asst?.instructions?.trim()) {
        preamble.push(
          `Instruksi khusus dari pengguna untuk asisten "${asst.name}" (patuhi):\n${asst.instructions.trim().slice(0, 8_000)}`,
        );
      }
    }
    const mem = noContext ? null : await memoryContext(me.id);
    if (mem) preamble.push(mem);

    // Web search (toggle "Cari web" di composer).
    if (web && !noContext) {
      try {
        const hits = await webSearch(content.split("\n")[0] || content);
        preamble.push(formatSearchContext(content.split("\n")[0] || content, hits));
      } catch {
        preamble.push("[Pencarian web gagal — jawab dari pengetahuanmu dan katakan itu.]");
      }
    }

    // Basis pengetahuan (RAG): ambil potongan relevan dari dokumen user/project.
    // Hanya jika user punya sumber terindeks (hindari embedding query sia-sia).
    if (!noContext) {
      try {
        if (await countIndexed(me.id, conversation.projectId, conversation.assistantId)) {
          const kb = await retrieve({
            userId: me.id,
            projectId: conversation.projectId,
            assistantId: conversation.assistantId,
            query: content,
            topK: 6,
          });
          const block = formatKnowledge(kb);
          if (block) preamble.push(block);
          for (let i = 0; i < kb.length; i++) {
            citations.push({ k: i + 1, name: kb[i].name, snippet: kb[i].content.slice(0, 240) });
          }
          // Inventaris dokumen: beri model daftar berkas terindeks agar bisa
          // menjawab pertanyaan overview / merangkum seluruh folder.
          const names = await listSourceNames({
            userId: me.id,
            projectId: conversation.projectId,
            assistantId: conversation.assistantId,
            limit: 40,
          });
          if (names.length > 0) {
            preamble.push(
              `Berkas/dokumen milik pengguna yang sudah terindeks (bisa kamu rujuk & rangkum): ` +
                `${names.join("; ")}.`,
            );
          }
        }
      } catch {
        /* KB opsional — abaikan bila gagal */
      }
    }
    if (preamble.length > 0) {
      last.content = `${preamble.join("\n\n")}\n\n---\n\n${last.content}`;
    }

    // Parafrase berlaku untuk semua paket: teks pengguna dibungkus instruksi
    // penyuntingan, sedangkan yang tersimpan di riwayat tetap teks aslinya.
    const mode = parsed.data.paraphrase;
    if (!isImageGen && mode && isModeParafrase(mode)) {
      last.content = promptParafrase(mode, last.content);
    }
  }

  const encoder = new TextEncoder();
  // Generasi TIDAK terikat koneksi browser: pindah halaman/tab tidak
  // menghentikannya. Hanya tombol Stop (POST /api/chat/stop) yang membatalkan.
  const { runId, signal } = startRun(me.id);
  let clientGone = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: StreamLine) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
        } catch {
          clientGone = true;
        }
      };

      send({ type: "meta", userMessageId, conversationTitle: title, runId, citations });
      if (peringatan) send({ type: "error", message: peringatan });

      let acc = "";
      let status: "completed" | "stopped" | "failed" = "completed";
      let errorMessage = "";
      try {
        if (agent && modelId !== "zaltr-core") {
          // Mode agen: loop ReAct (web/kode) terisolasi; chat biasa tak terpengaruh.
          for await (const chunk of runAgent({
            modelId,
            history: providerHistory,
            conversationId,
            signal,
            userId: me.id,
            projectId: conversation.projectId,
          })) {
            acc += chunk.text;
            send({ type: "delta", text: chunk.text });
          }
        } else {
          const gen = dispatch(modelId, {
            history: providerHistory,
            conversationId,
            signal,
          });
          for await (const part of gen) {
            if (part.kind === "text") {
              acc += part.text;
              send({ type: "delta", text: part.text });
            } else {
              // Gambar sudah dipersistenkan ke MinIO oleh provider;
              // simpan sebagai markdown agar ikut kontrak "chat = markdown".
              // Sanitasi alt: buang []/baris-baru agar tak memecah sintaks gambar.
              const alt = (part.alt ?? "").replace(/[\r\n[\]]+/g, " ").trim().slice(0, 120);
              const md = `\n\n![${alt}](${part.url})\n`;
              acc += md;
              send({ type: "delta", text: md });
            }
          }
        }
      } catch (err) {
        if (signal.aborted) {
          status = "stopped";
        } else {
          status = "failed";
          errorMessage = err instanceof Error ? err.message : "Provider gagal";
          send({ type: "error", message: errorMessage });
        }
      }

      // Sebagian model (mis. varian preview) menutup stream tanpa mengirim satu
      // token pun. Itu kegagalan, bukan jawaban: jangan simpan pesan kosong dan
      // jangan tagih kredit — dulu ini muncul sebagai gelembung jawaban kosong.
      if (!acc.trim()) {
        if (cost > 0) {
          await db.user.update({
            where: { id: me.id },
            data: { creditBalance: { increment: cost }, creditUsed: { decrement: cost } },
          });
        }
        if (status !== "stopped") {
          send({
            type: "error",
            message: errorMessage
              ? `Model gagal menjawab: ${errorMessage}`
              : "Model tidak mengirim jawaban apa pun — coba model lain atau kirim ulang. Kredit tidak terpotong.",
          });
        }
        send({ type: "done", messageId: "", content: "", status: status === "stopped" ? "stopped" : "failed" });
        endRun(runId);
        if (!clientGone) controller.close();
        return;
      }

      const assistant = await db.message.create({
        data: {
          conversationId,
          role: "assistant",
          content: acc,
          model: modelId,
          provider: modelId.includes(":") ? modelId.split(":")[0] : "zaltr",
          status,
        },
        select: { id: true },
      });
      if (status === "completed" && acc.trim()) void embedMessage(assistant.id, acc);
      await db.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      // Judul dari model lokal sudah berjalan sejak awal — tinggal dipanen.
      if (judulPromise) {
        const judulBaru = await judulPromise;
        if (judulBaru) {
          await db.conversation.update({
            where: { id: conversationId },
            data: { title: judulBaru },
          });
        }
      }
      // Provider gagal bukan salah user — kembalikan kreditnya.
      if (status === "failed" && cost > 0) {
        await db.user.update({
          where: { id: me.id },
          data: { creditBalance: { increment: cost }, creditUsed: { decrement: cost } },
        });
      }

      send({ type: "done", messageId: assistant.id, content: acc, status });
      endRun(runId);
      if (!clientGone) controller.close();
    },
    // Browser menutup koneksi (pindah halaman/tab/jaringan putus):
    // generasi sengaja DIBIARKAN berjalan agar jawabannya tetap tersimpan.
    cancel() {
      clientGone = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
});
