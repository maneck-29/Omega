"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Subreddit settings. Name is immutable — it is the identity and the URL.
 *
 * Banner and icon are not here: they are set by uploading a file in the Images
 * section above. Keeping a URL field alongside an upload gave two ways to set one
 * image, and the field could point at a host that later stopped serving it.
 */
export default function SettingsForm({
  slug,
  initialDescription,
}: {
  slug: string;
  initialDescription: string;
}) {
  const router = useRouter();
  const [description, setDescription] = useState(initialDescription);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch(`/api/subreddits/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `Request failed (${response.status})`);
      }

      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-black/40 dark:border-white/[.16] dark:focus:border-white/40";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Description</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          maxLength={500}
          className={`${inputClass} resize-y`}
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save settings"}
        </button>
        {saved && !error && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            Saved
          </span>
        )}
        {error && (
          <span role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
