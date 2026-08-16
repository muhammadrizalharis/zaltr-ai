import { KnowledgeView } from "@/components/knowledge-view";

export const metadata = { title: "Basis Pengetahuan — calyzr.ai" };

/** Guard login sudah di chat/layout.tsx. */
export default function KnowledgePage() {
  return <KnowledgeView />;
}
