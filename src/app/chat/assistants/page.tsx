import { AssistantsView } from "@/components/assistants-view";

export const metadata = { title: "Asisten — calyzr.ai" };

/** Guard login sudah di chat/layout.tsx. */
export default function AssistantsPage() {
  return <AssistantsView />;
}
