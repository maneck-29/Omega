import { requireCurrentUser } from "@/lib/auth";
import { setCommentRemoved } from "@/lib/comments";
import { badRequest } from "@/lib/errors";
import { handler, readJson } from "@/lib/route-helpers";
import { getSubredditBySlugOrThrow } from "@/lib/subreddits";

type Params = { params: Promise<{ slug: string }> };

/**
 * POST /api/subreddits/[slug]/moderation/comments — remove or approve a comment.
 *
 * Body: { commentId, removed: boolean, reason?: string }
 * Moderator removal is tracked separately from author deletion and is logged.
 */
export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const { slug } = await params;
    const user = await requireCurrentUser();
    const body = await readJson(request);

    if (typeof body.commentId !== "string") {
      throw badRequest("Field 'commentId' is required", "missing_comment_id");
    }
    if (typeof body.removed !== "boolean") {
      throw badRequest("Field 'removed' must be a boolean", "invalid_field");
    }

    const subreddit = await getSubredditBySlugOrThrow(slug);

    return {
      comment: await setCommentRemoved({
        commentId: body.commentId,
        actorId: user.id,
        subredditId: subreddit.id,
        removed: body.removed,
        reason: typeof body.reason === "string" ? body.reason : null,
      }),
    };
  });
}
