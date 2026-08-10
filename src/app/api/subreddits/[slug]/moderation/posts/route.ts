import { requireCurrentUser } from "@/lib/auth";
import { badRequest } from "@/lib/errors";
import { setPostRemoved } from "@/lib/posts";
import { handler, readJson } from "@/lib/route-helpers";
import { getSubredditBySlugOrThrow } from "@/lib/subreddits";

type Params = { params: Promise<{ slug: string }> };

/**
 * POST /api/subreddits/[slug]/moderation/posts — remove or approve a post.
 *
 * Body: { postId, removed: boolean, reason?: string }
 *
 * The counterpart of the comments moderation route. Moderator removal is
 * tracked separately from author deletion and is logged; removed posts drop out
 * of every listing, sort and search because the repository filter excludes them.
 */
export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const { slug } = await params;
    const user = await requireCurrentUser();
    const body = await readJson(request);

    if (typeof body.postId !== "string") {
      throw badRequest("Field 'postId' is required", "missing_post_id");
    }
    if (typeof body.removed !== "boolean") {
      throw badRequest("Field 'removed' must be a boolean", "invalid_field");
    }

    const subreddit = await getSubredditBySlugOrThrow(slug);

    return {
      post: await setPostRemoved({
        postId: body.postId,
        actorId: user.id,
        subredditId: subreddit.id,
        removed: body.removed,
        reason: typeof body.reason === "string" ? body.reason : null,
      }),
    };
  });
}
