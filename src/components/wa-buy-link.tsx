"use client";

/**
 * Tautan WhatsApp pembelian: sebelum membuka WA, kirim "niat beli" ke server
 * (notif Telegram admin). Best-effort & tak memblok — keepalive agar request
 * tetap terkirim walau tab langsung berpindah.
 */
export function WaBuyLink({
  href,
  plan,
  className,
  children,
}: {
  href: string;
  plan?: string;
  className?: string;
  children: React.ReactNode;
}) {
  function onClick() {
    try {
      void fetch("/api/upgrade/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* abaikan */
    }
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={onClick} className={className}>
      {children}
    </a>
  );
}
