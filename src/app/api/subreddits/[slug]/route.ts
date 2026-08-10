import { getCurrentUser, requireCurrentUser } from "@/lib/auth";
import { handler, readJson } from "@/lib/route-helpers";
import { getSubredditView, updateSubredditSettings } from "@/lib/subreddits";

type Params = { params: Promise<{ slug: string }> };

/** GET /api/subreddits/[slug] — subreddit plus viewer-relative flags. */
export async function GET(_request: Request, { params }: Params) {
  return handler(async () => {
    const { slug } = await params;
    const user = await getCurrentUser();
    return { subreddit: await getSubredditView(slug, user?.id ?? null) };
  });
}

/** PATCH /api/subreddits/[slug] — moderator-only settings update. */
export async function PATCH(request: Request, { params }: Params) {
  return handler(async () => {
    const { slug } = await params;
    const user = await requireCurrentUser();
    const body = await readJson(request);

    return {
      subreddit: await updateSubredditSettings(slug, user.id, {
        description: body.description,
        bannerUrl: body.bannerUrl,
        iconUrl: body.iconUrl,
      }),
    };
  });
}
