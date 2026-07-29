"use client";

import { useEffect, useRef, useState } from "react";
import type { ModelDescriptor } from "@/lib/types";

const STORAGE_KEY = "zaltr:model";
export const DEFAULT_MODEL = "zaltr-core";

export function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/models", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { models: ModelDescriptor[] };
      setModels(data.models);
    })();
  }, [open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const selected = models.find((m) => m.id === value);
  const groups = new Map<string, ModelDescriptor[]>();
  for (const m of models) {
    const list = groups.get(m.providerLabel) ?? [];
    list.push(m);
    groups.set(m.providerLabel, list);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="Pilih model"
        className="flex h-10 items-center gap-1.5 rounded-xl border border-line bg-panel-2 px-3 text-sm text-ink hover:border-accent-b/60 disabled:opacity-50"
      >
        <span className="size-2 rounded-full bg-gradient-to-r from-accent-a to-accent-b" />
        <span className="max-w-36 truncate">{selected?.label ?? value}</span>
        <span className="text-[10px] text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute bottom-12 left-0 z-20 max-h-96 w-80 overflow-y-auto rounded-2xl border border-line bg-panel p-2 shadow-2xl">
          {[...groups.entries()].map(([label, list]) => (
            <div key={label} className="mb-2 last:mb-0">
              <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                {label}
              </p>
              {list.map((m) => {
                const active = m.id === value;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={!m.available}
                    onClick={() => {
                      onChange(m.id);
                      localStorage.setItem(STORAGE_KEY, m.id);
                      setOpen(false);
                    }}
                    className={`flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left ${
                      active ? "bg-panel-2" : "hover:bg-panel-2"
                    } ${m.available ? "" : "cursor-not-allowed opacity-45"}`}
                  >
                    <span className="flex w-full items-center gap-2 text-sm">
                      <span className="truncate">{m.label}</span>
                      {m.local && (
                        <span className="rounded border border-accent-a/40 px-1 text-[9px] uppercase text-accent-a">
                          local
                        </span>
                      )}
                      {active && <span className="ml-auto text-accent-a">✓</span>}
                    </span>
                    <span className="flex flex-wrap gap-1 pt-0.5">
                      {m.capabilities.map((c) => (
                        <span
                          key={c}
                          className="rounded bg-bg px-1 py-px text-[9px] text-muted"
                        >
                          {c}
                        </span>
                      ))}
                    </span>
                    {m.note && (
                      <span className="pt-0.5 text-[10px] text-muted">{m.note}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {models.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted">Memuat model…</p>
          )}
        </div>
      )}
    </div>
  );
}

export function loadSavedModel(): string {
  if (typeof window === "undefined") return DEFAULT_MODEL;
  return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_MODEL;
}
