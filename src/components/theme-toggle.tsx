"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

const KEY = "calyzr-theme";

function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
}

/**
 * Tombol ganti tema Gelap ↔ Terang (soft cream). Pilihan disimpan di
 * localStorage; penerapan awal sudah dilakukan skrip inline di layout agar
 * tidak ada kedipan. Komponen ini hanya menyinkronkan state tombol + aksi klik.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Theme | null) ?? "dark";
    setTheme(saved);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem(KEY, next);
    applyTheme(next);
  };

  const light = theme === "light";
  return (
    <button
      onClick={toggle}
      title={light ? "Ganti ke mode gelap" : "Ganti ke mode terang (soft)"}
      aria-label="Ganti tema"
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-accent-b/60 hover:text-ink"
    >
      <span aria-hidden>{light ? "🌙" : "☀️"}</span>
      {light ? "Gelap" : "Terang"}
    </button>
  );
}
