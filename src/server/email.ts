/**
 * Pengiriman email transaksional (SMTP via nodemailer). No-op bila SMTP belum
 * dikonfigurasi (mirip helper Telegram) sehingga fitur lain tak pernah gagal
 * hanya karena email. Kredensial SMTP dibaca dari env (RAHASIA, di .env).
 */
import nodemailer, { type Transporter } from "nodemailer";

const HOST = process.env.ZALTR_SMTP_HOST || "";
const PORT = Number(process.env.ZALTR_SMTP_PORT || 587);
const USER = process.env.ZALTR_SMTP_USER || "";
const PASS = process.env.ZALTR_SMTP_PASS || "";
const FROM = process.env.ZALTR_SMTP_FROM || (USER ? `calyzr.ai <${USER}>` : "");

let transporter: Transporter | null = null;
function tx(): Transporter | null {
  if (!HOST || !USER || !PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465, // 465 = SMTPS; 587/25 = STARTTLS
      auth: { user: USER, pass: PASS },
    });
  }
  return transporter;
}

export function emailEnabled(): boolean {
  return Boolean(HOST && USER && PASS);
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<boolean> {
  const t = tx();
  if (!t || !opts.to) return false;
  try {
    await t.sendMail({ from: FROM, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
    return true;
  } catch (e) {
    console.error(`[email] gagal kirim ke ${opts.to}: ${(e as Error).message}`);
    return false;
  }
}

const rupiah = (n: number) => "Rp" + n.toLocaleString("id-ID");

/** Struk "pembayaran berhasil" saat admin menambah kredit / mengaktifkan paket. */
export function paymentReceiptEmail(p: {
  name?: string | null;
  planLabel: string;
  creditsAdded: number;
  newBalance: number;
  amount?: number | null;
  dailyLimitLabel: string;
  expiresAt?: Date | null;
  appUrl: string;
}): { subject: string; html: string; text: string } {
  const halo = p.name ? `Halo ${p.name},` : "Halo,";
  const subject = `Pembayaran berhasil — paket ${p.planLabel} aktif di calyzr.ai`;
  const rows: Array<[string, string]> = [
    ["Paket", p.planLabel],
    ...(p.amount != null && p.amount > 0
      ? ([["Jumlah dibayar", rupiah(p.amount)]] as Array<[string, string]>)
      : []),
    ...(p.creditsAdded > 0
      ? ([["Kredit ditambahkan", `+${p.creditsAdded.toLocaleString("id-ID")}`]] as Array<[string, string]>)
      : []),
    ["Saldo kredit sekarang", `${p.newBalance.toLocaleString("id-ID")} kredit`],
    ["Limit harian", p.dailyLimitLabel],
    ...(p.expiresAt
      ? ([[
          "Berlaku sampai",
          p.expiresAt.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }),
        ]] as Array<[string, string]>)
      : []),
  ];
  const trs = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;color:#64748b;font-size:14px">${k}</td>` +
        `<td style="padding:8px 0;text-align:right;font-weight:600;color:#0f172a;font-size:14px">${v}</td></tr>`,
    )
    .join("");
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f1f5f9;padding:24px;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:linear-gradient(135deg,#0ea5e9,#6366f1);padding:24px">
      <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:.3px">CALYZR.AI</div>
      <div style="color:#e0f2fe;font-size:13px;margin-top:2px">Struk pembayaran</div>
    </div>
    <div style="padding:24px">
      <p style="margin:0 0 4px;font-size:15px;color:#0f172a">${halo}</p>
      <p style="margin:0 0 16px;font-size:15px;color:#0f172a">Pembayaranmu <b style="color:#059669">berhasil</b> dan paketmu sudah aktif. Terima kasih! ✅</p>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">${trs}</table>
      <a href="${p.appUrl}/chat" style="display:inline-block;margin-top:20px;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;text-decoration:none;padding:11px 20px;border-radius:12px;font-weight:600;font-size:14px">Buka calyzr.ai →</a>
      <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">Kalau ada yang tidak sesuai, balas email ini atau hubungi admin lewat WhatsApp.</p>
    </div>
  </div></body></html>`;
  const text =
    `${halo}\n\nPembayaranmu berhasil dan paketmu sudah aktif. Terima kasih!\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\nBuka calyzr.ai: ${p.appUrl}/chat`;
  return { subject, html, text };
}
