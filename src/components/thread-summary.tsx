"use client";

/**
 * TL;DR control above a comment thread.
 *
 * On demand rather than on load: a summary costs a model call, and most readers
 * open a thread to read it. Fetching for everyone would spend money on people
 * who scrolled straight past.
 *
 * Fallback output is labelled. A summary that was excerpted locally looks
 * exactly like a real one otherwise, and a reader who cannot tell the difference
 * will trust the wrong thing.
 */

import { useState } from "react";
import type { ThreadSummary } from "@/lib/summary";

const TONE_LABEL: Record<ThreadSummary["tone"], string> = {
  agreement: "Broad agreement",
  mixed: "Mixed views",
  heated: "Contested",
};

const TONE_CLASS: Record<ThreadSummary["tone"], string> = {
  agreement:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  mixed: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  heated: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

export default function ThreadSummaryPanel({ postId }: { postId: string }) {
  const [summary, setSummary] = useState<ThreadSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/posts/${postId}/summary`, {
        method: "POST",
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? `Could not summarise (${response.status})`);
      }

      setSummary(payload.summary as ThreadSummary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not summarise");
    } finally {
      setPending(false);
    }
  }

  if (!summary) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void load()}
          disabled={pending}
          className="flex items-center gap-1.5 rounded-full border border-black/[.12] px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/[.16] dark:hover:bg-white/[.08]"
        >
          <span aria-hidden>✨</span>
          {pending ? "Summarising…" : "TL;DR this thread"}
        </button>

        {error && (
          <span role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </span>
        )}
      </div>
    );
  }

  // Too short to summarise: the service says so rather than inventing one.
  if (summary.tldr === "" && summary.bullets.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        {summary.note ?? "Not enough comments to summarise yet."}
      </p>
    );
  }

  return (
    <section
      aria-label="Thread summary"
      className="rounded-xl border border-black/[.08] bg-black/[.02] px-4 py-3 dark:border-white/[.12] dark:bg-white/[.03]"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
          TL;DR
        </h2>

        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS[summary.tone]}`}
        >
          {TONE_LABEL[summary.tone]}
        </span>

        <span className="text-[11px] text-zinc-400">
          {summary.basedOn} comments
        </span>

        <button
          type="button"
          onClick={() => void load()}
          disabled={pending}
          className="ml-auto rounded px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
        >
          {pending ? "…" : "Refresh"}
        </button>
      </header>

      <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
        {summary.tldr}
      </p>

      {summary.bullets.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {summary.bullets.map((bullet) => (
            <li
              key={bullet}
              className="flex gap-2 text-sm text-zinc-600 dark:text-zinc-400"
            >
              <span aria-hidden className="text-zinc-400">
                •
              </span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-zinc-400">
        {summary.source === "bedrock"
          ? "AI-generated summary — read the thread for the full picture."
          : (summary.note ??
            "Excerpted from the top comments; no AI summary was available.")}
      </p>
    </section>
  );
}
