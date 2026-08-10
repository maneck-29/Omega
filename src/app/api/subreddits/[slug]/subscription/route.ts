import { requireCurrentUser } from "@/lib/auth";
import { handler } from "@/lib/route-helpers";
import { subscribe, unsubscribe } from "@/lib/subreddits";

type Params = { params: Promise<{ slug: string }> };

/** PUT /api/subreddits/[slug]/subscription — subscribe. Idempotent. */
export async function PUT(_request: Request, { params }: Params) {
  return handler(async () => {
    const { slug } = await params;
    const user = await requireCurrentUser();
    return subscribe(slug, user.id);
  });
}

/** DELETE /api/subreddits/[slug]/subscription — unsubscribe. Idempotent. */
export async function DELETE(_request: Request, { params }: Params) {
  return handler(async () => {
    const { slug } = await params;
    const user = await requireCurrentUser();
    return unsubscribe(slug, user.id);
  });
}
