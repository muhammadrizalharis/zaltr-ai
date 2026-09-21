import { NextResponse } from "next/server";
import { z } from "zod";
import { guarded, requireUser } from "@/server/auth";
import { rateLimit } from "@/server/ratelimit";
import { notifyTelegram } from "@/server/notify";
import { PLAN_LABELS, PLAN_PRICES, isPlan } from "@/server/plans";

export const runtime = "nodejs";

const schema = z.object({ plan: z.string().max(20).optional() });

/**
 * Dipanggil saat user MENEKAN tombol beli/chat admin di halaman upgrade
 * (tepat sebelum diarahkan ke WhatsApp). Kirim notif Telegram ke admin agar
 * tahu ada calon pembeli walau pesan WA-nya belum/ tidak jadi dikirim.
 */
export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const rl = await rateLimit(`upint:${me.id}`, 5, 10 * 60_000);
  if (!rl.ok) return NextResponse.json({ ok: true }); // diam-diam abaikan spam
  const body = schema.safeParse(await req.json().catch(() => ({})));
  const plan = body.success && body.data.plan && isPlan(body.data.plan) ? body.data.plan : null;
  const label = plan ? `${PLAN_LABELS[plan]} — Rp${PLAN_PRICES[plan].toLocaleString("id-ID")}` : "(tanya umum / belum pilih paket)";
  void notifyTelegram(
    `🛒 INGIN BELI KREDIT\n` +
      `User: ${me.name} <${me.email}>\n` +
      `Paket: ${label}\n` +
      `Paket saat ini: ${PLAN_LABELS[isPlan(me.plan) ? me.plan : "free"]}, saldo ${me.creditBalance.toLocaleString("id-ID")} kredit\n` +
      `→ Menuju WhatsApp admin. Cek WA & proses di halaman Admin.`,
    { key: `upint:${me.id}:${plan ?? "umum"}`, cooldownMs: 10 * 60_000 },
  );
  return NextResponse.json({ ok: true });
});
