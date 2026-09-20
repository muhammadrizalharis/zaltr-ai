import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Penjaga endpoint dasar `/v1`. Klien OpenAI-compatible yang salah konfigurasi
 * (apiBase berakhiran garis miring, atau menembak base langsung) akan mendarat
 * di sini; balas JSON yang jelas — bukan halaman 404 HTML yang membingungkan.
 */
function guide(status: number) {
  return NextResponse.json(
    {
      error: {
        message:
          "Endpoint tidak lengkap. Gunakan POST /v1/chat/completions (chat) atau GET /v1/models (daftar model). " +
          "apiBase yang benar: https://calyzr-ai.my.id/v1 TANPA garis miring di akhir.",
        type: "invalid_request_error",
      },
      endpoints: ["/v1/chat/completions", "/v1/models"],
    },
    { status },
  );
}

export function GET() {
  return guide(404);
}
export function POST() {
  return guide(404);
}
