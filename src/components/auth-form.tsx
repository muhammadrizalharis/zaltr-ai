"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function AuthForm({
  mode,
  initialError,
}: {
  mode: "login" | "register";
  initialError?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      {/* Scene login: gerbang orbit zaltr — grid mengalir, bintang, cincin berputar */}
      <div className="scene-portal" aria-hidden />
      <div className="orbit-wrap" aria-hidden>
        <div className="orbit orbit-a h-[560px] w-[560px]">
          <span className="sat" />
        </div>
        <div className="orbit orbit-b h-[680px] w-[680px]">
          <span className="sat sat-b" />
        </div>
        <div className="orbit orbit-c h-[820px] w-[820px]" />
      </div>
      <Link
        href="/"
        className="absolute left-4 top-4 z-20 flex items-center gap-1.5 rounded-xl border border-line bg-panel/70 px-3 py-2 text-sm text-muted backdrop-blur transition-colors hover:border-accent-a/50 hover:text-ink md:left-6 md:top-6"
      >
        ← Beranda
      </Link>
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/" className="flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-192.png" alt="calyzr.ai" className="anim-float glow-pulse h-16 w-16 rounded-2xl" />
            <span className="wordmark-flow text-3xl font-bold">CALYZR.AI</span>
          </Link>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.22em] text-accent-a/90">
            <span className="stream-caret">
              {isLogin ? "> gerbang siap — menunggu kredensial" : "> registrasi node baru"}
            </span>
          </p>
        </div>

        <form
          onSubmit={submit}
          className="scan-card glow-card space-y-4 rounded-2xl border border-line bg-panel p-6 backdrop-blur-md"
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

          <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted">
            <span className="h-px flex-1 bg-line" /> atau <span className="h-px flex-1 bg-line" />
          </div>

          <a
            href="/api/auth/google"
            className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-panel-2 py-2.5 text-sm font-medium hover:border-accent-b/60"
          >
            <GoogleIcon />
            {isLogin ? "Masuk dengan Google" : "Daftar dengan Google"}
          </a>
          <p className="text-center text-[11px] leading-relaxed text-muted">
            Satu akun Google hanya bisa terhubung ke satu akun calyzr.ai.
            Akun baru menunggu aktivasi superadmin.
          </p>
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

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.44 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28v-3.1H1.29a12 12 0 0 0 0 10.76l3.98-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.76 0 3.34.6 4.59 1.79l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.1C6.22 6.87 8.87 4.76 12 4.76z"
      />
    </svg>
  );
}
