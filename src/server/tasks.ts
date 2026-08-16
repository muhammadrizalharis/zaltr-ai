/**
 * Tugas terjadwal (ala ChatGPT Tasks): jalankan prompt user secara otomatis
 * berkala. Hasilnya disimpan sebagai percakapan baru sehingga muncul di daftar
 * chat user. Penjadwal berjalan in-process (instrumentation.ts).
 */

import { db } from "@/lib/db";
import { dispatch } from "@/server/providers";
import type { HistoryItem } from "@/server/providers";

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
}
