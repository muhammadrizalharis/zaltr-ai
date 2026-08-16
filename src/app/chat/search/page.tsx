import { SearchView } from "@/components/search-view";

export const metadata = { title: "Cari — calyzr.ai" };

/** Guard login sudah di chat/layout.tsx. */
export default function SearchPage() {
  return <SearchView />;
}
