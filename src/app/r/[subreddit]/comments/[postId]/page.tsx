import Link from "next/link";
import { notFound } from "next/navigation";
import CommentThread from "@/components/comment-thread";
import PostDetail from "@/components/post-detail";
import { getCurrentUser } from "@/lib/auth";
import { getCommentTree } from "@/lib/comments";
import { DomainError } from "@/lib/errors";
import { getPostView } from "@/lib/posts";
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
 * Shell and comment thread are TM3's; the post body is rendered with TM2's
 * `PostCard`, so it matches the feed exactly rather than being restyled here.
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

  /*
   * getPostView throws 404 for a deleted or removed post. That is right for an
   * API, but here the comments are still real, so a missing post degrades to a
   * tombstone instead of taking the whole page down.
   */
  let postView = null;
  try {
    postView = await getPostView(postId, user?.id ?? null);
  } catch (error) {
    if (!(error instanceof DomainError && error.status === 404)) throw error;
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
          {view.name}
        </Link>
      </nav>

      {/*
        The post itself, rendered with TM2's card so the thread page and the feed
        show identical titles, bodies and vote controls.

        A deleted or removed post renders a tombstone rather than 404ing: the
        comments beneath it are still real and must stay reachable, which is the
        same rule that governs tombstoned comments.
      */}
      {postView ? (
        <PostDetail view={postView} subredditSlug={view.slug} />
      ) : (
        <article className="rounded-lg border border-black/[.08] px-4 py-6 dark:border-white/[.12]">
          <p className="text-sm italic text-zinc-500">
            This post is no longer available.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Its comments are kept below.
          </p>
        </article>
      )}

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
          You are banned from {view.name} and cannot comment.
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
