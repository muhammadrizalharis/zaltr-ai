"use client";

import { useEffect, useState } from "react";
import { InstallApp } from "@/components/install-app";
import { PushToggle } from "@/components/push-toggle";
import type { ModelDescriptor } from "@/lib/types";

type MemoryItem = { id: string; content: string; createdAt: string };
type ApiKeyItem = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
};

/** Model chat yang benar-benar bisa dipakai akun ini via gateway (terbuka + online). */
function usableChatModels(models: ModelDescriptor[]): ModelDescriptor[] {
  return models.filter(
    (m) =>
      !m.locked &&
      m.available !== false &&
      m.provider !== "comfyui" &&
      m.capabilities.includes("chat"),
  );
}

/**
 * Config Continue (VS Code) siap-tempel untuk gateway OpenAI-compatible calyzr.
 * Daftar model MENGIKUTI yang terbuka untuk akun (bukan contoh statis).
 */
function continueConfig(base: string, key: string, models: ModelDescriptor[]): string {
  const apiBase = `${base}/v1`;
  const q = (s: string) => JSON.stringify(s); // aman utk YAML (label bisa berisi ':' dll)
  const entry = (name: string, id: string) =>
    `  - name: ${q(name)}\n    provider: openai\n    model: ${q(id)}\n    apiBase: ${apiBase}\n    apiKey: ${key}`;
  const usable = usableChatModels(models);
  const lines = ["name: Calyzr", "version: 1.0.0", "schema: v1", "models:"];
  if (usable.length === 0) {
    lines.push(entry("Calyzr Free", "zaltr-core"));
  } else {
    for (const m of usable) lines.push(entry(`Calyzr — ${m.label}`, m.id));
  }
  lines.push(
    "  # Embedding utk @codebase — model lokal calyzr (GRATIS, tak memakai kredit)",
    "  - name: Calyzr Embeddings",
    "    provider: openai",
    "    model: bge-m3",
    `    apiBase: ${apiBase}`,
    `    apiKey: ${key}`,
    "    roles: [embed]",
    `# Daftar model terbaru akunmu: GET ${apiBase}/models`,
    "",
  );
  return lines.join("\n");
}

/**
 * Pengaturan pribadi: custom instructions (disuntik ke semua chat)
 * + kelola memori antar-percakapan (lihat & hapus).
 */
export function SettingsView() {
  const [instructions, setInstructions] = useState("");
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [base, setBase] = useState("");
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [models, setModels] = useState<ModelDescriptor[]>([]);

  useEffect(() => {
    void (async () => {
      setBase(window.location.origin);
      const [p, m, k, md] = await Promise.all([
        fetch("/api/profile").then((r) => r.json()),
        fetch("/api/memories").then((r) => r.json()),
        fetch("/api/apikeys").then((r) => r.json()),
        fetch("/api/models", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      ]);
      setInstructions(p.profile?.customInstructions ?? "");
      setMemories(m.memories ?? []);
      setApiKeys(k.keys ?? []);
      setModels(md.models ?? []);
    })();
  }, []);

  async function save() {
    setSaving(true);
    setNotice(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customInstructions: instructions }),
    });
    setSaving(false);
    setNotice(res.ok ? "Tersimpan — berlaku untuk chat baru." : "Gagal menyimpan.");
  }

  async function removeMemory(id: string) {
    const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
    if (res.ok) setMemories((prev) => prev.filter((m) => m.id !== id));
  }

  async function createKey() {
    setKeyBusy(true);
    setKeyErr(null);
    setCreatedKey(null);
    const res = await fetch("/api/apikeys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKeyName }),
    });
    const data = await res.json();
    setKeyBusy(false);
    if (!res.ok) {
      setKeyErr(data.error ?? "Gagal membuat key");
      return;
    }
    setCreatedKey(data.key.raw);
    setNewKeyName("");
    const k = await fetch("/api/apikeys").then((r) => r.json());
    setApiKeys(k.keys ?? []);
  }

  async function revokeKey(id: string) {
    const res = await fetch(`/api/apikeys/${id}`, { method: "DELETE" });
    if (res.ok) setApiKeys((prev) => prev.filter((k) => k.id !== id));
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold">Pengaturan</h1>
        <p className="text-sm text-muted">
          Berlaku untuk akunmu di semua percakapan.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Instruksi pribadi</h2>
        <p className="text-xs text-muted">
          Ala ChatGPT Custom Instructions — misal: “Panggil saya Andi. Saya
          developer web. Jawab ringkas dan beri contoh kode Python bila relevan.”
        </p>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={6}
          maxLength={2000}
          placeholder="Tulis preferensimu di sini…"
          className="w-full resize-y rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
          {notice && <span className="text-xs text-muted">{notice}</span>}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Memori</h2>
        <p className="text-xs text-muted">
          Fakta yang diingat AI dari percakapanmu (diekstrak otomatis oleh model lokal,
          gratis). Hapus yang tidak kamu inginkan.
        </p>
        {memories.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel px-3 py-3 text-sm text-muted">
            Belum ada memori. Mengobrollah dulu — fakta penting akan muncul di sini.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {memories.map((m) => (
              <li
                key={m.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-line bg-panel px-3 py-2 text-sm"
              >
                <span className="min-w-0 break-words">{m.content}</span>
                <button
                  onClick={() => void removeMemory(m.id)}
                  className="shrink-0 text-xs text-muted hover:text-red-400"
                  title="Hapus memori ini"
                >
                  Hapus
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <InstallApp />

      <PushToggle />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">API key — pakai di VS Code / aplikasi lain</h2>
        <p className="text-xs text-muted">
          Sambungkan model &amp; kredit calyzr ke editor (VS Code, Continue, Cline) lewat API
          kompatibel OpenAI. Base URL:{" "}
          <code className="rounded bg-panel-2 px-1">{base}/v1</code> · endpoint{" "}
          <code className="rounded bg-panel-2 px-1">/chat/completions</code> &amp;{" "}
          <code className="rounded bg-panel-2 px-1">/models</code>. Pemakaian tetap ikut model
          yang diizinkan, kredit, dan limit akunmu.
        </p>

        <details className="rounded-xl border border-line bg-panel px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">
            Cara sambungkan VS Code (tanpa SSH) — 4 langkah
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted">
            <li>
              Buka <b>Extensions</b> (Ctrl+Shift+X) → cari <b>Continue</b> →{" "}
              <b>Install</b> (di komputermu sendiri, tidak perlu SSH ke server).
            </li>
            <li>
              Klik <b>Buat API key</b> di bawah, lalu <b>Salin config</b>.
            </li>
            <li>
              Buat file{" "}
              <code className="rounded bg-panel-2 px-1">~/.continue/config.yaml</code>{" "}
              (Windows:{" "}
              <code className="rounded bg-panel-2 px-1">%USERPROFILE%\.continue\config.yaml</code>
              ), tempel config tadi, lalu simpan.
            </li>
            <li>
              Klik ikon <b>Continue</b> di sidebar → pilih model <b>Calyzr</b> pada
              dropdown → mulai chat.
            </li>
          </ol>

          <div className="mt-3 space-y-1">
            <p className="text-xs text-muted">
              Contoh isi{" "}
              <code className="rounded bg-panel-2 px-1">config.yaml</code> — ganti{" "}
              <code className="rounded bg-panel-2 px-1">apiKey</code> dengan key dari tombol{" "}
              <b>Buat API key</b> di bawah (atau langsung <b>Salin config</b> yang sudah terisi
              setelah key dibuat):
            </p>
            <pre className="max-h-56 overflow-auto whitespace-pre rounded bg-bg px-2 py-2 text-[11px] leading-relaxed">{continueConfig(base || "https://calyzr-ai.my.id", "sk-calyzr-XXXXXXXXXXXXXXXX", models)}</pre>
            <button
              onClick={() =>
                void navigator.clipboard?.writeText(
                  continueConfig(base || "https://calyzr-ai.my.id", "sk-calyzr-XXXXXXXXXXXXXXXX", models),
                )
              }
              className="rounded-lg border border-line bg-panel-2 px-2 py-1 text-xs hover:text-ink"
            >
              Salin contoh
            </button>
          </div>
        </details>

        <details className="rounded-xl border border-line bg-panel px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">
            Baca &amp; tulis dokumen di Continue (MCP) — docx / pdf / xlsx / pptx
          </summary>
          <div className="mt-2 space-y-2 text-xs text-muted">
            <p>
              Continue membaca berkas di komputermu, tapi <code className="rounded bg-panel-2 px-1">read_file</code>{" "}
              bawaannya tak bisa mengekstrak docx/pdf/xlsx/pptx. Pasang MCP{" "}
              <b>calyzr-doc-reader</b> agar model bisa <b>baca &amp; tulis</b> semua format itu —
              termasuk membaca satu folder berkas per berkas.
            </p>
            <p>Sekali pasang (di mesin tempat Continue berjalan, butuh Node 18+):</p>
            <pre className="overflow-auto whitespace-pre rounded bg-bg px-2 py-2 text-[11px] leading-relaxed">{`git clone https://github.com/muhammadrizalharis/zaltr-ai
cd zaltr-ai/tools/mcp-doc-reader
npm install`}</pre>
            <p>
              Tambahkan blok ini ke{" "}
              <code className="rounded bg-panel-2 px-1">~/.continue/config.yaml</code>{" "}
              (ganti PATH dengan lokasi nyata hasil clone):
            </p>
            <pre className="overflow-auto whitespace-pre rounded bg-bg px-2 py-2 text-[11px] leading-relaxed">{`mcpServers:
  - name: calyzr-doc-reader
    command: node
    args:
      - /PATH/ke/zaltr-ai/tools/mcp-doc-reader/server.mjs`}</pre>
            <button
              onClick={() =>
                void navigator.clipboard?.writeText(
                  "mcpServers:\n  - name: calyzr-doc-reader\n    command: node\n    args:\n      - /PATH/ke/zaltr-ai/tools/mcp-doc-reader/server.mjs",
                )
              }
              className="rounded-lg border border-line bg-panel-2 px-2 py-1 text-xs hover:text-ink"
            >
              Salin blok MCP
            </button>
            <p>
              Restart Continue → mode <b>Agent</b> → mis. &quot;baca folder JURNAL_SAYA satu per
              satu&quot; atau &quot;tulis ringkasan ke hasil.md&quot;.
            </p>
          </div>
        </details>

        {createdKey && (
          <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-xs text-amber-200">
              Salin sekarang — key ini <b>tidak ditampilkan lagi</b>:
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-bg px-2 py-1 text-xs">{createdKey}</code>
              <button
                onClick={() => void navigator.clipboard?.writeText(createdKey)}
                className="shrink-0 rounded-lg border border-line bg-panel-2 px-2 py-1 text-xs hover:text-ink"
              >
                Salin key
              </button>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-amber-200">
                Config Continue siap‑tempel (ke{" "}
                <code className="rounded bg-bg px-1">~/.continue/config.yaml</code>):
              </p>
              <pre className="max-h-48 overflow-auto whitespace-pre rounded bg-bg px-2 py-2 text-[11px] leading-relaxed">{continueConfig(base, createdKey, models)}</pre>
              <button
                onClick={() => void navigator.clipboard?.writeText(continueConfig(base, createdKey, models))}
                className="rounded-lg border border-line bg-panel-2 px-2 py-1 text-xs hover:text-ink"
              >
                Salin config
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            maxLength={60}
            placeholder="Nama key (mis. Laptop VS Code)"
            className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-b/60"
          />
          <button
            onClick={() => void createKey()}
            disabled={keyBusy}
            className="shrink-0 rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-3 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {keyBusy ? "Membuat…" : "Buat API key"}
          </button>
        </div>
        {keyErr && <p className="text-xs text-red-400">{keyErr}</p>}

        {apiKeys.length > 0 && (
          <ul className="space-y-1.5">
            {apiKeys.map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium">{k.name}</span>{" "}
                  <code className="text-xs text-muted">{k.prefix}…</code>
                  <span className="block text-xs text-muted">
                    {k.lastUsedAt
                      ? `terakhir dipakai ${new Date(k.lastUsedAt).toLocaleDateString("id-ID")}`
                      : "belum pernah dipakai"}
                  </span>
                </span>
                <button
                  onClick={() => void revokeKey(k.id)}
                  className="shrink-0 text-xs text-muted hover:text-red-400"
                  title="Cabut key ini"
                >
                  Cabut
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
