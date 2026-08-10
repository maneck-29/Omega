import Link from "next/link";
import { ensureSeeded } from "@/lib/seed";
import { listSubreddits } from "@/lib/subreddits";

export const dynamic = "force-dynamic";

type Sort = "popular" | "new" | "name";
const SORTS: Sort[] = ["popular", "new", "name"];

/** Subreddit discovery: browse, search, sort. */
export default async function SubredditsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string }>;
}) {
  await ensureSeeded();

  const query = await searchParams;
  const sort = SORTS.includes(query.sort as Sort)
    ? (query.sort as Sort)
    : "popular";

  const { subreddits, total } = await listSubreddits({
    query: query.q,
    sort,
    limit: 50,
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Communities</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {total} {total === 1 ? "community" : "communities"}
          </p>
        </div>
        <Link
          href="/subreddits/create"
          className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background hover:opacity-90"
        >
          Create community
        </Link>
      </header>

      <form action="/subreddits" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query.q ?? ""}
          placeholder="Search communities"
          aria-label="Search communities"
          className="flex-1 rounded-md border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-black/40 dark:border-white/[.16] dark:focus:border-white/40"
        />
        <input type="hidden" name="sort" value={sort} />
        <button
          type="submit"
          className="rounded-md border border-black/[.12] px-4 py-2 text-sm font-medium hover:bg-black/[.04] dark:border-white/[.16] dark:hover:bg-white/[.08]"
        >
          Search
        </button>
      </form>

      <nav className="flex gap-1 text-xs">
        {SORTS.map((option) => (
          <Link
            key={option}
            href={`/subreddits?sort=${option}${query.q ? `&q=${encodeURIComponent(query.q)}` : ""}`}
            className={`rounded px-2 py-1 ${
              option === sort
                ? "bg-black/[.06] font-medium dark:bg-white/[.12]"
                : "text-zinc-500 hover:bg-black/[.04] dark:hover:bg-white/[.08]"
            }`}
          >
            {option}
          </Link>
        ))}
      </nav>

      {subreddits.length === 0 ? (
        <p className="py-6 text-sm text-zinc-500">No communities found.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-black/[.06] rounded-lg border border-black/[.08] dark:divide-white/[.08] dark:border-white/[.12]">
          {subreddits.map((subreddit) => (
            <li key={subreddit.id} className="px-4 py-3">
              <Link href={`/r/${subreddit.slug}`} className="group flex flex-col gap-1">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium group-hover:underline">
                    {subreddit.name}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {subreddit.subscriberCount}{" "}
                    {subreddit.subscriberCount === 1 ? "member" : "members"}
                  </span>
                </div>
                {subreddit.description && (
                  <p className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {subreddit.description}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
