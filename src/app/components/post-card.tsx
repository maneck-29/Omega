"use client";

/**
 * A single post in the feed, styled as a social card.
 *
 * Handles the three post types, inline editing and deletion for posts the
 * visitor owns, and lazy-loaded comments. `is_owner` is computed on the server —
 * the owner token itself is never sent to the browser, so the edit and delete
 * controls cannot be revealed by tampering with client state.
 */

import { useState } from "react";
import type { Post } from "@/lib/posts";
import CommentThread from "./comment-thread";
import VoteControl from "./vote-control";
import { avatarFor, displayName, timeAgo } from "./format";

interface PostCardProps {
  post: Post;
  onDeleted: (id: string) => void;
}

export default function PostCard({ post, onDeleted }: PostCardProps) {
  const [current, setCurrent] = useState(post);
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(post.reply_count);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const avatar = avatarFor(current.author_name);

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/posts/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not save");
      }
      const { post: updated } = await response.json();
      setCurrent(updated);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this post?")) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/posts/${current.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not delete");
      }
      onDeleted(current.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete");
      setBusy(false);
    }
  }

  return (
    <article className="border-b border-hairline bg-surface">
      <header className="flex items-center gap-3 px-4 pt-3 pb-2">
        <span
          aria-hidden
          className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br ${avatar.gradient} text-sm font-bold text-white`}
        >
          {avatar.initial}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {displayName(current.author_name)}
          </p>
          <p className="text-xs text-muted">
            {timeAgo(current.created_at)}
            {current.edited_at && " · edited"}
            {current.post_type !== "text" && ` · ${current.post_type}`}
          </p>
        </div>

        {current.is_owner && !editing && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="rounded-full px-2 py-1 text-xs font-medium text-muted hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="rounded-full px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-500/10 disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        )}
      </header>

      {editing ? (
        <form onSubmit={saveEdit} className="px-4 pb-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            maxLength={500}
            aria-label="Edit post"
            className="w-full resize-none rounded-xl border border-hairline bg-background p-3 text-sm outline-none focus:border-accent/60"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || draft.trim() === ""}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(current.body);
                setError(null);
              }}
              className="rounded-full px-3 py-1.5 text-sm text-muted hover:bg-black/5 dark:hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="px-4 pb-3 text-[15px] leading-relaxed break-words whitespace-pre-wrap">
          {current.body}
        </p>
      )}

      {current.image_url && !imageFailed && (
        // Plain <img>: Omega does not support Next.js image optimisation, so
        // next/image would add a broken /_next/image round trip for no gain.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={current.image_url}
          alt={current.body.slice(0, 120)}
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="max-h-[70vh] w-full bg-black/5 object-cover dark:bg-white/5"
        />
      )}

      {current.url && (
        <a
          href={current.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-4 mb-3 block truncate rounded-xl border border-hairline px-3 py-2 text-sm text-blue-600 hover:bg-black/[0.03] dark:text-blue-400 dark:hover:bg-white/[0.04]"
        >
          {current.url}
        </a>
      )}

      <footer className="flex items-center gap-2 px-3 py-2">
        <VoteControl
          targetId={current.id}
          score={current.score}
          viewerVote={current.viewer_vote}
        />

        <button
          type="button"
          onClick={() => setShowComments((open) => !open)}
          aria-expanded={showComments}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted transition-colors hover:bg-black/5 dark:hover:bg-white/10"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M10 2.5c-4.14 0-7.5 2.8-7.5 6.25 0 1.94 1.06 3.67 2.72 4.82-.13.9-.53 1.98-1.35 3.02 1.6-.2 2.9-.86 3.83-1.5.73.17 1.5.26 2.3.26 4.14 0 7.5-2.8 7.5-6.6C17.5 5.3 14.14 2.5 10 2.5z" />
          </svg>
          {commentCount > 0 ? commentCount : "Reply"}
        </button>

        <span className="ml-auto pr-1 font-mono text-[11px] text-muted">
          {current.up_count}↑ {current.down_count}↓
        </span>
      </footer>

      {error && (
        <p role="alert" className="px-4 pb-2 text-xs text-red-500">
          {error}
        </p>
      )}

      {showComments && (
        <CommentThread postId={current.id} onCountChange={setCommentCount} />
      )}
    </article>
  );
}
