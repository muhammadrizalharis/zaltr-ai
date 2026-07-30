import { NextResponse } from "next/server";
import { listModels } from "@/server/models";
import { guarded, modelAllowed, requireUser } from "@/server/auth";

export const GET = guarded(async () => {
  const me = await requireUser();
  // Model di luar paket akun TETAP TERLIHAT tapi terkunci (freemium).
  const models = (await listModels()).map((m) =>
    modelAllowed(me.allowedModels, m.id)
      ? m
      : { ...m, locked: true, note: "Terkunci — beli kredit untuk membuka" },
  );
  return NextResponse.json({ models, creditBalance: me.creditBalance });
});
