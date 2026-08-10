"use client";

/**
 * Sign-in form.
 *
 * Submits to /api/auth/login, which sets an httpOnly session cookie. The cookie
 * is never touched from here — client JavaScript cannot read it, which is the
 * point.
 *
 * On success it uses a full navigation rather than a client-side push, so the
 * server re-renders every page with the new session applied.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Where the visitor was headed before being asked to sign in.
  const next = params.get("next");
  // Only same-site paths, so `?next=https://evil.example` cannot redirect away.
  const destination = next && next.startsWith("/") ? next : "/";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not sign in");
      }

      router.replace(destination);
      // Refresh so server components pick up the new session.
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="text-sm text-zinc-500">
          Welcome back. Pick up where the arguments left off.
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Username
        </span>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          className="w-full rounded-xl border border-black/[.12] bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400 focus:border-orange-500/60 dark:border-white/[.16]"
          placeholder="user"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Password
        </span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          className="w-full rounded-xl border border-black/[.12] bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400 focus:border-orange-500/60 dark:border-white/[.16]"
          placeholder="••••••"
        />
      </label>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || username === "" || password === ""}
        className="w-full rounded-full bg-orange-600 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
