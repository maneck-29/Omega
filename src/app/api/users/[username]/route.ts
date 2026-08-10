/**
 * /api/users/[username] — owned by TM1 (Authentication & User Management).
 *
 *   GET  public profile: user info, post history, comment history.
 *
 * Query parameters:
 *   tab=posts|comments   defaults to posts
 *   limit, offset        pagination
 */

import { DEV_USERS, getCurrentUser } from "@/lib/auth";
import { getRepository } from "@/lib/db";
import { listPostViews } from "@/lib/posts";
import { handler } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ username: string }> };

export function GET(request: Request, context: Context) {
  return handler(async () => {
    const { username } = await context.params;
    const url = new URL(request.url);
    const tab = url.searchParams.get("tab") || "posts";
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "20"),
      50,
    );
    const offset = parseInt(url.searchParams.get("offset") || "0");

    // Find user by username
    const user = DEV_USERS.find(
      (u) => u.username.toLowerCase() === username.toLowerCase(),
    );
    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const viewer = await getCurrentUser();
    const repo = getRepository();

    if (tab === "comments") {
      const comments = await repo.listCommentsByAuthor(user.id, limit);
      return {
        user,
        tab,
        comments,
        isOwner: viewer?.id === user.id,
      };
    }

    // Default: posts tab
    const result = await listPostViews(
      { authorId: user.id, limit, offset, sort: "new" },
      viewer?.id ?? null,
    );

    return {
      user,
      tab,
      posts: result.posts,
      hasMore: result.hasMore,
      nextOffset: result.nextOffset,
      total: result.total,
      isOwner: viewer?.id === user.id,
    };
  });
}
