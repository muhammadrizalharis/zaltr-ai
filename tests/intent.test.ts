import { describe, it, expect } from "vitest";
import { wantsAction, unfenceCode } from "@/server/intent";

describe("unfenceCode", () => {
  it("fence di baris baru setelah AKSI (kasus nyata qwen)", () => {
    expect(unfenceCode("\n```python\nprint(1)\n```")).toBe("print(1)");
  });
  it("fence rapi + teks penjelasan setelahnya dibuang", () => {
    expect(unfenceCode("```sh\nls -la\n```\nIni akan menampilkan berkas.")).toBe("ls -la");
  });
  it("tanpa fence -> apa adanya", () => {
    expect(unfenceCode("  echo hi  ")).toBe("echo hi");
  });
  it("fence penutup tanpa bahasa", () => {
    expect(unfenceCode("```\nx=1\ny=2\n```")).toBe("x=1\ny=2");
  });
  it("penjelasan PANJANG setelah fence penutup ikut dibuang", () => {
    const long = "Penjelasan. ".repeat(50);
    expect(unfenceCode("```python\nprint(1)\n```\n" + long)).toBe("print(1)");
  });
  it("fence pembuka tanpa penutup", () => {
    expect(unfenceCode("```python\nprint(2)")).toBe("print(2)");
  });
});

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
