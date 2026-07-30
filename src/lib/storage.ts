import { Client } from "minio";

/**
 * Object storage zaltr (MinIO container, bucket privat zaltr-files).
 * Dipakai untuk mempersistenkan hasil ComfyUI dan lampiran chat —
 * bagian dari kontrak "tidak ada yang hilang": file ikut backup harian MinIO.
 */
const endpointUrl = new URL(process.env.ZALTR_MINIO_URL ?? "http://127.0.0.1:46900");

const globalForMinio = globalThis as unknown as { zaltrMinio?: Client };

export const minio =
  globalForMinio.zaltrMinio ??
  new Client({
    endPoint: endpointUrl.hostname,
    port: Number(endpointUrl.port || (endpointUrl.protocol === "https:" ? 443 : 80)),
    useSSL: endpointUrl.protocol === "https:",
    accessKey: process.env.ZALTR_MINIO_ROOT_USER ?? "",
    secretKey: process.env.ZALTR_MINIO_ROOT_PASSWORD ?? "",
  });
if (process.env.NODE_ENV !== "production") globalForMinio.zaltrMinio = minio;

export const FILES_BUCKET = process.env.ZALTR_MINIO_BUCKET_FILES ?? "zaltr-files";

export async function putObject(
  key: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  await minio.putObject(FILES_BUCKET, key, data, data.length, {
    "Content-Type": contentType,
  });
}

export async function getObjectStream(key: string) {
  const stat = await minio.statObject(FILES_BUCKET, key);
  const stream = await minio.getObject(FILES_BUCKET, key);
  return { stream, stat };
}

/** Baca objek utuh sebagai Buffer (untuk ekstraksi isi lampiran chat). */
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const stream = await minio.getObject(FILES_BUCKET, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
