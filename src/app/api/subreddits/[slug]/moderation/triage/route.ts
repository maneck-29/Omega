import { requireCurrentUser } from "@/lib/auth";
import { getRepository } from "@/lib/db";
import { badRequest, forbidden } from "@/lib/errors";
import { isModerationAiConfigured, triageComments } from "@/lib/moderation-ai";
import { assertModerator } from "@/lib/permissions";
import { handler } from "@/lib/route-helpers";
import { getSubredditBySlugOrThrow } from "@/lib/subreddits";

type Params = { params: Promise<{ slug: string }> };

/**
 * POST /api/subreddits/[slug]/moderation/triage — rank a post's comments by
 * likely rule breach. Moderator only.
 *
 * Body: { postId }
 *
 * Advisory: it returns an ordering and nothing else. Removal remains a separate,
 * explicit human action, so a false positive costs a moderator a glance rather
 * than silently hiding someone's comment.
 *
 * Scoped to one post because comments reference TM2's posts table and there is no
 * post-to-subreddit mapping on this side yet. Once TM2 exposes posts by
 * subreddit, this can cover a whole community's recent queue.
 */
export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const { slug } = await params;
    const user = await requireCurrentUser();

    if (!isModerationAiConfigured()) {
      throw forbidden(
        "AI triage is not configured. Connect the Omega Bedrock integration.",
        "ai_not_configured",
      );
    }

    const subreddit = await getSubredditBySlugOrThrow(slug);
    await assertModerator(user.id, subreddit.id);

    const body = await request.json().catch(() => null);
    const postId = (body as { postId?: unknown } | null)?.postId;

    if (typeof postId !== "string" || postId.trim() === "") {
      throw badRequest("Field 'postId' is required", "missing_post_id");
    }

    const repo = getRepository();
    const [comments, rules] = await Promise.all([
      repo.listCommentsByPost(postId),
      repo.listRules(subreddit.id),
    ]);

    const verdicts = await triageComments(comments, rules);

    return {
      postId,
      reviewed: verdicts.length,
      // Named to make the advisory nature obvious at the call site.
      suggestions: verdicts,
      note: "Advisory ranking only. No content has been removed.",
    };
  });
}
