"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SubredditBan } from "@/lib/types";

/**
 * Ban management: list active bans, ban a user, unban.
 *
 * Users are identified by id, since TM1 owns username lookup. Once their user
 * search exists this becomes a username field resolved to an id.
 */
export default function BanManager({
  slug,
  initialBans,
}: {
  slug: string;
  initialBans: SubredditBan[];
}) {
  const router = useRouter();
  const [bans, setBans] = useState(initialBans);
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(
    input: string,
    init: RequestInit,
  ): Promise<Record<string, unknown> | null> {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(input, init);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed (${response.status})`);
      }
      router.refresh();
      return payload;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
      return null;
    } finally {
      setPending(false);
    }
  }

  async function ban(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const days = Number(durationDays);
    const payload = await call(`/api/subreddits/${slug}/moderation/bans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: userId.trim(),
        reason,
        // Blank or non-positive means permanent.
        durationDays: durationDays.trim() !== "" && days > 0 ? days : null,
      }),
    });

    if (payload?.ban) {
      const created = payload.ban as SubredditBan;
      setBans((current) => [
        ...current.filter((b) => b.userId !== created.userId),
        created,
      ]);
      setUserId("");
      setReason("");
      setDurationDays("");
    }
  }

  async function unban(target: string) {
    const payload = await call(
      `/api/subreddits/${slug}/moderation/bans?userId=${encodeURIComponent(target)}`,
      { method: "DELETE" },
    );
    if (payload?.unbanned) {
      setBans((current) => current.filter((b) => b.userId !== target));
    }
  }

  const inputClass =
    "w-full rounded-md border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-black/40 dark:border-white/[.16] dark:focus:border-white/40";

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Active bans
        </h2>

        {bans.length === 0 ? (
          <p className="text-sm text-zinc-500">Nobody is banned.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/[.06] rounded-lg border border-black/[.08] dark:divide-white/[.08] dark:border-white/[.12]">
            {bans.map((ban) => (
              <li
                key={ban.userId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm">{ban.userId}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {ban.reason}
                    {" · "}
                    {ban.expiresAt
                      ? `expires ${ban.expiresAt.slice(0, 10)}`
                      : "permanent"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => unban(ban.userId)}
                  disabled={pending}
                  className="shrink-0 rounded-full border border-black/[.12] px-3 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-40 dark:border-white/[.16] dark:hover:bg-white/[.08]"
                >
                  Unban
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <form
        onSubmit={ban}
        className="flex flex-col gap-3 rounded-lg border border-black/[.08] p-4 dark:border-white/[.12]"
      >
        <p className="text-sm font-medium">Ban a user</p>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-zinc-500">
            User id (e.g. user-2 — username lookup lands with TM1)
          </span>
          <input
            type="text"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="user-2"
            aria-label="User id"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-zinc-500">Reason</span>
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Spamming"
            aria-label="Ban reason"
            maxLength={500}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-zinc-500">
            Duration in days (blank for permanent)
          </span>
          <input
            type="number"
            min={1}
            value={durationDays}
            onChange={(event) => setDurationDays(event.target.value)}
            placeholder="7"
            aria-label="Ban duration in days"
            className={inputClass}
          />
        </label>

        <button
          type="submit"
          disabled={pending || userId.trim() === ""}
          className="self-start rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Ban user"}
        </button>
      </form>
    </div>
  );
}
