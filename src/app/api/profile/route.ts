import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

export const runtime = "nodejs";

/** GET: profil ringkas + custom instructions. PATCH: simpan custom instructions. */
export const GET = guarded(async () => {
  const me = await requireUser();
  return Response.json({
    profile: {
      name: me.name,
      email: me.email,
      role: me.role,
      creditBalance: me.creditBalance,
      customInstructions: me.customInstructions ?? "",
    },
  });
});

const patchSchema = z.object({
  customInstructions: z.string().max(2_000),
});

export const PATCH = guarded(async (req: Request) => {
  const me = await requireUser();
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Payload tidak valid (maks 2000 karakter)" }, { status: 400 });
  }
  await db.user.update({
    where: { id: me.id },
    data: { customInstructions: parsed.data.customInstructions.trim() || null },
  });
  return Response.json({ ok: true });
});
