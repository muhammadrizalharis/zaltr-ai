import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** GET: unduh percakapan sebagai berkas Markdown. */
export const GET = guarded(async (_req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const convo = await db.conversation.findFirst({
    where: { id, userId: me.id },
    select: {
      title: true,
      createdAt: true,
      messages: {
        where: { status: { not: "failed" } },
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true },
      },
    },
  });
  if (!convo) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });

  const head = `# ${convo.title}\n\n_Diekspor dari calyzr.ai · ${convo.createdAt.toISOString().slice(0, 10)}_\n`;
  const body = convo.messages
    .map((m) => `\n\n## ${m.role === "user" ? "Anda" : m.role === "assistant" ? "Asisten" : "Sistem"}\n\n${m.content}`)
    .join("");
  const md = head + body + "\n";

  const safe = (convo.title || "chat").normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "chat";
  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safe}.md"`,
    },
  });
});
