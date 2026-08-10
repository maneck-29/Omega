import { requireCurrentUser } from "@/lib/auth";
import { deleteComment, editComment } from "@/lib/comments";
import { badRequest } from "@/lib/errors";
import { handler, readJson } from "@/lib/route-helpers";
import { getSubredditBySlugOrThrow } from "@/lib/subreddits";

type Params = { params: Promise<{ commentId: string }> };

/** PATCH /api/comments/[commentId] — author-only edit. */
export async function PATCH(request: Request, { params }: Params) {
  return handler(async () => {
    const { commentId } = await params;
    const user = await requireCurrentUser();
    const body = await readJson(request);

    return {
      comment: await editComment({
        commentId,
        actorId: user.id,
        body: body.body,
      }),
    };
  });
}

/**
 * DELETE /api/comments/[commentId] — author or moderator.
 *
 * Soft delete: the row is tombstoned so replies beneath it stay reachable.
 */
export async function DELETE(request: Request, { params }: Params) {
  return handler(async () => {
    const { commentId } = await params;
    const user = await requireCurrentUser();

    // Moderator fallback needs the subreddit; authors are allowed regardless.
    const slug = new URL(request.url).searchParams.get("subreddit");
    if (!slug) {
      throw badRequest(
        "Query param 'subreddit' (slug) is required",
        "missing_subreddit",
      );
    }

    const subreddit = await getSubredditBySlugOrThrow(slug);

    return {
      comment: await deleteComment({
        commentId,
        actorId: user.id,
        subredditId: subreddit.id,
      }),
    };
  });
}
