import { guarded, requireUser } from "@/server/auth";
import { sendToUser } from "@/server/push";

export const runtime = "nodejs";

/** Kirim notifikasi tes ke semua perangkat user. */
export const POST = guarded(async () => {
  const me = await requireUser();
  const sent = await sendToUser(me.id, {
    title: "calyzr.ai",
    body: "Notifikasi aktif ✅ — kamu akan diberi tahu saat tugas terjadwal selesai.",
    url: "/chat",
    tag: "calyzr-test",
  });
  return Response.json({ sent });
});
