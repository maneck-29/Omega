import Link from "next/link";
import { notFound } from "next/navigation";
import UserPostList from "./user-post-list";
import { findUserByUsername, getCurrentUser } from "@/lib/auth";
import { getRepository } from "@/lib/db";
import { listPostViews } from "@/lib/posts";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default async function UserProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await ensureSeeded();

  const { username } = await params;
  const { tab: activeTab } = await searchParams;
  const tab = activeTab || "posts";

  // Resolves fixture users and the signed-in account alike.
  const user = findUserByUsername(username);
  if (!user) notFound();

  const viewer = await getCurrentUser();
  const isOwner = viewer?.id === user.id;
  const repo = getRepository();

  // Fetch posts
  const postResult = tab === "posts"
    ? await listPostViews(
        { authorId: user.id, limit: 20, offset: 0, sort: "new" },
        viewer?.id ?? null,
      )
    : null;

  // Fetch comments
  const comments = tab === "comments"
    ? await repo.listCommentsByAuthor(user.id, 20)
    : null;

  return (
    <div className="flex flex-1 flex-col">
      {/* Profile header */}
      <div className="h-20 w-full bg-gradient-to-r from-purple-500 to-pink-400" />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-200 text-2xl font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            {user.username[0].toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold">{user.username}</h1>
            <p className="text-sm text-zinc-500">u/{user.username}</p>
            {isOwner && (
              <span className="mt-1 inline-block rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
                This is you
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 border-b border-zinc-200 dark:border-zinc-700">
          <Link
            href={`/u/${user.username}?tab=posts`}
            className={`pb-2 text-sm font-medium ${
              tab === "posts"
                ? "border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            Posts
          </Link>
          <Link
            href={`/u/${user.username}?tab=comments`}
            className={`pb-2 text-sm font-medium ${
              tab === "comments"
                ? "border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            Comments
          </Link>
        </div>

        {/* Posts tab */}
        {tab === "posts" && postResult && (
          <UserPostList initialPosts={postResult.posts} />
        )}

        {/* Comments tab */}
        {tab === "comments" && comments && (
          <div className="flex flex-col gap-3">
            {comments.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">
                No comments yet.
              </p>
            ) : (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700"
                >
                  <p className="text-sm">{comment.body}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
                    <Link
                      href={`/r/unknown/comments/${comment.postId}`}
                      className="hover:text-indigo-500"
                    >
                      View thread →
                    </Link>
                    <span>·</span>
                    <time dateTime={comment.createdAt}>
                      {new Date(comment.createdAt).toLocaleDateString()}
                    </time>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
