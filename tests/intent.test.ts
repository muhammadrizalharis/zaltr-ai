import { describe, it, expect } from "vitest";
import { wantsAction } from "@/server/intent";

describe("wantsAction (auto-agent)", () => {
  it("permintaan buat/edit berkas -> true", () => {
    expect(wantsAction("Buatkan laporan ini dalam format PDF")).toBe(true);
    expect(wantsAction("tolong edit file word yang saya lampirkan, ganti judulnya")).toBe(true);
    expect(wantsAction("generate excel dari tabel di atas")).toBe(true);
    expect(wantsAction("jalankan script python ini dan simpan hasilnya ke csv")).toBe(true);
    expect(wantsAction("buat folder src lalu bikin file main.py")).toBe(true);
  });

  it("pertanyaan biasa -> false", () => {
    expect(wantsAction("apa isi materi file ini?")).toBe(false);
    expect(wantsAction("jelaskan perbedaan pdf dan docx")).toBe(false);
    expect(wantsAction("buatkan puisi tentang laut")).toBe(false);
    expect(wantsAction("ringkas dokumen ini")).toBe(false);
  });
});
