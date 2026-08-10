"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SUBREDDIT_NAME_MAX, SUBREDDIT_NAME_MIN } from "@/lib/validation";

export default function CreateSubredditForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/subreddits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed (${response.status})`);
      }

      router.push(`/r/${payload.subreddit.slug}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Name</span>
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-zinc-500">r/</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={SUBREDDIT_NAME_MIN}
            maxLength={SUBREDDIT_NAME_MAX}
            placeholder="community_name"
            className="flex-1 rounded-md border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-black/40 dark:border-white/[.16] dark:focus:border-white/40"
          />
        </div>
        <span className="text-xs text-zinc-500">
          {SUBREDDIT_NAME_MIN}–{SUBREDDIT_NAME_MAX} characters. Letters, numbers,
          and underscores. Names are case-insensitive.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Description</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="What is this community about?"
          className="w-full resize-y rounded-md border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-black/40 dark:border-white/[.16] dark:focus:border-white/40"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || name.trim().length < SUBREDDIT_NAME_MIN}
        className="self-start rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Creating…" : "Create community"}
      </button>
    </form>
  );
}
