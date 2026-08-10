/**
 * /api/posts — owned by TM2 (Posts & Voting).
 *
 *   GET  list posts: ranked, searched, filtered, paginated
 *   POST create a post
 *
 * Query parameters:
 *   sort=hot|new|top|controversial|foryou
 *   q=<search>            substring match on title, body and URL
 *   type=text|link|image
 *   window=day|week|all   applies to sort=top
 *   subreddit=<slug>      restrict to one subreddit
 *   feed=subscribed       restrict to the viewer's subscriptions
 *   author=<userId>       post history
 *   limit, offset
 */

import { getCurrentUser, requireCurrentUser } from "@/lib/auth";
import { listForYouViews } from "@/lib/ai";
import { getRepository } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import {
  createPost,
  listPostViews,
  parsePostType,
  parseSort,
  parseWindow,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "@/lib/posts";
import { handler, readJson } from "@/lib/route-helpers";
import { getSubscribedSubredditIds } from "@/lib/subreddits";

export const dynamic = "force-dynamic";

function intParam(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function GET(request: Request) {
  return handler(async () => {
    const params = new URL(request.url).searchParams;
    const viewer = await getCurrentUser();
    const viewerId = viewer?.id ?? null;

    const limit = intParam(params.get("limit"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const offset = intParam(params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

    // The subscribed feed needs the viewer's subscriptions resolved first.
    let subredditIds: string[] | null = null;
    if (params.get("feed") === "subscribed") {
      if (!viewerId) throw badRequest("Sign in to see your feed", "no_viewer");
      subredditIds = await getSubscribedSubredditIds(viewerId);
    }

    // A slug is friendlier in URLs than an id, so resolve it here.
    let subredditId: string | null = null;
    const slug = params.get("subreddit");
    if (slug) {
      const subreddit = await getRepository().getSubredditBySlug(
        slug.toLowerCase(),
      );
      if (!subreddit) {
        throw notFound(`Subreddit "${slug}" not found`, "subreddit_not_found");
      }
      subredditId = subreddit.id;
    }

    // The personalised feed is a separate ranker, not a SQL sort mode.
    if (params.get("sort") === "foryou") {
      return listForYouViews(viewerId, { limit, offset, subredditIds });
    }

    return listPostViews(
      {
        sort: parseSort(params.get("sort")),
        query: params.get("q"),
        postType: parsePostType(params.get("type")),
        window: parseWindow(params.get("window")),
        subredditId,
        subredditIds,
        authorId: params.get("author"),
        limit,
        offset,
      },
      viewerId,
    );
  });
}

export function POST(request: Request) {
  return handler(
    async () => {
      const body = await readJson(request);
      const author = await requireCurrentUser();

      const slug = typeof body.subreddit === "string" ? body.subreddit.trim() : "";
      if (!slug) {
        throw badRequest("A post needs a subreddit", "subreddit_required");
      }

      const post = await createPost({
        author,
        subredditSlug: slug.toLowerCase(),
        title: typeof body.title === "string" ? body.title : "",
        body: typeof body.body === "string" ? body.body : null,
        postType: parsePostType(
          typeof body.postType === "string" ? body.postType : null,
        ),
        url: typeof body.url === "string" ? body.url : null,
        imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : null,
      });

      return { post };
    },
    { status: 201 },
  );
}
