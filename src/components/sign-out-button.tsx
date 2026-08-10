"use client";

/**
 * Sign-out control.
 *
 * POSTs to /api/auth/logout, then does a full navigation to the login page so
 * every server component re-renders without the session.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-zinc-100"
    >
      {busy ? "…" : "Sign out"}
    </button>
  );
}
