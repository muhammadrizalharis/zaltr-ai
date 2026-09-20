import { describe, it, expect, vi } from "vitest";

// Isolasi chunkText dari rantai impor (Prisma/embeddings) — cukup uji logika murni.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/embeddings", () => ({
  embed: async () => [],
  embedOne: async () => [],
  EMBED_MODEL: "test",
}));

import { chunkText } from "@/server/knowledge";

describe("chunkText (RAG)", () => {
  it("teks kosong -> array kosong", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("teks pendek -> satu potongan", () => {
    const out = chunkText("halo dunia");
    expect(out).toHaveLength(1);
    expect(out[0]).toBe("halo dunia");
  });

  it("teks panjang -> banyak potongan, tiap potongan <= size", () => {
    const size = 200;
    const text = Array.from({ length: 60 }, (_, i) => `kalimat nomor ${i}.`).join(" ");
    const out = chunkText(text, size, 40);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.length).toBeLessThanOrEqual(size);
  });

  it("potongan berurutan tumpang-tindih (overlap)", () => {
    const size = 100;
    const overlap = 30;
    const text = "x".repeat(500);
    const out = chunkText(text, size, overlap);
    expect(out.length).toBeGreaterThan(1);
    // Total karakter melebihi panjang asli karena ada tumpang-tindih.
    const total = out.reduce((n, c) => n + c.length, 0);
    expect(total).toBeGreaterThan(text.length);
  });

  it("membuang byte NUL (0x00) yang ditolak Postgres", () => {
    const out = chunkText("halo\u0000dunia");
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain("\u0000");
    expect(out[0]).toBe("halodunia");
  });
});
