import { describe, it, expect } from "vitest";
import { paymentReceiptEmail } from "@/server/email";

describe("paymentReceiptEmail", () => {
  it("mencantumkan paket, jumlah, kredit, dan saldo", () => {
    const r = paymentReceiptEmail({
      name: "Budi",
      planLabel: "Plus",
      creditsAdded: 500,
      newBalance: 520,
      amount: 60000,
      dailyLimitLabel: "3.000 pesan/hari",
      appUrl: "https://calyzr-ai.my.id",
    });
    expect(r.subject).toContain("Plus");
    expect(r.html).toContain("Budi");
    expect(r.html).toContain("Rp60.000");
    expect(r.html).toContain("+500");
    expect(r.html).toContain("520");
    expect(r.text).toContain("Rp60.000");
  });

  it("menyembunyikan baris jumlah bila amount kosong", () => {
    const r = paymentReceiptEmail({
      planLabel: "Starter",
      creditsAdded: 100,
      newBalance: 100,
      amount: null,
      dailyLimitLabel: "1.000 pesan/hari",
      appUrl: "https://x",
    });
    expect(r.html).not.toContain("Jumlah dibayar");
    expect(r.html).toContain("+100");
  });
});
