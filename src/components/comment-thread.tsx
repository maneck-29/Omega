import Link from "next/link";
import type { CommentNode, CommentSort } from "@/lib/types";
import { VOTING_AVAILABLE } from "@/lib/scores";
import ReplyForm from "./reply-form";

/**
 * Recursive thread renderer.
 *
 * Depth is expressed as a left border and indent per level. Nodes past the depth
 * cap render a "continue this thread" link rather than nesting forever.
 */

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

function CommentRow({
  node,
  postId,
  subredditSlug,
  viewerId,
}: {
  node: CommentNode;
  postId: string;
  subredditSlug: string;
  viewerId: string | null;
}) {
  const { comment, author, score, isTombstone } = node;
  const isAuthor = viewerId !== null && comment.authorId === viewerId;

  return (
    <li className="border-l border-black/[.08] pl-3 dark:border-white/[.14]">
      <article className="py-2">
        <header className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          {isTombstone ? (
            <span className="italic">[deleted]</span>
          ) : (
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              {author?.username ?? "unknown"}
            </span>
          )}
          {VOTING_AVAILABLE && score && (
            <span>
              {score.score} {Math.abs(score.score) === 1 ? "point" : "points"}
            </span>
          )}
          <time dateTime={comment.createdAt}>{relativeTime(comment.createdAt)}</time>
          {comment.editedAt && <span className="italic">edited</span>}
        </header>

        <p
          className={`mt-1 whitespace-pre-wrap text-sm ${
            isTombstone
              ? "italic text-zinc-400"
              : "text-zinc-800 dark:text-zinc-200"
          }`}
        >
          {comment.body}
        </p>

        {!isTombstone && (
          <ReplyForm
            postId={postId}
            subredditSlug={subredditSlug}
            parentCommentId={comment.id}
            canDelete={isAuthor}
          />
        )}
      </article>

      {node.replies.length > 0 && (
        <ul className="ml-1">
          {node.replies.map((child) => (
            <CommentRow
              key={child.comment.id}
              node={child}
              postId={postId}
              subredditSlug={subredditSlug}
              viewerId={viewerId}
            />
          ))}
        </ul>
      )}

      {node.hasMoreReplies && (
        <Link
          href={`/r/${subredditSlug}/comments/${postId}?rootId=${comment.id}`}
          className="ml-1 inline-block py-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          continue this thread →
        </Link>
      )}
    </li>
  );
}

const SORT_OPTIONS: CommentSort[] = [
  "best",
  "top",
  "new",
  "old",
  "controversial",
];

export default function CommentThread({
  nodes,
  total,
  postId,
  subredditSlug,
  viewerId,
  sort,
}: {
  nodes: CommentNode[];
  total: number;
  postId: string;
  subredditSlug: string;
  viewerId: string | null;
  sort: CommentSort;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {total} {total === 1 ? "comment" : "comments"}
        </h2>
        <nav className="flex items-center gap-1 text-xs">
          {SORT_OPTIONS.map((option) => (
            <Link
              key={option}
              href={`/r/${subredditSlug}/comments/${postId}?sort=${option}`}
              className={`rounded px-2 py-1 ${
                option === sort
                  ? "bg-black/[.06] font-medium dark:bg-white/[.12]"
                  : "text-zinc-500 hover:bg-black/[.04] dark:hover:bg-white/[.08]"
              }`}
            >
              {option}
            </Link>
          ))}
        </nav>
      </div>

      {!VOTING_AVAILABLE && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/[.08] px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Voting is not wired up yet, so score-based sorts fall back to
          chronological order.
        </p>
      )}

      <ReplyForm postId={postId} subredditSlug={subredditSlug} parentCommentId={null} />

      {nodes.length === 0 ? (
        <p className="py-4 text-sm text-zinc-500">
          No comments yet. Start the thread.
        </p>
      ) : (
        <ul className="flex flex-col">
          {nodes.map((node) => (
            <CommentRow
              key={node.comment.id}
              node={node}
              postId={postId}
              subredditSlug={subredditSlug}
              viewerId={viewerId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
