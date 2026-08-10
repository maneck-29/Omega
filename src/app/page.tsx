import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import PostListSlot from "@/components/post-list-slot";
import { listSubreddits, listSubscribedSubreddits } from "@/lib/subreddits";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default async function Home() {
  await ensureSeeded();

  const user = await getCurrentUser();
  const [{ subreddits }, subscribed] = await Promise.all([
    listSubreddits({ sort: "popular", limit: 10 }),
    user ? listSubscribedSubreddits(user.id) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 gap-8 px-6 py-10">
      <main className="flex flex-1 flex-col gap-6">
        <PostListSlot subscribedOnly={Boolean(user)} />
      </main>

      <aside className="hidden w-64 shrink-0 flex-col gap-6 lg:flex">
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Your communities
            </h2>
            <Link
              href="/subreddits/create"
              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Create
            </Link>
          </div>
          {subscribed.length === 0 ? (
            <p className="text-xs text-zinc-500">Nothing joined yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {subscribed.map((subreddit) => (
                <li key={subreddit.id}>
                  <Link
                    href={`/r/${subreddit.slug}`}
                    className="text-sm hover:underline"
                  >
                    {subreddit.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Popular
            </h2>
            <Link
              href="/subreddits"
              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Browse
            </Link>
          </div>
          <ul className="flex flex-col gap-1">
            {subreddits.map((subreddit) => (
              <li key={subreddit.id} className="flex justify-between gap-2">
                <Link
                  href={`/r/${subreddit.slug}`}
                  className="truncate text-sm hover:underline"
                >
                  {subreddit.name}
                </Link>
                <span className="shrink-0 text-xs text-zinc-500">
                  {subreddit.subscriberCount}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-xs text-zinc-400">
          Signed in as {user?.username ?? "nobody"} (stub auth — TM1)
        </p>
      </aside>
    </div>
  );
}
