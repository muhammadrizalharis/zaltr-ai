import { NextResponse } from "next/server";
import { listModels } from "@/server/models";
import { guarded, modelAllowed, requireUser } from "@/server/auth";

export const GET = guarded(async () => {
  const me = await requireUser();
  const models = (await listModels()).map((m) =>
    modelAllowed(me.allowedModels, m.id)
      ? m
      : { ...m, available: false, note: "Tidak diizinkan untuk akunmu — hubungi admin" },
  );
  return NextResponse.json({ models, creditBalance: me.creditBalance });
});
