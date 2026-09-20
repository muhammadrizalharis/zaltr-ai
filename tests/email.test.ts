import { describe, it, expect } from "vitest";
import { paymentReceiptEmail, expiryReminderEmail } from "@/server/email";

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

describe("expiryReminderEmail", () => {
  it("menyebut paket, sisa hari, dan tautan perpanjang", () => {
    const r = expiryReminderEmail({
      name: "Sinta",
      planLabel: "Plus",
      daysLeft: 3,
      expiresAt: new Date("2026-10-01T00:00:00Z"),
      balance: 250,
      appUrl: "https://calyzr-ai.my.id",
    });
    expect(r.subject).toContain("Plus");
    expect(r.subject).toContain("3 hari");
    expect(r.html).toContain("Sinta");
    expect(r.html).toContain("/chat/upgrade");
    expect(r.text).toContain("Perpanjang");
  });
});
