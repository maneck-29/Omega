"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Subscribe/unsubscribe toggle. Both underlying calls are idempotent. */
export default function SubscribeButton({
  slug,
  initialSubscribed,
  initialCount,
  disabled = false,
}: {
  slug: string;
  initialSubscribed: boolean;
  initialCount: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [count, setCount] = useState(initialCount);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/subreddits/${slug}/subscription`, {
        method: subscribed ? "DELETE" : "PUT",
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed (${response.status})`);
      }

      setSubscribed(payload.subscribed);
      setCount(payload.subscriberCount);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending || disabled}
        className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
          subscribed
            ? "border border-black/[.12] hover:bg-black/[.04] dark:border-white/[.16] dark:hover:bg-white/[.08]"
            : "bg-foreground text-background hover:opacity-90"
        }`}
      >
        {pending ? "…" : subscribed ? "Leave" : "Join"}
      </button>
      <span className="text-xs text-zinc-500">
        {count} {count === 1 ? "member" : "members"}
      </span>
      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
