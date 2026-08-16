"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Result = { id: string; title: string; snippet: string; updatedAt: string };

/** Cari percakapan lama berdasarkan judul atau isi pesan. */
export function SearchView() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    setTouched(true);
    timer.current = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`).then((x) => x.json());
      setResults(r.results ?? []);
      setLoading(false);
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold">Cari percakapan</h1>
        <p className="text-sm text-muted">Telusuri chat lamamu berdasarkan judul atau isi pesan.</p>
      </div>

      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Ketik kata kunci…"
        className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
      />

      {loading && <p className="text-xs text-muted">Mencari…</p>}
      {!loading && touched && results.length === 0 && q.trim().length >= 2 && (
        <p className="rounded-xl border border-line bg-panel px-3 py-3 text-sm text-muted">
          Tidak ada hasil untuk “{q.trim()}”.
        </p>
      )}

      <ul className="space-y-1.5">
        {results.map((r) => (
          <li key={r.id}>
            <Link
              href={`/chat/${r.id}`}
              className="block rounded-xl border border-line bg-panel px-3 py-2.5 hover:border-accent-b/60"
            >
              <span className="block truncate text-sm font-medium">{r.title}</span>
              {r.snippet && <span className="mt-0.5 block text-xs text-muted">{r.snippet}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
