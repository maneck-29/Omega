"use client";

/**
 * Upvote / downvote control.
 *
 * Works for posts and comments — the target type is passed through to the
 * polymorphic voting API. Updates optimistically so the count moves on tap, and
 * reconciles with the server's recomputed tallies when the response lands.
 * Tapping the active direction again clears the vote.
 */

import { useState, useTransition } from "react";

interface VoteControlProps {
  targetId: string;
  targetType?: "post" | "comment";
  score: number;
  viewerVote: number;
  /** Comments use a tighter layout than posts. */
  compact?: boolean;
}

export default function VoteControl({
  targetId,
  targetType = "post",
  score,
  viewerVote,
  compact = false,
}: VoteControlProps) {
  const [state, setState] = useState({ score, viewerVote });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function vote(value: 1 | -1) {
    const previous = state;

    // Optimistic: re-tapping the active direction removes the vote.
    const nextVote = state.viewerVote === value ? 0 : value;
    setState({
      score: state.score - state.viewerVote + nextVote,
      viewerVote: nextVote,
    });
    setError(null);

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
    }
  }

  const size = compact ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm";
  const up = state.viewerVote === 1;
  const down = state.viewerVote === -1;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => startTransition(() => void vote(1))}
        disabled={isPending}
        aria-label="Upvote"
        aria-pressed={up}
        className={`${size} flex items-center justify-center rounded-full transition-colors ${
          up
            ? "bg-accent/15 text-accent"
            : "text-muted hover:bg-black/5 dark:hover:bg-white/10"
        }`}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M10 3.5l6 7h-3.6V16H7.6v-5.5H4l6-7z" />
        </svg>
      </button>

      <span
        aria-live="polite"
        className={`min-w-7 text-center font-mono text-xs font-semibold tabular-nums ${
          up ? "text-accent" : down ? "text-blue-500" : "text-foreground"
        }`}
      >
        {state.score}
      </span>

      <button
        type="button"
        onClick={() => startTransition(() => void vote(-1))}
        disabled={isPending}
        aria-label="Downvote"
        aria-pressed={down}
        className={`${size} flex items-center justify-center rounded-full transition-colors ${
          down
            ? "bg-blue-500/15 text-blue-500"
            : "text-muted hover:bg-black/5 dark:hover:bg-white/10"
        }`}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M10 16.5l-6-7h3.6V4h4.8v5.5H16l-6 7z" />
        </svg>
      </button>

      {error && (
        <span role="alert" className="text-xs text-red-500">
          {error}
        </span>
      )}
    </div>
  );
}
