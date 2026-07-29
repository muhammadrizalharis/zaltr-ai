import { NextResponse } from "next/server";
import { listModels } from "@/server/models";

export async function GET() {
  return NextResponse.json({ models: await listModels() });
}
