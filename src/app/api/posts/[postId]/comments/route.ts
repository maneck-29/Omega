import { getCurrentUser, requireCurrentUser } from "@/lib/auth";
import { createComment, getCommentTree } from "@/lib/comments";
import { badRequest } from "@/lib/errors";
import { handler, readJson } from "@/lib/route-helpers";
import { getSubredditBySlugOrThrow } from "@/lib/subreddits";
import type { CommentSort } from "@/lib/types";

type Params = { params: Promise<{ postId: string }> };

const SORTS: CommentSort[] = ["best", "top", "new", "old", "controversial"];

function parseSort(value: string | null): CommentSort {
  return SORTS.includes(value as CommentSort) ? (value as CommentSort) : "best";
}

/**
 * GET /api/posts/[postId]/comments — threaded comments for a post.
 *
 * `?rootId=` renders a subtree ("continue this thread"); `?sort=` selects
 * ordering. Score-dependent sorts fall back to chronological until TM2's voting
 * provider is wired in.
 */
export async function GET(request: Request, { params }: Params) {
  const url = new URL(request.url);

  return handler(async () => {
    const { postId } = await params;
    const user = await getCurrentUser();

    return getCommentTree(postId, {
      viewerId: user?.id ?? null,
      sort: parseSort(url.searchParams.get("sort")),
      rootId: url.searchParams.get("rootId"),
    });
  });
}

/**
 * POST /api/posts/[postId]/comments — create a comment or reply.
 *
 * `subreddit` (slug) is required: comments inherit moderation from the subreddit
 * the post belongs to, so the ban check needs it. Once TM2's posts table exists
 * this is derived from the post row instead of the request body.
 */
export async function POST(request: Request, { params }: Params) {
  return handler(
    async () => {
      const { postId } = await params;
      const user = await requireCurrentUser();
      const body = await readJson(request);

      if (typeof body.subreddit !== "string") {
        throw badRequest(
          "Field 'subreddit' (slug) is required",
          "missing_subreddit",
        );
      }

      const subreddit = await getSubredditBySlugOrThrow(body.subreddit);

      const comment = await createComment({
        postId,
        subredditId: subreddit.id,
        parentCommentId:
          typeof body.parentCommentId === "string" ? body.parentCommentId : null,
        authorId: user.id,
        body: body.body,
      });

      return { comment };
    },
    { status: 201 },
  );
}
