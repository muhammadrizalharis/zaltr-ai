import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { getSessionUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="scene-app" aria-hidden />
      <Sidebar
        user={{ name: user.name, role: user.role, creditBalance: user.creditBalance }}
      />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto max-md:pt-[calc(3rem+env(safe-area-inset-top))]">
        {children}
      </main>
    </div>
  );
}
