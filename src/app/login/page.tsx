"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.replace("/");
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "login failed");
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-line bg-surface p-8 shadow-2xl"
      >
        <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-ink">
          <span className="text-accent">&gt;</span> second brain
        </h1>
        <p className="mb-6 text-sm text-ink-faint">
          One place for everything.
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg border border-line bg-base px-4 py-3 text-ink outline-none focus:border-accent-dim"
        />
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="mt-5 w-full rounded-lg bg-accent px-4 py-3 font-mono text-sm font-bold uppercase tracking-wider text-inset transition-opacity disabled:opacity-40"
        >
          {busy ? "..." : "Enter"}
        </button>
      </form>
    </main>
  );
}
