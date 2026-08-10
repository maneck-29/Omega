/**
 * /api/posts
 *
 *   GET  list the feed — ranked, searched, filtered and paginated. Also serves
 *        replies when `parentId` is supplied, and the personalised feed when
 *        `sort=foryou`.
 *   POST create a post or a reply.
 *
 * Reads use `readIdentity` so a first-time visitor is never issued a cookie
 * just for browsing. Writes use `ensureIdentity`, which mints the owner token
 * on demand.
 */

import { NextResponse } from "next/server";
import { listForYou } from "@/lib/ai";
import { ensureIdentity, readIdentity } from "@/lib/identity";
import { errorResponse, intParam, readJson, str } from "@/lib/http";
import {
  createPost,
  listPosts,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  POST_TYPES,
  SORT_MODES,
  ValidationError,
  type PostType,
  type SortMode,
  type TimeWindow,
} from "@/lib/posts";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

const TIME_WINDOWS: readonly TimeWindow[] = ["day", "week", "all"];

export async function GET(request: Request) {
  try {
    await ensureSeeded();

    const url = new URL(request.url);
    const params = url.searchParams;
    const identity = await readIdentity();

    const limit = intParam(params.get("limit"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const offset = intParam(params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

    const requestedSort = params.get("sort");

    // The personalised feed is a separate ranker, not a SQL sort mode.
    if (requestedSort === "foryou") {
      const result = await listForYou(identity, { limit, offset });
      return NextResponse.json(result);
    }

    const sort: SortMode = SORT_MODES.includes(requestedSort as SortMode)
      ? (requestedSort as SortMode)
      : "hot";

    const typeParam = params.get("type");
    const postType = POST_TYPES.includes(typeParam as PostType)
      ? (typeParam as PostType)
      : null;

    const windowParam = params.get("window");
    const window = TIME_WINDOWS.includes(windowParam as TimeWindow)
      ? (windowParam as TimeWindow)
      : "all";

    const result = await listPosts(identity, {
      sort,
      search: params.get("q"),
      postType,
      parentId: params.get("parentId"),
      ownedOnly: params.get("mine") === "1",
      window,
      limit,
      offset,
    });

    return NextResponse.json(result);
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const identity = await ensureIdentity();

    const typeValue = str(body.postType) ?? "text";
    if (!POST_TYPES.includes(typeValue as PostType)) {
      throw new ValidationError("Unknown post type");
    }

    const post = await createPost(identity, {
      body: typeof body.body === "string" ? body.body : "",
      postType: typeValue as PostType,
      url: str(body.url),
      imageUrl: str(body.imageUrl),
      parentId: str(body.parentId),
      authorName: str(body.authorName),
    });

    return NextResponse.json({ post }, { status: 201 });
  } catch (cause) {
    return errorResponse(cause);
  }
}
