/**
 * Penjaga jaringan untuk URL yang berasal dari model/pengguna (bisa dipengaruhi isi web atau prompt).
 * Hanya http(s) ke host PUBLIK yang diizinkan: alamat privat/loopback/link-local/metadata ditolak,
 * termasuk nama host yang me-resolve ke alamat privat.
 *
 * Dipakai Crawl4AI (crawl.ts) dan pengambilan langsung (pagefetch.ts). Untuk pengambilan langsung,
 * `guardedLookup` memeriksa IP TEPAT SAAT KONEKSI sehingga DNS rebinding (host berubah ke IP privat
 * setelah pemeriksaan awal) tak bisa lolos.
 */
import { lookup } from "node:dns/promises";
import { lookup as lookupCb } from "node:dns";
import { isIP } from "node:net";

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local + metadata cloud
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast + reserved
  );
}

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateIPv4(ip);
  if (v === 6) {
    const l = ip.toLowerCase();
    // "::" mencakup loopback, IPv4-mapped (::ffff:a00:1) dan IPv4-compatible; 64:ff9b/2002 = NAT64/6to4
    return (
      l.startsWith("::") ||
      l.startsWith("64:ff9b") ||
      l.startsWith("2002:") ||
      l.startsWith("fc") ||
      l.startsWith("fd") ||
      l.startsWith("fe8") ||
      l.startsWith("fe9") ||
      l.startsWith("fea") ||
      l.startsWith("feb") ||
      l.startsWith("ff")
    );
  }
  return true;
}

/** Mengembalikan URL ternormalisasi, atau melempar Error bila tidak aman. */
export async function assertPublicUrl(raw: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/[)>.,;]+$/, ""));
  } catch {
    throw new Error("URL tidak valid");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("hanya http/https");
  if (u.username || u.password) throw new Error("URL dengan kredensial ditolak");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("port non-standar ditolak");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    (!host.includes(".") && !isIP(host))
  ) {
    throw new Error("alamat internal ditolak");
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("alamat privat ditolak");
  } else {
    const addrs = await lookup(host, { all: true }).catch(() => []);
    if (addrs.length === 0) throw new Error("host tidak ditemukan");
    if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("host mengarah ke alamat privat");
  }
  return u.toString();
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

/**
 * Opsi `lookup` untuk http(s).request: me-resolve nama host lalu MENOLAK bila ada alamat privat,
 * dan sambungan memakai alamat yang baru saja diperiksa itu (tak ada celah antara cek dan pakai).
 */
export function guardedLookup(hostname: string, options: { all?: boolean; family?: number }, cb: LookupCb): void {
  lookupCb(hostname, { all: true, family: options.family }, (err, addrs) => {
    if (err) return cb(err, "");
    const list = addrs as { address: string; family: number }[];
    if (list.length === 0 || list.some((a) => isPrivateIp(a.address))) {
      return cb(Object.assign(new Error("alamat privat ditolak"), { code: "EPRIVATE" }) as NodeJS.ErrnoException, "");
    }
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}
