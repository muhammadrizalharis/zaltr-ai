"use client";

import { useEffect, useRef, useState } from "react";
import type { ModelDescriptor } from "@/lib/types";

const STORAGE_KEY = "zaltr:model";
/** Default = model pintar (bukan demo) — pengalaman pertama harus terasa GPT/Claude. */
export const DEFAULT_MODEL = "copilot:claude-sonnet-4.6";

export function ModelPicker({
  value,
  onChange,
  disabled,
  reasoningEffort,
  onReasoningEffort,
  contextTier,
  onContextTier,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  reasoningEffort?: string | null;
  onReasoningEffort?: (effort: string | null) => void;
  contextTier?: "default" | "long_context";
  onContextTier?: (tier: "default" | "long_context") => void;
}) {
  const [open, setOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
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

  // Reset thinking level bila model terpilih tak mendukung reasoning.
  useEffect(() => {
    if (selected && !selected.supportsReasoning && reasoningEffort) {
      onReasoningEffort?.(null);
    }
  }, [selected, reasoningEffort, onReasoningEffort]);

  const EFFORT_LABELS: Record<string, string> = {
    none: "Off",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra High",
    max: "Max",
  };
  // Level thinking dari katalog model; fallback bila katalog tak menyediakan.
  const efforts: string[] =
    selected?.reasoningEfforts && selected.reasoningEfforts.length
      ? selected.reasoningEfforts
      : selected?.supportsReasoning
        ? ["low", "medium", "high", "xhigh"]
        : [];
  const fmtTokens = (n?: number) =>
    !n ? null : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

  // Pasangan model cepat (varian "-fast") untuk toggle Speed.
  const isFast = value.endsWith("-fast");
  const standardId = isFast ? value.slice(0, -"-fast".length) : value;
  const fastId = isFast ? value : `${value}-fast`;
  const hasFastPair =
    models.some((m) => m.id === standardId) && models.some((m) => m.id === fastId);

  // Harga aktif mengikuti tier context (long context punya tarif berbeda).
  const activePricing =
    contextTier === "long_context" && selected?.pricingLongContext
      ? selected.pricingLongContext
      : selected?.pricing;
  const perMillion = (price?: number) => {
    if (typeof price !== "number") return null;
    const batch = activePricing?.batchSize ?? 1_000_000;
    const v = price * (1_000_000 / batch);
    return v >= 100 ? Math.round(v).toLocaleString("id-ID") : v.toLocaleString("id-ID");
  };
  const costBadge = (mult?: number): { label: string; cls: string } | null => {
    if (typeof mult !== "number") return null;
    if (mult <= 0) return { label: "Gratis", cls: "border-emerald-400/50 text-emerald-300" };
    if (mult < 1) return { label: "Hemat", cls: "border-emerald-400/50 text-emerald-300" };
    if (mult <= 1) return { label: "Standar", cls: "border-sky-400/50 text-sky-300" };
    if (mult <= 5) return { label: "Biaya tinggi", cls: "border-amber-400/50 text-amber-300" };
    return { label: "Biaya sangat tinggi", cls: "border-rose-400/50 text-rose-300" };
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="Pilih model"
        className="flex h-10 items-center gap-1.5 rounded-xl border border-line bg-panel-2 px-3 text-sm text-ink hover:border-accent-b/60 disabled:opacity-50"
      >
        <span className="size-2 rounded-full bg-gradient-to-r from-accent-a to-accent-b" />
        <span className="max-w-24 truncate md:max-w-36">{selected?.label ?? "Model…"}</span>
        <span className="text-[10px] text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-30 max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-line bg-panel-solid p-2 shadow-2xl">
          {selected && (selected.supportsReasoning || selected.contextWindow || selected.pricing || hasFastPair) && (
            <div className="mb-2 rounded-xl border border-line bg-panel-2 p-2">
              {(selected.contextWindow || costBadge(selected.costMultiplier)) ? (
                <div className="flex items-center justify-between px-1 pb-1.5 text-[11px] text-muted">
                  <span>Context window</span>
                  <span className="flex items-center gap-1.5">
                    {selected.contextWindow ? (
                      <span className="font-semibold text-ink">
                        {fmtTokens(selected.contextWindow)} token
                      </span>
                    ) : null}
                    {costBadge(selected.costMultiplier) ? (
                      <span
                        className={`rounded border px-1 text-[9px] uppercase ${costBadge(selected.costMultiplier)!.cls}`}
                      >
                        {costBadge(selected.costMultiplier)!.label}
                      </span>
                    ) : null}
                  </span>
                </div>
              ) : null}

              {efforts.length > 0 && (
                <div className="px-1 pb-1.5">
                  <p className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Thinking level
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {efforts.map((id) => {
                      const on = (reasoningEffort ?? "") === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onReasoningEffort?.(on ? null : id)}
                          className={`flex-1 rounded-lg border px-1 py-1 text-[11px] ${
                            on
                              ? "border-accent-a bg-accent-a/15 text-ink"
                              : "border-line text-muted hover:border-accent-b/60"
                          }`}
                        >
                          {EFFORT_LABELS[id] ?? id}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {hasFastPair && (
                <div className="px-1 pb-1.5">
                  <p className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Speed
                  </p>
                  <div className="flex gap-1">
                    {[
                      { id: standardId, label: "Standard" },
                      { id: fastId, label: "Fast" },
                    ].map((s) => {
                      const on = value === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            onChange(s.id);
                            localStorage.setItem(STORAGE_KEY, s.id);
                          }}
                          className={`flex-1 rounded-lg border px-1 py-1 text-[11px] ${
                            on
                              ? "border-accent-a bg-accent-a/15 text-ink"
                              : "border-line text-muted hover:border-accent-b/60"
                          }`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {selected.contextWindow ? (
                <label className="flex cursor-pointer items-center justify-between px-1 pt-1 text-[11px] text-ink">
                  <span>
                    Long context
                    <span className="block text-[10px] text-muted">
                      Pakai jendela konteks penuh (biaya lebih tinggi)
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={contextTier === "long_context"}
                    onChange={(ev) =>
                      onContextTier?.(ev.target.checked ? "long_context" : "default")
                    }
                    className="size-4 accent-[var(--accent-a,#7c5cff)]"
                  />
                </label>
              ) : null}

              {activePricing && (
                <div className="mt-1.5 border-t border-line pt-1.5">
                  <button
                    type="button"
                    onClick={() => setPriceOpen((v) => !v)}
                    className="flex w-full items-center justify-between px-1 text-[11px] text-muted hover:text-ink"
                  >
                    <span className="font-semibold">Pricing details</span>
                    <span className="text-[10px]">{priceOpen ? "▴" : "▾"}</span>
                  </button>
                  {priceOpen && (
                    <div className="px-1 pt-1.5">
                      <p className="pb-1 text-[10px] text-muted">
                        Kredit per 1 juta token
                        {contextTier === "long_context" && selected.pricingLongContext
                          ? " (long context)"
                          : ""}
                      </p>
                      <dl className="space-y-0.5 text-[11px]">
                        {[
                          ["Input", activePricing.input],
                          ["Output", activePricing.output],
                          ["Cache Read", activePricing.cacheRead],
                          ["Cache Write", activePricing.cacheWrite],
                        ].map(([label, val]) =>
                          perMillion(val as number | undefined) ? (
                            <div key={label as string} className="flex justify-between">
                              <dt className="text-muted">{label}</dt>
                              <dd className="font-semibold text-ink">
                                {perMillion(val as number | undefined)}
                              </dd>
                            </div>
                          ) : null,
                        )}
                      </dl>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {[...groups.entries()].map(([label, list]) => (
            <div key={label} className="mb-2 last:mb-0">
              <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                {label}
              </p>
              {list.map((m) => {
                const active = m.id === value;
                const disabled = !m.available || m.locked;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onChange(m.id);
                      localStorage.setItem(STORAGE_KEY, m.id);
                      setOpen(false);
                    }}
                    className={`flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left ${
                      active ? "bg-panel-2" : "hover:bg-panel-2"
                    } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
                  >
                    <span className="flex w-full items-center gap-2 text-sm">
                      <span className="truncate">{m.label}</span>
                      {m.locked && (
                        <span className="rounded border border-amber-400/50 px-1 text-[9px] uppercase text-amber-300">
                          🔒 upgrade
                        </span>
                      )}
                      {m.local && !m.locked && (
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
  const saved = localStorage.getItem(STORAGE_KEY);
  // Migrasi: default lama "zaltr-core" (demo) dianggap belum memilih.
  if (!saved || saved === "zaltr-core") return DEFAULT_MODEL;
  return saved;
}
