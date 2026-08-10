"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Inline comment composer. Collapsed to a "reply" button until opened, so a
 * thread is not a wall of textareas.
 */
export default function ReplyForm({
  postId,
  subredditSlug,
  parentCommentId,
  canDelete = false,
}: {
  postId: string;
  subredditSlug: string;
  parentCommentId: string | null;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const isTopLevel = parentCommentId === null;

  const [open, setOpen] = useState(isTopLevel);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, parentCommentId, subreddit: subredditSlug }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `Request failed (${response.status})`);
      }

      setBody("");
      if (!isTopLevel) setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!parentCommentId) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/comments/${parentCommentId}?subreddit=${encodeURIComponent(subredditSlug)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `Request failed (${response.status})`);
      }

      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          reply
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="text-xs font-medium text-zinc-500 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
          >
            delete
          </button>
        )}
        {error && (
          <span role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={isTopLevel ? "What are your thoughts?" : "Reply…"}
        aria-label={isTopLevel ? "Add a comment" : "Reply to comment"}
        rows={isTopLevel ? 4 : 3}
        className="w-full resize-y rounded-md border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-black/40 dark:border-white/[.16] dark:focus:border-white/40"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || body.trim() === ""}
          className="rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Saving…" : isTopLevel ? "Comment" : "Reply"}
        </button>
        {!isTopLevel && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-black/[.04] dark:hover:bg-white/[.08]"
          >
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
