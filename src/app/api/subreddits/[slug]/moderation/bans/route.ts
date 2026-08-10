import { requireCurrentUser } from "@/lib/auth";
import { getRepository } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { assertModerator } from "@/lib/permissions";
import { handler, readJson } from "@/lib/route-helpers";
import { banUser, getSubredditBySlugOrThrow, unbanUser } from "@/lib/subreddits";

type Params = { params: Promise<{ slug: string }> };

/** GET /api/subreddits/[slug]/moderation/bans — active bans, moderator only. */
export async function GET(_request: Request, { params }: Params) {
  return handler(async () => {
    const { slug } = await params;
    const user = await requireCurrentUser();
    const subreddit = await getSubredditBySlugOrThrow(slug);
    await assertModerator(user.id, subreddit.id);

    return { bans: await getRepository().listBans(subreddit.id) };
  });
}

/**
 * POST /api/subreddits/[slug]/moderation/bans — ban a user.
 *
 * Body: { userId, reason?, durationDays? }. Omit durationDays for permanent.
 */
export async function POST(request: Request, { params }: Params) {
  return handler(
    async () => {
      const { slug } = await params;
      const user = await requireCurrentUser();
      const body = await readJson(request);

      if (typeof body.userId !== "string") {
        throw badRequest("Field 'userId' is required", "missing_user_id");
      }

      return {
        ban: await banUser(slug, user.id, {
          userId: body.userId,
          reason: body.reason,
          durationDays:
            typeof body.durationDays === "number" ? body.durationDays : null,
        }),
      };
    },
    { status: 201 },
  );
}

/** DELETE /api/subreddits/[slug]/moderation/bans?userId= — unban. */
export async function DELETE(request: Request, { params }: Params) {
  return handler(async () => {
    const { slug } = await params;
    const user = await requireCurrentUser();

    const userId = new URL(request.url).searchParams.get("userId");
    if (!userId) {
      throw badRequest("Query param 'userId' is required", "missing_user_id");
    }

    await unbanUser(slug, user.id, userId);
    return { unbanned: true };
  });
}
