"use client";

/**
 * Comment thread for a post.
 *
 * Replies are ordinary post rows with a parent_id, so this reuses the same list
 * and create endpoints as the feed and votes flow through the same polymorphic
 * endpoint with targetType "comment".
 *
 * Loads lazily — nothing is fetched until the thread is expanded.
 */

import { useEffect, useState } from "react";
import type { Post } from "@/lib/posts";
import VoteControl from "./vote-control";
import { avatarFor, displayName, timeAgo } from "./format";

interface CommentThreadProps {
  postId: string;
  /** Kept in sync so the post's comment count reflects new replies. */
  onCountChange?: (count: number) => void;
}

export default function CommentThread({
  postId,
  onCountChange,
}: CommentThreadProps) {
  const [comments, setComments] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load replies on mount. State updates all happen after the first await, so
  // the effect does not trigger a cascading render, and `cancelled` stops a slow
  // response from writing to an unmounted component.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const response = await fetch(
          `/api/posts?parentId=${encodeURIComponent(postId)}&sort=new&limit=50`,
        );
        if (!response.ok) throw new Error("Could not load replies");
        const data = await response.json();
        if (!cancelled) setComments(data.posts ?? []);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Could not load replies",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (body.trim() === "") return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, parentId: postId, postType: "text" }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not post reply");
      }

      const { post } = await response.json();
      setComments((current) => {
        const next = [post, ...current];
        onCountChange?.(next.length);
        return next;
      });
      setBody("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not post reply");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-t border-hairline bg-black/[0.015] px-4 py-3 dark:bg-white/[0.02]">
      <form onSubmit={submit} className="mb-3 flex items-start gap-2">
        <input
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a reply…"
          aria-label="Add a reply"
          maxLength={500}
          className="min-w-0 flex-1 rounded-full border border-hairline bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent/60"
        />
        <button
          type="submit"
          disabled={submitting || body.trim() === ""}
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? "…" : "Reply"}
        </button>
      </form>

      {error && (
        <p role="alert" className="mb-2 text-xs text-red-500">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-2 text-xs text-muted">Loading replies…</p>
      ) : comments.length === 0 ? (
        <p className="py-2 text-xs text-muted">
          No replies yet. Be the first to pile on.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => {
            const avatar = avatarFor(comment.author_name);
            return (
              <li key={comment.id} className="flex items-start gap-2">
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${avatar.gradient} text-[11px] font-bold text-white`}
                >
                  {avatar.initial}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="rounded-2xl bg-surface px-3 py-2">
                    <p className="text-xs font-semibold">
                      {displayName(comment.author_name)}
                      <span className="ml-2 font-normal text-muted">
                        {timeAgo(comment.created_at)}
                      </span>
                    </p>
                    <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">
                      {comment.body}
                    </p>
                  </div>

                  <div className="mt-1 pl-1">
                    <VoteControl
                      targetId={comment.id}
                      targetType="comment"
                      score={comment.score}
                      viewerVote={comment.viewer_vote}
                      compact
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
