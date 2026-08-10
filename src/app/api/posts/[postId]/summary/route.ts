import { getCurrentUser } from "@/lib/auth";
import { getPostView } from "@/lib/posts";
import { handler } from "@/lib/route-helpers";
import { summarizeThread } from "@/lib/summary";

type Params = { params: Promise<{ postId: string }> };

/**
 * POST /api/posts/[postId]/summary — TL;DR of a post's comment thread.
 *
 * POST rather than GET because it can spend money: a GET invites prefetchers,
 * link previews and caches to trigger a model call nobody asked for. The
 * summary is read-only regardless — nothing is written and no comment changes.
 *
 * Open to any reader, including signed-out ones, because it summarises content
 * they can already read. The post title is resolved server-side rather than
 * accepted from the client, so a caller cannot steer the summary by supplying a
 * title the post does not have.
 */
export async function POST(_request: Request, { params }: Params) {
  return handler(async () => {
    const { postId } = await params;
    const user = await getCurrentUser();

    /*
     * A deleted or removed post 404s here even though its comments survive, in
     * step with `getPostView`. Summarising a thread whose post is gone would
     * need a title the reader can no longer see.
     */
    const view = await getPostView(postId, user?.id ?? null);

    const summary = await summarizeThread(postId, view.post.title);

    return { postId, summary };
  });
}
