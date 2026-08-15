import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin" && user.role !== "superadmin") redirect("/chat");

  return (
    <div className="min-h-dvh pb-[env(safe-area-inset-bottom)]">
      <div className="scene-app" aria-hidden />
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-panel px-6 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] max-md:px-4">
        <div className="flex items-center gap-4 max-md:gap-2">
          <Link href="/chat" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-192.png" alt="" className="h-7 w-7 rounded-lg" />
            <span className="wordmark text-lg font-bold">CALYZR.AI</span>
          </Link>
          <span className="rounded-full border border-accent-b/50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent-b">
            {user.role}
          </span>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/admin" className="text-ink hover:text-accent-a">
            Pengguna
          </Link>
          <Link href="/chat" className="text-muted hover:text-ink">
            ← Kembali ke chat
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8 max-md:px-4 max-md:py-5">{children}</main>
    </div>
  );
}
