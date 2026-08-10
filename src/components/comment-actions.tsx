"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Per-comment actions: reply, author delete, and moderator remove/approve.
 *
 * Replaces the earlier reply-only form. Moderator controls are rendered only
 * when the server says the viewer moderates this subreddit — the API enforces
 * that independently, so hiding them is presentation, not security.
 */
export default function CommentActions({
  postId,
  subredditSlug,
  commentId,
  canDelete,
  canModerate,
  isRemoved,
}: {
  postId: string;
  subredditSlug: string;
  commentId: string;
  canDelete: boolean;
  canModerate: boolean;
  isRemoved: boolean;
}) {
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(
    request: () => Promise<Response>,
    onSuccess?: () => void,
  ) {
    setPending(true);
    setError(null);

    try {
      const response = await request();
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `Request failed (${response.status})`);
      }
      onSuccess?.();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  const submitReply = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send(
      () =>
        fetch(`/api/posts/${postId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body,
            parentCommentId: commentId,
            subreddit: subredditSlug,
          }),
        }),
      () => {
        setBody("");
        setReplying(false);
      },
    );
  };

  const deleteComment = () =>
    void send(() =>
      fetch(
        `/api/comments/${commentId}?subreddit=${encodeURIComponent(subredditSlug)}`,
        { method: "DELETE" },
      ),
    );

  const setRemoved = (removed: boolean) =>
    void send(() =>
      fetch(`/api/subreddits/${subredditSlug}/moderation/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId, removed }),
      }),
    );

  const actionClass =
    "text-xs font-medium text-zinc-500 transition-colors disabled:opacity-40";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {!isRemoved && (
          <button
            type="button"
            onClick={() => setReplying((open) => !open)}
            className={`${actionClass} hover:text-zinc-800 dark:hover:text-zinc-200`}
          >
            reply
          </button>
        )}

        {canDelete && !isRemoved && (
          <button
            type="button"
            onClick={deleteComment}
            disabled={pending}
            className={`${actionClass} hover:text-red-600 dark:hover:text-red-400`}
          >
            delete
          </button>
        )}

        {canModerate &&
          (isRemoved ? (
            <button
              type="button"
              onClick={() => setRemoved(false)}
              disabled={pending}
              className={`${actionClass} hover:text-emerald-600 dark:hover:text-emerald-400`}
            >
              approve
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setRemoved(true)}
              disabled={pending}
              className={`${actionClass} hover:text-amber-600 dark:hover:text-amber-400`}
            >
              remove
            </button>
          ))}

        {error && (
          <span role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </span>
        )}
      </div>

      {replying && (
        <form onSubmit={submitReply} className="flex flex-col gap-2">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Reply…"
            aria-label="Reply to comment"
            rows={3}
            className="w-full resize-y rounded-md border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-black/40 dark:border-white/[.16] dark:focus:border-white/40"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending || body.trim() === ""}
              className="rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {pending ? "Saving…" : "Reply"}
            </button>
            <button
              type="button"
              onClick={() => setReplying(false)}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-black/[.04] dark:hover:bg-white/[.08]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
