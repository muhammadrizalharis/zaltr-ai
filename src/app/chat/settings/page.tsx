import { SettingsView } from "@/components/settings-view";

export const metadata = { title: "Pengaturan — calyzr.ai" };

/** Guard login sudah di chat/layout.tsx. */
export default function SettingsPage() {
  return <SettingsView />;
}
