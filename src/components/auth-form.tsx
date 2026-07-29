"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isLogin = mode === "login";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${isLogin ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isLogin ? { email, password } : { name, email, password }),
      });
      const data = (await res.json()) as {
        error?: string;
        active?: boolean;
        message?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Terjadi kesalahan");
        return;
      }
      if (!isLogin && data.active === false) {
        setInfo(data.message ?? "Akun dibuat — menunggu persetujuan admin.");
        return;
      }
      router.push("/chat");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/" className="wordmark text-3xl font-bold">
            ZALTR.AI
          </Link>
          <p className="mt-2 text-sm text-muted">
            {isLogin ? "Masuk ke ruang kerja AI-mu" : "Buat akun — akses disetujui admin"}
          </p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-2xl border border-line bg-panel p-6"
        >
          {!isLogin && (
            <Field label="Nama">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                autoComplete="name"
                className="input"
                placeholder="Nama lengkap"
              />
            </Field>
          )}
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="input"
              placeholder="kamu@contoh.com"
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={isLogin ? 1 : 8}
              autoComplete={isLogin ? "current-password" : "new-password"}
              className="input"
              placeholder={isLogin ? "Password" : "Minimal 8 karakter"}
            />
          </Field>

          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
          {info && (
            <p className="rounded-lg border border-accent-a/40 bg-accent-a/10 px-3 py-2 text-sm text-accent-a">
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-accent-a py-2.5 font-semibold text-bg hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Memproses…" : isLogin ? "Masuk" : "Daftar"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted">
          {isLogin ? (
            <>
              Belum punya akun?{" "}
              <Link href="/register" className="text-accent-a hover:underline">
                Daftar
              </Link>
            </>
          ) : (
            <>
              Sudah punya akun?{" "}
              <Link href="/login" className="text-accent-a hover:underline">
                Masuk
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
