import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Markdown } from "@/components/markdown";

export const runtime = "nodejs";
export const metadata = { title: "Percakapan dibagikan — calyzr.ai" };

type Params = { params: Promise<{ token: string }> };

/** Halaman PUBLIK read-only (tanpa login): tampilkan percakapan via shareToken. */
export default async function SharePage({ params }: Params) {
  const { token } = await params;
  const convo = await db.conversation.findFirst({
    where: { shareToken: token, trashedAt: null },
    select: {
      title: true,
      messages: {
        where: { status: { not: "failed" } },
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true },
      },
    },
  });
  if (!convo) notFound();

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl px-4 py-8">
      <header className="mb-6 border-b border-line pb-4">
        <h1 className="text-xl font-semibold">{convo.title}</h1>
        <p className="mt-1 text-xs text-muted">
          Percakapan dibagikan (read-only) ·{" "}
          <Link href="/" className="text-accent-a hover:underline">
            calyzr.ai
          </Link>
        </p>
      </header>

      <div className="space-y-4">
        {convo.messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-panel-2 px-4 py-2.5 text-sm">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="max-w-none rounded-2xl border border-line bg-panel px-4 py-3 text-sm">
              <Markdown>{m.content}</Markdown>
            </div>
          ),
        )}
      </div>

      <footer className="mt-10 border-t border-line pt-4 text-center text-xs text-muted">
        Dibuat dengan calyzr.ai
      </footer>
    </div>
  );
}
