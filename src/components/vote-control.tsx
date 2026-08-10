"use client";

/**
 * Upvote / downvote control. Owned by TM2 (Posts & Voting).
 *
 * Serves posts and comments — the target type is passed through to the
 * polymorphic vote endpoint, which is the whole point of keying votes by
 * (targetType, targetId) rather than post id.
 *
 * Updates optimistically so the tally moves on click, then reconciles with the
 * server's recomputed score. Tapping the active direction again clears the vote.
 */

import { useState } from "react";
import type { VoteTargetType } from "@/lib/types";

export default function VoteControl({
  targetId,
  targetType = "post",
  score,
  viewerVote,
  layout = "horizontal",
}: {
  targetId: string;
  targetType?: VoteTargetType;
  score: number;
  viewerVote: number;
  /** Column for post cards, row for comment rows. */
  layout?: "horizontal" | "vertical";
}) {
  const [state, setState] = useState({ score, viewerVote });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function vote(value: 1 | -1) {
    if (busy) return;

    const previous = state;
    // Re-casting the same direction clears the vote.
    const nextVote = state.viewerVote === value ? 0 : value;
    setState({
      score: state.score - state.viewerVote + nextVote,
      viewerVote: nextVote,
    });
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId, targetType, value }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Vote failed (${response.status})`);
      }

      const result = await response.json();
      setState({ score: result.score, viewerVote: result.viewerVote });
    } catch (cause) {
      setState(previous); // roll back
      setError(cause instanceof Error ? cause.message : "Vote failed");
    } finally {
      setBusy(false);
    }
  }

  const up = state.viewerVote === 1;
  const down = state.viewerVote === -1;
  const vertical = layout === "vertical";

  return (
    <div
      className={`flex items-center gap-0.5 ${vertical ? "flex-col" : "flex-row"}`}
    >
      <button
        type="button"
        onClick={() => void vote(1)}
        disabled={busy}
        aria-label="Upvote"
        aria-pressed={up}
        title="Upvote"
        className={`flex h-7 w-7 items-center justify-center rounded transition-colors disabled:opacity-50 ${
          up
            ? "bg-orange-500/15 text-orange-600 dark:text-orange-400"
            : "text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
        }`}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M10 3.5l6 7h-3.6V16H7.6v-5.5H4l6-7z" />
        </svg>
      </button>

      <span
        aria-live="polite"
        className={`min-w-6 text-center font-mono text-xs font-semibold tabular-nums ${
          up
            ? "text-orange-600 dark:text-orange-400"
            : down
              ? "text-blue-600 dark:text-blue-400"
              : "text-zinc-700 dark:text-zinc-300"
        }`}
      >
        {state.score}
      </span>

      <button
        type="button"
        onClick={() => void vote(-1)}
        disabled={busy}
        aria-label="Downvote"
        aria-pressed={down}
        title="Downvote"
        className={`flex h-7 w-7 items-center justify-center rounded transition-colors disabled:opacity-50 ${
          down
            ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
            : "text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
        }`}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M10 16.5l-6-7h3.6V4h4.8v5.5H16l-6 7z" />
        </svg>
      </button>

      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
