"use client";

import { useEffect, useState } from "react";
import { InstallApp } from "@/components/install-app";

type MemoryItem = { id: string; content: string; createdAt: string };
type ApiKeyItem = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
};

/** Config Continue (VS Code) siap-tempel untuk gateway OpenAI-compatible calyzr. */
function continueConfig(base: string, key: string): string {
  const apiBase = `${base}/v1`;
  const model = (name: string, id: string) =>
    `  - name: ${name}\n    provider: openai\n    model: ${id}\n    apiBase: ${apiBase}\n    apiKey: ${key}`;
  return [
    "name: Calyzr",
    "version: 1.0.0",
    "schema: v1",
    "models:",
    model("Calyzr Sonnet 5", "copilot:claude-sonnet-5"),
    model("Calyzr Opus 5", "copilot:claude-opus-5"),
    model("Calyzr Haiku 4.5 (cepat)", "copilot:claude-haiku-4.5"),
    `# Model lain yang tersedia untukmu: buka ${apiBase}/models`,
    "",
  ].join("\n");
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

  useEffect(() => {
    void (async () => {
      setBase(window.location.origin);
      const [p, m, k] = await Promise.all([
        fetch("/api/profile").then((r) => r.json()),
        fetch("/api/memories").then((r) => r.json()),
        fetch("/api/apikeys").then((r) => r.json()),
      ]);
      setInstructions(p.profile?.customInstructions ?? "");
      setMemories(m.memories ?? []);
      setApiKeys(k.keys ?? []);
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
            <pre className="max-h-56 overflow-auto whitespace-pre rounded bg-bg px-2 py-2 text-[11px] leading-relaxed">{continueConfig(base || "https://calyzr-ai.my.id", "sk-calyzr-XXXXXXXXXXXXXXXX")}</pre>
            <button
              onClick={() =>
                void navigator.clipboard?.writeText(
                  continueConfig(base || "https://calyzr-ai.my.id", "sk-calyzr-XXXXXXXXXXXXXXXX"),
                )
              }
              className="rounded-lg border border-line bg-panel-2 px-2 py-1 text-xs hover:text-ink"
            >
              Salin contoh
            </button>
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
              <pre className="max-h-48 overflow-auto whitespace-pre rounded bg-bg px-2 py-2 text-[11px] leading-relaxed">{continueConfig(base, createdKey)}</pre>
              <button
                onClick={() => void navigator.clipboard?.writeText(continueConfig(base, createdKey))}
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
