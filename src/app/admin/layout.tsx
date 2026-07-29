import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin" && user.role !== "superadmin") redirect("/chat");

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-line bg-panel px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/chat" className="wordmark text-lg font-bold">
            ZALTR.AI
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
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
