import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DEV_USERS } from "@/lib/auth";
import { getRepository } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import PostList from "@/components/post-list";

/**
 * A user's profile: their stats and everything they have posted.
 *
 * Note on ownership: `docs/integration-contract.md` assigns `/u/[username]` to
 * TM1. This is a working version built on the auth stub's fixture users, since
 * the profile is only useful once posts exist. When TM1 ships real accounts they
 * should replace the username lookup below — the rest reads through the
 * repository and needs no change.
 */

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ username: string }> };

export default async function UserProfile({ params }: Params) {
  await ensureSeeded();

  const { username } = await params;
  const decoded = decodeURIComponent(username).toLowerCase();

  // TM1 replaces this with a real lookup; the fixture users are all we have.
  const user = DEV_USERS.find((u) => u.username.toLowerCase() === decoded);
  if (!user) notFound();

  const repo = getRepository();

  // A generous page of their posts, purely to compute the summary figures.
  const [posts, comments] = await Promise.all([
    repo.listPosts({ authorId: user.id, sort: "new", limit: 50, offset: 0 }),
    repo.listCommentsByAuthor(user.id, 100),
  ]);

  const postScore = posts.reduce((total, post) => total + post.score, 0);

  const initial = user.username.charAt(0).toUpperCase();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">
      <header className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-rose-500 text-2xl font-bold text-white"
        >
          {initial}
        </span>

        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight">
            {user.username}
          </h1>
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            <div className="flex gap-1">
              <dt>Posts</dt>
              <dd className="font-semibold text-zinc-800 dark:text-zinc-200">
                {posts.length}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>Points</dt>
              <dd className="font-semibold text-zinc-800 dark:text-zinc-200">
                {postScore}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>Comments</dt>
              <dd className="font-semibold text-zinc-800 dark:text-zinc-200">
                {comments.length}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Posts
        </h2>
        {/* PostList reads the feed from the URL, so it needs a Suspense boundary. */}
        <Suspense
          fallback={<p className="text-xs text-zinc-500">Loading posts…</p>}
        >
          <PostList authorId={user.id} />
        </Suspense>
      </section>
    </div>
  );
}
