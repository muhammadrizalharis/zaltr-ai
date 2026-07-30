import { z } from "zod";
import { db } from "@/lib/db";
import { dispatch } from "@/server/providers";
import { guarded, modelAllowed, requireUser } from "@/server/auth";
import { getObjectBuffer } from "@/lib/storage";
import { extractText, fileExt, IMAGE_EXT } from "@/server/extract";
import { webSearch, formatSearchContext } from "@/server/search";
import { extractMemories, memoryContext } from "@/server/memories";
import { describeImages, isNativeVisionModel } from "@/server/vision";
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
  /** Regenerate: buat ulang jawaban untuk pesan user TERAKHIR (tanpa pesan baru). */
  regenerate: z.boolean().optional(),
});

export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  const { conversationId, modelId, web, regenerate } = parsed.data;
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
  if (me.dailyMsgLimit != null) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const sentToday = await db.message.count({
      where: {
        role: "user",
        createdAt: { gte: startOfDay },
        conversation: { userId: me.id },
      },
    });
    if (sentToday >= me.dailyMsgLimit) {
      return Response.json(
        { error: `Batas harian ${me.dailyMsgLimit} pesan tercapai — coba lagi besok` },
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
    select: { id: true, title: true },
  });
  if (!conversation) {
    return Response.json({ error: "Conversation tidak ditemukan" }, { status: 404 });
  }

  // WRITE-FIRST (kontrak README): prompt tersimpan durable SEBELUM provider jalan.
  // Kredit dipotong pada transaksi yang sama; refund otomatis bila provider failed.
  // Mode regenerate: TIDAK membuat pesan user baru — pakai pesan user terakhir.
  let userMessageId: string;
  let title = conversation.title;
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
  }

  const history = await db.message.findMany({
    where: { conversationId, status: { not: "failed" } },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
    take: 40,
  });

  // Lampiran: baca file /api/files/uploads/... di pesan terakhir, ekstrak
  // isinya untuk PROMPT saja (DB tetap menyimpan konten asli + link).
  const providerHistory: Array<{ role: string; content: string; images?: string[] }> =
    history.map((m) => ({ role: m.role, content: m.content }));
  const last = providerHistory.at(-1);
  if (last) {
    const keys = [...content.matchAll(/\]\(\/api\/files\/(uploads\/[\w./-]+)\)/g)].map(
      (m) => m[1],
    );
    const extras: string[] = [];
    const images: string[] = [];
    for (const key of keys.slice(0, 5)) {
      if (!key.startsWith(`uploads/${me.id}/`)) continue; // hanya file miliknya
      const name = key.split("/").pop() ?? key;
      try {
        const buf = await getObjectBuffer(key);
        if (IMAGE_EXT.has(fileExt(name))) {
          images.push(buf.toString("base64"));
          extras.push(`[Lampiran gambar: ${name}]`);
        } else {
          const text = await extractText(buf, name);
          extras.push(
            text
              ? `=== Isi lampiran "${name}" ===\n${text}\n=== Akhir lampiran ===`
              : `[Lampiran "${name}" tidak bisa dibaca sebagai teks]`,
          );
        }
      } catch {
        extras.push(`[Lampiran "${name}" gagal dibaca]`);
      }
    }
    if (extras.length > 0) last.content = `${last.content}\n\n${extras.join("\n\n")}`;
    if (images.length > 0) last.images = images;

    // Vision-proxy: model tanpa kemampuan gambar tetap "melihat" lewat
    // deskripsi dari model vision lokal (qwen2.5vl).
    if (images.length > 0 && !isNativeVisionModel(modelId)) {
      const desc = await describeImages(images);
      if (desc) {
        last.content += `\n\n=== Deskripsi gambar terlampir (oleh model vision lokal) ===\n${desc}\n=== Akhir deskripsi ===`;
      }
    }

    // Konteks personal: custom instructions + memori antar-percakapan.
    // Paket FREE (zaltr-core): tanpa memori/instruksi/web — konteks pendek.
    const isFree = modelId === "zaltr-core";
    const preamble: string[] = [];
    if (!isFree && me.customInstructions?.trim()) {
      preamble.push(`Instruksi pribadi dari pengguna (patuhi):\n${me.customInstructions.trim().slice(0, 2_000)}`);
    }
    const mem = isFree ? null : await memoryContext(me.id);
    if (mem) preamble.push(mem);

    // Web search (toggle "Cari web" di composer).
    if (web && !isFree) {
      try {
        const hits = await webSearch(content.split("\n")[0] || content);
        preamble.push(formatSearchContext(content.split("\n")[0] || content, hits));
      } catch {
        preamble.push("[Pencarian web gagal — jawab dari pengetahuanmu dan katakan itu.]");
      }
    }
    if (preamble.length > 0) {
      last.content = `${preamble.join("\n\n")}\n\n---\n\n${last.content}`;
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: StreamLine) =>
        controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));

      send({ type: "meta", userMessageId, conversationTitle: title });

      let acc = "";
      let status: "completed" | "stopped" | "failed" = "completed";
      try {
        const gen = dispatch(modelId, {
          history: providerHistory,
          conversationId,
          signal: req.signal,
        });
        for await (const part of gen) {
          if (part.kind === "text") {
            acc += part.text;
            send({ type: "delta", text: part.text });
          } else {
            // Gambar sudah dipersistenkan ke MinIO oleh provider;
            // simpan sebagai markdown agar ikut kontrak "chat = markdown".
            const md = `\n\n![${part.alt}](${part.url})\n`;
            acc += md;
            send({ type: "delta", text: md });
          }
        }
      } catch (err) {
        if (req.signal.aborted) {
          status = "stopped";
        } else {
          status = "failed";
          const message = err instanceof Error ? err.message : "Provider gagal";
          send({ type: "error", message });
        }
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
      await db.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      // Provider gagal bukan salah user — kembalikan kreditnya.
      if (status === "failed" && cost > 0) {
        await db.user.update({
          where: { id: me.id },
          data: { creditBalance: { increment: cost }, creditUsed: { decrement: cost } },
        });
      }

      send({ type: "done", messageId: assistant.id, content: acc, status });
      controller.close();
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
