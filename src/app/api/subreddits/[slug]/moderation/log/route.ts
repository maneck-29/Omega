import { requireCurrentUser } from "@/lib/auth";
import { handler } from "@/lib/route-helpers";
import { listModLog } from "@/lib/subreddits";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/subreddits/[slug]/moderation/log — moderator only.
 *
 * The audit trail names which moderator removed what, so it is not public.
 */
export async function GET(request: Request, { params }: Params) {
  const url = new URL(request.url);

  return handler(async () => {
    const { slug } = await params;
    const user = await requireCurrentUser();
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);

    return { entries: await listModLog(slug, user.id, limit) };
  });
}
