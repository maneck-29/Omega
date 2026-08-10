import Link from "next/link";
import type { CommentNode, CommentSort } from "@/lib/types";
import { VOTING_AVAILABLE } from "@/lib/scores";
import CommentActions from "./comment-actions";
import TopLevelForm from "./top-level-form";
import VoteControl from "./vote-control";

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
  canModerate,
}: {
  node: CommentNode;
  postId: string;
  subredditSlug: string;
  viewerId: string | null;
  canModerate: boolean;
}) {
  const { comment, author, score, isTombstone } = node;
  const isAuthor = viewerId !== null && comment.authorId === viewerId;
  const isRemoved = comment.removedAt !== null;

  return (
    <li className="border-l border-black/[.08] pl-3 dark:border-white/[.14]">
      <article className="py-2">
        <header className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          {isTombstone ? (
            <span className="italic">
              {isRemoved ? "[removed]" : "[deleted]"}
            </span>
          ) : (
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              {author?.username ?? "unknown"}
            </span>
          )}
          <time dateTime={comment.createdAt}>{relativeTime(comment.createdAt)}</time>
          {comment.editedAt && <span className="italic">edited</span>}
          {isRemoved && canModerate && (
            <span className="rounded bg-amber-500/[.15] px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-400">
              removed by mod
            </span>
          )}
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

        {/*
          Comment voting goes through the same control and the same endpoint as
          post voting — votes are keyed by (targetType, targetId), so one table
          and one component serve both. A tombstoned comment is not votable.
        */}
        {VOTING_AVAILABLE && score && !isTombstone && (
          <div className="mt-1">
            <VoteControl
              targetId={comment.id}
              targetType="comment"
              score={score.score}
              viewerVote={score.viewerVote}
            />
          </div>
        )}

        {/*
          A removed comment still shows moderator controls so it can be approved
          back; an author-deleted one is final and shows nothing.
        */}
        {(!isTombstone || (isRemoved && canModerate)) && (
          <CommentActions
            postId={postId}
            subredditSlug={subredditSlug}
            commentId={comment.id}
            canDelete={isAuthor}
            canModerate={canModerate}
            isRemoved={isRemoved}
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
              canModerate={canModerate}
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
  canModerate = false,
  canComment = true,
}: {
  nodes: CommentNode[];
  total: number;
  postId: string;
  subredditSlug: string;
  viewerId: string | null;
  sort: CommentSort;
  canModerate?: boolean;
  canComment?: boolean;
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

      {canComment && (
        <TopLevelForm postId={postId} subredditSlug={subredditSlug} />
      )}

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
              canModerate={canModerate}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
