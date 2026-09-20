/**
 * Tugas terjadwal (ala ChatGPT Tasks): jalankan prompt user secara otomatis
 * berkala. Hasilnya disimpan sebagai percakapan baru sehingga muncul di daftar
 * chat user. Penjadwal berjalan in-process (instrumentation.ts).
 */

import { db } from "@/lib/db";
import { dispatch } from "@/server/providers";
import type { HistoryItem } from "@/server/providers";
import { cleanupStaleEphemeral } from "@/server/uploads";
import { sendToUser } from "@/server/push";

function creditCost(modelId: string): number {
  return modelId.startsWith("copilot:") ? 1 : 0;
}

/** Jalankan SATU tugas sekarang: generate jawaban + simpan sebagai percakapan. */
export async function runTask(taskId: string): Promise<{ ok: boolean; conversationId?: string; note?: string }> {
  const task = await db.scheduledTask.findUnique({
    where: { id: taskId },
    select: { id: true, userId: true, title: true, prompt: true, model: true },
  });
  if (!task) return { ok: false, note: "tugas tidak ada" };
  const user = await db.user.findUnique({
    where: { id: task.userId },
    select: { status: true, creditBalance: true },
  });
  if (!user || user.status !== "active") return { ok: false, note: "user tidak aktif" };
  const cost = creditCost(task.model);
  if (cost > 0 && user.creditBalance < cost) {
    await db.scheduledTask.update({
      where: { id: taskId },
      data: { lastRunAt: new Date(), lastResult: "(dilewati: kredit habis)" },
    });
    return { ok: false, note: "kredit habis" };
  }

  const conv = await db.conversation.create({
    data: { title: (task.title || "Tugas terjadwal").slice(0, 60), userId: task.userId },
    select: { id: true },
  });
  const history: HistoryItem[] = [{ role: "user", content: task.prompt }];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  let acc = "";
  try {
    const gen = dispatch(task.model, { history, conversationId: conv.id, signal: controller.signal });
    for await (const part of gen) {
      if (part.kind === "text") acc += part.text;
      else if (part.kind === "image") acc += `\n\n![](${part.url})`;
    }
  } catch (e) {
    acc = `(gagal menjalankan: ${(e as Error).message.slice(0, 200)})`;
  } finally {
    clearTimeout(timeout);
  }
  if (!acc.trim()) acc = "(tidak ada jawaban)";

  await db.$transaction([
    db.message.create({ data: { conversationId: conv.id, role: "user", content: task.prompt, model: task.model } }),
    db.message.create({ data: { conversationId: conv.id, role: "assistant", content: acc, model: task.model } }),
    ...(cost > 0
      ? [
          db.user.update({
            where: { id: task.userId },
            data: { creditBalance: { decrement: cost }, creditUsed: { increment: cost } },
          }),
        ]
      : []),
    db.scheduledTask.update({
      where: { id: taskId },
      data: { lastRunAt: new Date(), lastResult: acc.slice(0, 500) },
    }),
  ]);
  // Notifikasi Web Push: beri tahu user tugas selesai (async, tak memblok).
  void sendToUser(task.userId, {
    title: `Tugas selesai: ${task.title || "Terjadwal"}`,
    body: acc.replace(/\s+/g, " ").slice(0, 120),
    url: `/chat/${conv.id}`,
    tag: `task-${taskId}`,
  }).catch(() => {});
  return { ok: true, conversationId: conv.id };
}

let running = false;

/** Cari tugas yang jatuh tempo, reschedule, lalu jalankan. */
export async function runDueTasks(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await db.scheduledTask.findMany({
      where: { active: true, nextRunAt: { lte: new Date() } },
      take: 5,
      select: { id: true, intervalMinutes: true },
    });
    if (due.length) console.log(`[scheduler] ${due.length} tugas jatuh tempo, menjalankan…`);
    for (const t of due) {
      // Reschedule DULU (hindari eksekusi ganda bila runTask lambat).
      await db.scheduledTask.update({
        where: { id: t.id },
        data: { nextRunAt: new Date(Date.now() + Math.max(1, t.intervalMinutes) * 60_000) },
      });
      await runTask(t.id);
    }
  } catch (e) {
    console.error("[scheduler] error:", (e as Error).message);
  } finally {
    running = false;
  }
}

let started = false;

/** Mulai penjadwal in-process (dipanggil sekali dari instrumentation). */
export function startScheduler(): void {
  if (started) return;
  started = true;
  console.log("[scheduler] tugas terjadwal aktif (cek tiap 60 detik)");
  void runDueTasks(); // tick awal: jalankan yang tertunggak saat server mati
  setInterval(() => void runDueTasks(), 60_000);
  // Bersihkan lampiran sementara yang menganggur (sesi ditutup tanpa logout).
  void sweepEphemeral();
  setInterval(() => void sweepEphemeral(), 10 * 60_000);
  // Hanguskan kredit user yang masa aktif paketnya sudah lewat (cek tiap jam).
  void expireCredits();
  setInterval(() => void expireCredits(), 60 * 60_000);
}

/** Set kredit -> 0 untuk user yang masa aktif (creditsExpireAt) sudah lewat. */
async function expireCredits(): Promise<void> {
  try {
    const r = await db.user.updateMany({
      where: { creditsExpireAt: { lte: new Date() }, creditBalance: { gt: 0 } },
      data: { creditBalance: 0 },
    });
    if (r.count) console.log(`[scheduler] ${r.count} user: kredit hangus (masa aktif habis)`);
  } catch (e) {
    console.error("[scheduler] expireCredits:", (e as Error).message);
  }
}

async function sweepEphemeral(): Promise<void> {
  try {
    const n = await cleanupStaleEphemeral();
    if (n) console.log(`[scheduler] hapus ${n} lampiran sementara kedaluwarsa`);
  } catch (e) {
    console.error("[scheduler] cleanup upload:", (e as Error).message);
  }
}
