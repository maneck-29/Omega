/**
 * /api/posts/[postId] — owned by TM2 (Posts & Voting).
 *
 *   GET    read one post
 *   PATCH  edit a post you authored
 *   DELETE soft-delete a post you authored
 *
 * The segment is named `postId` to match the sibling comments route
 * (`/api/posts/[postId]/comments`) — App Router requires one name per segment.
 */

import { getCurrentUser, requireCurrentUser } from "@/lib/auth";
import { deletePost, editPost, getPostView } from "@/lib/posts";
import { handler, readJson } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ postId: string }> };

export function GET(_request: Request, context: Context) {
  return handler(async () => {
    const { postId } = await context.params;
    const viewer = await getCurrentUser();
    const post = await getPostView(postId, viewer?.id ?? null);
    return { post };
  });
}

export function PATCH(request: Request, context: Context) {
  return handler(async () => {
    const { postId } = await context.params;
    const body = await readJson(request);
    const viewer = await requireCurrentUser();

    const post = await editPost({
      id: postId,
      viewerId: viewer.id,
      title: typeof body.title === "string" ? body.title : undefined,
      body: typeof body.body === "string" ? body.body : undefined,
      url: typeof body.url === "string" ? body.url : undefined,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : undefined,
    });

    return { post };
  });
}

export function DELETE(_request: Request, context: Context) {
  return handler(async () => {
    const { postId } = await context.params;
    const viewer = await requireCurrentUser();
    await deletePost(postId, viewer.id);
    return { ok: true };
  });
}
