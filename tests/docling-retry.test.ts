import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const OK = { status: "success", document: { md_content: "# Hasil OCR" } };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("pdfViaDocling (percobaan ulang kegagalan sesaat)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let pdfViaDocling: (b: Buffer, ocr: boolean, delay?: number) => Promise<string | null>;

  beforeEach(async () => {
    vi.resetModules();
    process.env.ZALTR_DOCLING_URL = "http://docling.test:1010";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    ({ pdfViaDocling } = await import("@/server/extract"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ZALTR_DOCLING_URL;
  });

  const pdf = Buffer.from("%PDF-1.4 uji");

  it("sukses langsung -> 1 panggilan, tanpa ulang", async () => {
    fetchMock.mockResolvedValueOnce(json(OK));
    expect(await pdfViaDocling(pdf, true, 0)).toBe("# Hasil OCR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("GPU penuh (404 'Task result not found') lalu pulih -> berhasil di percobaan ke-2", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "Task result not found" }, 404)).mockResolvedValueOnce(json(OK));
    expect(await pdfViaDocling(pdf, true, 0)).toBe("# Hasil OCR");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("5xx lalu pulih -> berhasil", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json(OK));
    expect(await pdfViaDocling(pdf, true, 0)).toBe("# Hasil OCR");
  });

  it("koneksi putus lalu pulih -> berhasil", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(json(OK));
    expect(await pdfViaDocling(pdf, true, 0)).toBe("# Hasil OCR");
  });

  it("status 200 tapi bukan success lalu pulih -> berhasil", async () => {
    fetchMock.mockResolvedValueOnce(json({ status: "failure" })).mockResolvedValueOnce(json(OK));
    expect(await pdfViaDocling(pdf, true, 0)).toBe("# Hasil OCR");
  });

  it("gagal terus -> berhenti setelah TEPAT 2 percobaan, hasil null (bukan loop)", async () => {
    fetchMock.mockResolvedValue(json({ detail: "x" }, 404));
    expect(await pdfViaDocling(pdf, true, 0)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([400, 413, 422])("galat berkas (%i) tidak diulang", async (status) => {
    fetchMock.mockResolvedValue(json({ detail: "x" }, status));
    expect(await pdfViaDocling(pdf, true, 0)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["TimeoutError", "AbortError"])("%s tidak diulang (hindari menggandakan waktu tunggu 120 dtk)", async (name) => {
    fetchMock.mockRejectedValue(Object.assign(new Error("t"), { name }));
    expect(await pdfViaDocling(pdf, true, 0)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sukses tapi markdown kosong -> null tanpa ulang berlebih", async () => {
    fetchMock.mockResolvedValue(json({ status: "success", document: { md_content: "  " } }));
    expect(await pdfViaDocling(pdf, true, 0)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("berkas > 30MB tidak dikirim sama sekali", async () => {
    expect(await pdfViaDocling(Buffer.alloc(31 * 1024 * 1024), true, 0)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("jeda antar percobaan benar-benar diberlakukan", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404)).mockResolvedValueOnce(json(OK));
    const t0 = Date.now();
    await pdfViaDocling(pdf, true, 60);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
  });
});

describe("pdfViaDocling nonaktif", () => {
  it("tanpa ZALTR_DOCLING_URL -> null dan tidak memanggil jaringan", async () => {
    vi.resetModules();
    delete process.env.ZALTR_DOCLING_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { pdfViaDocling } = await import("@/server/extract");
    expect(await pdfViaDocling(Buffer.from("x"), true, 0)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
