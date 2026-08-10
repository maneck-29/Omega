import { requireCurrentUser } from "@/lib/auth";
import { getRepository } from "@/lib/db";
import { handler, readJson } from "@/lib/route-helpers";
import { addRule, getSubredditBySlugOrThrow } from "@/lib/subreddits";

type Params = { params: Promise<{ slug: string }> };

/** GET /api/subreddits/[slug]/rules */
export async function GET(_request: Request, { params }: Params) {
  return handler(async () => {
    const { slug } = await params;
    const subreddit = await getSubredditBySlugOrThrow(slug);
    return { rules: await getRepository().listRules(subreddit.id) };
  });
}

/** POST /api/subreddits/[slug]/rules — moderator only. */
export async function POST(request: Request, { params }: Params) {
  return handler(
    async () => {
      const { slug } = await params;
      const user = await requireCurrentUser();
      const body = await readJson(request);

      return {
        rule: await addRule(slug, user.id, {
          title: body.title,
          description: body.description,
        }),
      };
    },
    { status: 201 },
  );
}
