export const runtime = "nodejs";

/**
 * Penangkap semua subpath /v1/* yang tak dikenal (mis. /v1/completions,
 * /v1/rerank). Balas JSON yang jelas (bukan halaman 404 HTML) DAN catat path ke
 * log supaya ketahuan endpoint apa yang diminta klien.
 */
function notFound(method: string, slug: string[]) {
  const path = "/v1/" + (slug?.join("/") ?? "");
  console.warn(`[v1-404] ${method} ${path}`);
  return Response.json(
    {
      error: {
        message:
          `Endpoint ${path} tidak tersedia di calyzr.ai. Yang didukung: ` +
          `POST /v1/chat/completions, POST /v1/embeddings, GET /v1/models.`,
        type: "invalid_request_error",
        code: "unknown_endpoint",
      },
    },
    { status: 404 },
  );
}

type Ctx = { params: Promise<{ slug: string[] }> };

export async function GET(_req: Request, { params }: Ctx) {
  return notFound("GET", (await params).slug);
}
export async function POST(_req: Request, { params }: Ctx) {
  return notFound("POST", (await params).slug);
}
