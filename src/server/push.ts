import webpush from "web-push";
import { db } from "@/lib/db";

const PUB = process.env.ZALTR_VAPID_PUBLIC_KEY || "";
const PRIV = process.env.ZALTR_VAPID_PRIVATE_KEY || "";
const SUBJECT = process.env.ZALTR_VAPID_SUBJECT || "mailto:admin@calyzr-ai.my.id";

let configured = false;
function ensure(): boolean {
  if (!PUB || !PRIV) return false;
  if (!configured) {
    webpush.setVapidDetails(SUBJECT, PUB, PRIV);
    configured = true;
  }
  return true;
}

export function vapidPublicKey(): string {
  return PUB;
}
export function pushEnabled(): boolean {
  return Boolean(PUB && PRIV);
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/**
 * Kirim notifikasi Web Push ke SEMUA langganan milik user. Langganan yang sudah
 * mati (404/410) dibersihkan otomatis. Return jumlah yang terkirim.
 */
export async function sendToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!ensure()) return 0;
  const subs = await db.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
        );
        sent += 1;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        }
      }
    }),
  );
  return sent;
}
