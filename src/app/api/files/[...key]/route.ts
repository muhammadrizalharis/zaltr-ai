import { getObjectStream } from "@/lib/storage";

export const runtime = "nodejs";

type Params = { params: Promise<{ key: string[] }> };

/**
 * Streaming file dari MinIO (bucket privat zaltr-files) ke browser.
 * Key divalidasi ketat: hanya path aman, tanpa traversal.
 */
export async function GET(_req: Request, { params }: Params) {
  const { key } = await params;
  const objectKey = key.join("/");
  if (!/^[\w][\w./-]*$/.test(objectKey) || objectKey.includes("..")) {
    return Response.json({ error: "Key tidak valid" }, { status: 400 });
  }
  try {
    const { stream, stat } = await getObjectStream(objectKey);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
      cancel() {
        stream.destroy();
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": stat.metaData?.["content-type"] ?? "application/octet-stream",
        "Content-Length": String(stat.size),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return Response.json({ error: "File tidak ditemukan" }, { status: 404 });
  }
}
