import Link from "next/link";
import { notFound } from "next/navigation";
import CommentThread from "@/components/comment-thread";
import { getCurrentUser } from "@/lib/auth";
import { getCommentTree } from "@/lib/comments";
import { DomainError } from "@/lib/errors";
import { ensureSeeded } from "@/lib/seed";
import { getSubredditView } from "@/lib/subreddits";
import type { CommentSort } from "@/lib/types";

export const dynamic = "force-dynamic";

const SORTS: CommentSort[] = ["best", "top", "new", "old", "controversial"];

function parseSort(value: string | undefined): CommentSort {
  return SORTS.includes(value as CommentSort) ? (value as CommentSort) : "best";
}

/**
 * Post page.
 *
 * Shell and comment thread are TM3's. The post body itself is TM2's component —
 * dropped into the slot marked below once their posts table exists.
 */
export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ subreddit: string; postId: string }>;
  searchParams: Promise<{ sort?: string; rootId?: string }>;
}) {
  await ensureSeeded();

  const [{ subreddit: slug, postId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const user = await getCurrentUser();

  let view;
  try {
    view = await getSubredditView(slug, user?.id ?? null);
  } catch (error) {
    if (error instanceof DomainError && error.status === 404) notFound();
    throw error;
  }

  const sort = parseSort(query.sort);
  const { nodes, total } = await getCommentTree(postId, {
    viewerId: user?.id ?? null,
    sort,
    rootId: query.rootId ?? null,
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
      <nav className="text-xs text-zinc-500">
        <Link href={`/r/${view.slug}`} className="hover:underline">
          r/{view.name}
        </Link>
      </nav>

      {/* TM2 slot: post title, body, vote controls. */}
      <article className="rounded-lg border border-dashed border-black/[.15] px-4 py-6 dark:border-white/[.18]">
        <p className="text-sm font-medium">Post body goes here</p>
        <p className="mt-1 text-xs text-zinc-500">
          Owned by TM2 (Posts &amp; Voting) — post id{" "}
          <code className="font-mono">{postId}</code>
        </p>
      </article>

      {query.rootId && (
        <Link
          href={`/r/${view.slug}/comments/${postId}?sort=${sort}`}
          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          ← View all comments
        </Link>
      )}

      {view.isBanned && (
        <p className="rounded-md border border-red-500/30 bg-red-500/[.08] px-3 py-2 text-sm text-red-700 dark:text-red-400">
          You are banned from r/{view.name} and cannot comment.
        </p>
      )}

      <CommentThread
        nodes={nodes}
        total={total}
        postId={postId}
        subredditSlug={view.slug}
        viewerId={user?.id ?? null}
        sort={sort}
        canModerate={view.isModerator}
        canComment={user !== null && !view.isBanned}
      />
    </div>
  );
}
