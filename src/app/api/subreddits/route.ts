import { requireCurrentUser } from "@/lib/auth";
import { handler, readJson } from "@/lib/route-helpers";
import { createSubreddit, listSubreddits } from "@/lib/subreddits";

type SubredditSort = "popular" | "new" | "name";

const SORTS: SubredditSort[] = ["popular", "new", "name"];

function parseSort(value: string | null): SubredditSort {
  return SORTS.includes(value as SubredditSort)
    ? (value as SubredditSort)
    : "popular";
}

/** GET /api/subreddits — browse and search. */
export async function GET(request: Request) {
  const url = new URL(request.url);

  return handler(() =>
    listSubreddits({
      query: url.searchParams.get("q") ?? undefined,
      sort: parseSort(url.searchParams.get("sort")),
      limit: Math.min(Number(url.searchParams.get("limit")) || 25, 100),
      offset: Math.max(Number(url.searchParams.get("offset")) || 0, 0),
    }),
  );
}

/** POST /api/subreddits — create. Creator becomes owner-moderator + subscriber. */
export async function POST(request: Request) {
  return handler(
    async () => {
      const user = await requireCurrentUser();
      const body = await readJson(request);

      const subreddit = await createSubreddit({
        name: body.name,
        description: body.description,
        bannerUrl: body.bannerUrl,
        iconUrl: body.iconUrl,
        createdBy: user.id,
      });

      return { subreddit };
    },
    { status: 201 },
  );
}
