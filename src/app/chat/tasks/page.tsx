import { TasksView } from "@/components/tasks-view";

export const metadata = { title: "Tugas Terjadwal — calyzr.ai" };

/** Guard login sudah di chat/layout.tsx. */
export default function TasksPage() {
  return <TasksView />;
}
