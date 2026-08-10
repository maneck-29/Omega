"use client";

/**
 * A post in the feed. Owned by TM2 (Posts & Voting).
 *
 * Renders the three post types, links through to TM3's comment thread, and
 * exposes edit and delete only to the author. `isOwner` is decided on the server
 * so the controls cannot be revealed by editing client state — the API re-checks
 * authorship on every write regardless.
 */

import Link from "next/link";
import { useState } from "react";
import type { PostView } from "@/lib/types";
import VoteControl from "./vote-control";

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";

  const units: [label: string, secs: number][] = [
    ["y", 31_536_000],
    ["mo", 2_592_000],
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
  ];

  for (const [label, secs] of units) {
    const value = Math.floor(seconds / secs);
    if (value >= 1) return `${value}${label} ago`;
  }
  return "just now";
}

const AVATAR_GRADIENTS = [
  "from-rose-400 to-orange-400",
  "from-sky-400 to-indigo-500",
  "from-emerald-400 to-teal-500",
  "from-fuchsia-400 to-purple-500",
  "from-amber-400 to-pink-500",
  "from-cyan-400 to-blue-500",
];

/** Stable gradient per username, so an avatar does not change between renders. */
function avatarFor(name: string): { initial: string; gradient: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 100000;
  }
  return {
    initial: name.charAt(0).toUpperCase(),
    gradient: AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length],
  };
}

export default function PostCard({
  view,
  onDeleted,
}: {
  view: PostView;
  onDeleted: (id: string) => void;
}) {
  const [current, setCurrent] = useState(view);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(view.post.title);
  const [draftBody, setDraftBody] = useState(view.post.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const { post, author, score, subreddit, commentCount } = current;
  const username = author?.username ?? "unknown";
  const avatar = avatarFor(username);

  const threadHref = subreddit
    ? `/r/${subreddit.slug}/comments/${post.id}`
    : null;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draftTitle, body: draftBody }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not save");
      }
      const { post: updated } = await response.json();
      setCurrent((value) => ({ ...value, post: updated.post ?? updated }));
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
      const response = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not delete");
      }
      onDeleted(post.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete");
      setBusy(false);
    }
  }

  return (
    <article className="rounded-xl border border-black/[.08] bg-white/60 dark:border-white/[.12] dark:bg-white/[.02]">
      <header className="flex items-center gap-3 px-4 pt-3">
        <span
          aria-hidden
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${avatar.gradient} text-xs font-bold text-white`}
        >
          {avatar.initial}
        </span>

        <div className="min-w-0 flex-1 text-xs text-zinc-500">
          {subreddit && (
            <>
              <Link
                href={`/r/${subreddit.slug}`}
                className="font-semibold text-zinc-800 hover:underline dark:text-zinc-200"
              >
                r/{subreddit.name}
              </Link>
              <span aria-hidden> · </span>
            </>
          )}
          <span>{username}</span>
          <span aria-hidden> · </span>
          <time dateTime={post.createdAt}>{relativeTime(post.createdAt)}</time>
          {post.editedAt && <span className="italic"> · edited</span>}
        </div>

        {current.isOwner && !editing && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-40 dark:text-red-400"
            >
              Delete
            </button>
          </div>
        )}
      </header>

      {editing ? (
        <form onSubmit={save} className="px-4 py-3">
          <input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            aria-label="Post title"
            maxLength={300}
            className="mb-2 w-full rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none focus:border-orange-500/60 dark:border-white/[.16]"
          />
          <textarea
            value={draftBody}
            onChange={(event) => setDraftBody(event.target.value)}
            rows={3}
            aria-label="Post body"
            maxLength={2000}
            placeholder="Optional detail"
            className="w-full resize-none rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none focus:border-orange-500/60 dark:border-white/[.16]"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || draftTitle.trim() === ""}
              className="rounded-full bg-orange-600 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraftTitle(post.title);
                setDraftBody(post.body);
                setError(null);
              }}
              className="rounded-full px-3 py-1.5 text-xs text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="px-4 py-2">
          {threadHref ? (
            <Link href={threadHref} className="group">
              <h2 className="text-[15px] font-semibold leading-snug group-hover:underline">
                {post.title}
              </h2>
            </Link>
          ) : (
            <h2 className="text-[15px] font-semibold leading-snug">
              {post.title}
            </h2>
          )}
          {post.body && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
              {post.body}
            </p>
          )}
        </div>
      )}

      {post.imageUrl && !imageFailed && (
        // Plain <img>: Omega does not support Next.js image optimisation, so
        // next/image would add a /_next/image round trip that 404s there.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.imageUrl}
          alt={post.title}
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="max-h-[32rem] w-full bg-black/5 object-cover dark:bg-white/5"
        />
      )}

      {post.url && (
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-4 mb-2 block truncate rounded-lg border border-black/[.08] px-3 py-2 text-xs text-blue-600 hover:bg-black/[.03] dark:border-white/[.12] dark:text-blue-400 dark:hover:bg-white/[.04]"
        >
          {post.url}
        </a>
      )}

      <footer className="flex items-center gap-3 px-3 py-2">
        <VoteControl
          targetId={post.id}
          score={score.score}
          viewerVote={score.viewerVote}
        />

        {threadHref && (
          <Link
            href={threadHref}
            className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M10 2.5c-4.14 0-7.5 2.8-7.5 6.25 0 1.94 1.06 3.67 2.72 4.82-.13.9-.53 1.98-1.35 3.02 1.6-.2 2.9-.86 3.83-1.5.73.17 1.5.26 2.3.26 4.14 0 7.5-2.8 7.5-6.6C17.5 5.3 14.14 2.5 10 2.5z" />
            </svg>
            {commentCount === 1 ? "1 comment" : `${commentCount} comments`}
          </Link>
        )}

        <span className="ml-auto pr-1 font-mono text-[11px] text-zinc-400">
          {score.upvotes}↑ {score.downvotes}↓
        </span>
      </footer>

      {error && (
        <p role="alert" className="px-4 pb-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </article>
  );
}
