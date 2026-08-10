/**
 * Post service — owned by TM2 (Posts & Voting).
 *
 * Sits between the route handlers and the repository: validation, permission
 * checks, and assembling the `PostView` shape the UI renders (post + author +
 * score + comment count + subreddit).
 *
 * Two obligations from `docs/integration-contract.md` are discharged here:
 *
 *  1. `assertCanPost` is called before every create. Without it a ban only looks
 *     enforced — TM3 stores bans, but TM2 owns the post-creation path.
 *  2. Author-deleted and moderator-removed posts are excluded from every
 *     listing, sort, search and pagination query. The repository filter does
 *     this centrally so no call site can forget.
 */

import { getUsersByIds } from "./auth";
import { getCommentCount } from "./comments";
import { getRepository } from "./db";
import { badRequest, forbidden, notFound } from "./errors";
import { assertCanPost, assertModerator } from "./permissions";
import { getScoreProvider } from "./scores";
import type {
  Post,
  PostId,
  PostSort,
  PostType,
  PostView,
  PostWindow,
  PublicUser,
  Score,
  SubredditId,
  UserId,
} from "./types";

export const MAX_TITLE_LENGTH = 300;
export const MAX_BODY_LENGTH = 2000;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export const POST_TYPES: readonly PostType[] = ["text", "link", "image"];
export const POST_SORTS: readonly PostSort[] = [
  "hot",
  "new",
  "top",
  "controversial",
];
export const POST_WINDOWS: readonly PostWindow[] = ["day", "week", "all"];

/** Narrow an untrusted string to a sort, falling back to `hot`. */
export function parseSort(value: string | null | undefined): PostSort {
  return POST_SORTS.includes(value as PostSort) ? (value as PostSort) : "hot";
}

export function parsePostType(
  value: string | null | undefined,
): PostType | null {
  return POST_TYPES.includes(value as PostType) ? (value as PostType) : null;
}

export function parseWindow(value: string | null | undefined): PostWindow {
  return POST_WINDOWS.includes(value as PostWindow)
    ? (value as PostWindow)
    : "all";
}

/**
 * Escape LIKE wildcards so a literal % or _ in a search term is matched as text.
 * Without this, searching "%" would match every row.
 */
export function escapeLike(term: string): string {
  return term.replace(/([\\%_])/g, "\\$1");
}

/** Only http(s) URLs, so javascript: and data: cannot be stored. */
function validateUrl(raw: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw badRequest(`${field} must be a valid URL, including https://`, "invalid_url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw badRequest(`${field} must be an http or https URL`, "invalid_url");
  }
  return parsed.toString();
}

function validateTitle(raw: string): string {
  const title = raw.trim();
  if (title === "") throw badRequest("A post needs a title", "title_required");
  if (title.length > MAX_TITLE_LENGTH) {
    throw badRequest(
      `Title must be ${MAX_TITLE_LENGTH} characters or fewer`,
      "title_too_long",
    );
  }
  return title;
}

function validateBody(raw: string | null | undefined): string {
  const body = (raw ?? "").trim();
  if (body.length > MAX_BODY_LENGTH) {
    throw badRequest(
      `Body must be ${MAX_BODY_LENGTH} characters or fewer`,
      "body_too_long",
    );
  }
  return body;
}

export type ListPostsOptions = {
  subredditId?: SubredditId | null;
  subredditIds?: SubredditId[] | null;
  authorId?: UserId | null;
  query?: string | null;
  postType?: PostType | null;
  sort?: PostSort;
  window?: PostWindow;
  limit?: number;
  offset?: number;
};

export type ListPostsResult = {
  posts: PostView[];
  hasMore: boolean;
  nextOffset: number;
  total: number;
};

/**
 * Assemble `PostView`s for a set of posts.
 *
 * Authors, scores and subreddits are fetched in batches rather than per post, so
 * rendering a page costs a fixed number of queries instead of N per row.
 */
export async function toPostViews(
  posts: Post[],
  viewerId: UserId | null,
): Promise<PostView[]> {
  if (posts.length === 0) return [];

  const repo = getRepository();

  const [authors, scores, commentCounts, subreddits] = await Promise.all([
    getUsersByIds([...new Set(posts.map((p) => p.authorId))]),
    getScoreProvider().getScores(
      "post",
      posts.map((p) => p.id),
      viewerId,
    ),
    Promise.all(posts.map((post) => getCommentCount(post.id))),
    Promise.all(
      [...new Set(posts.map((p) => p.subredditId))].map((id) =>
        repo.getSubredditById(id),
      ),
    ),
  ]);

  const subredditsById = new Map(
    subreddits
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => [s.id, { id: s.id, name: s.name, slug: s.slug }]),
  );

  const fallbackScore = (post: Post): Score => ({
    targetType: "post",
    targetId: post.id,
    score: post.score,
    upvotes: post.upvotes,
    downvotes: post.downvotes,
    viewerVote: 0,
  });

  return posts.map((post, index) => ({
    post,
    author: authors.get(post.authorId) ?? null,
    score: scores.get(post.id) ?? fallbackScore(post),
    commentCount: commentCounts[index],
    subreddit: subredditsById.get(post.subredditId) ?? null,
    isOwner: viewerId !== null && post.authorId === viewerId,
  }));
}

/**
 * Ranked, filtered, paginated listing.
 *
 * Offset pagination rather than a keyset cursor: `hot` and `controversial` are
 * derived from vote tallies that move while a visitor scrolls, so a cursor would
 * drift regardless. The total is returned so the client can show progress.
 */
export async function listPostViews(
  options: ListPostsOptions,
  viewerId: UserId | null,
): Promise<ListPostsResult> {
  const limit = Math.min(
    Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const offset = Math.max(options.offset ?? 0, 0);
  const query = options.query?.trim()
    ? escapeLike(options.query.trim())
    : null;

  const repo = getRepository();
  const listOptions = {
    subredditId: options.subredditId ?? null,
    subredditIds: options.subredditIds ?? null,
    authorId: options.authorId ?? null,
    query,
    postType: options.postType ?? null,
    sort: options.sort ?? "hot",
    window: options.window ?? "all",
    limit,
    offset,
  };

  const [posts, total] = await Promise.all([
    repo.listPosts(listOptions),
    repo.countPosts(listOptions),
  ]);

  return {
    posts: await toPostViews(posts, viewerId),
    hasMore: offset + posts.length < total,
    nextOffset: offset + posts.length,
    total,
  };
}

export async function getPostView(
  id: PostId,
  viewerId: UserId | null,
): Promise<PostView> {
  const post = await getRepository().getPostById(id);

  // Author-deleted and moderator-removed posts are not readable through this
  // path; TM3's thread page renders its own tombstone.
  if (!post || post.deletedAt || post.removedAt) {
    throw notFound("Post not found", "post_not_found");
  }

  const [view] = await toPostViews([post], viewerId);
  return view;
}

export type CreatePostArgs = {
  author: PublicUser;
  /** Route param; resolved to an id by `assertCanPost`. */
  subredditSlug: string;
  title: string;
  body?: string | null;
  postType?: PostType | null;
  url?: string | null;
  imageUrl?: string | null;
};

export async function createPost(args: CreatePostArgs): Promise<PostView> {
  const postType = args.postType ?? "text";
  if (!POST_TYPES.includes(postType)) {
    throw badRequest("Unknown post type", "invalid_post_type");
  }

  const title = validateTitle(args.title);
  const body = validateBody(args.body);

  let url: string | null = null;
  if (postType === "link") {
    if (!args.url?.trim()) {
      throw badRequest("A link post needs a URL", "url_required");
    }
    url = validateUrl(args.url.trim(), "URL");
  }

  let imageUrl: string | null = null;
  if (postType === "image") {
    if (!args.imageUrl?.trim()) {
      throw badRequest("An image post needs an image URL", "image_required");
    }
    imageUrl = validateUrl(args.imageUrl.trim(), "Image URL");
  }

  // Ban enforcement. TM3 stores bans but cannot enforce them on this path.
  const { subredditId } = await assertCanPost(args.author.id, args.subredditSlug);

  const post = await getRepository().createPost({
    subredditId,
    authorId: args.author.id,
    title,
    body,
    postType,
    url,
    imageUrl,
  });

  const [view] = await toPostViews([post], args.author.id);
  return view;
}

/** Load a post for a write, rejecting anything the viewer may not modify. */
async function loadOwnPost(id: PostId, viewerId: UserId): Promise<Post> {
  const post = await getRepository().getPostById(id);
  if (!post || post.deletedAt) {
    throw notFound("Post not found", "post_not_found");
  }
  if (post.removedAt) {
    throw forbidden("This post was removed by a moderator", "post_removed");
  }
  if (post.authorId !== viewerId) {
    throw forbidden("You can only change your own posts", "not_author");
  }
  return post;
}

export type EditPostArgs = {
  id: PostId;
  viewerId: UserId;
  title?: string;
  body?: string | null;
  url?: string | null;
  imageUrl?: string | null;
};

export async function editPost(args: EditPostArgs): Promise<PostView> {
  const existing = await loadOwnPost(args.id, args.viewerId);

  const patch: {
    title?: string;
    body?: string;
    url?: string | null;
    imageUrl?: string | null;
  } = {};

  if (args.title !== undefined) patch.title = validateTitle(args.title);
  if (args.body !== undefined) patch.body = validateBody(args.body);

  if (args.url !== undefined) {
    if (existing.postType !== "link") {
      throw badRequest("Only a link post has a URL", "not_a_link_post");
    }
    patch.url = args.url?.trim() ? validateUrl(args.url.trim(), "URL") : null;
  }

  if (args.imageUrl !== undefined) {
    if (existing.postType !== "image") {
      throw badRequest("Only an image post has an image URL", "not_an_image_post");
    }
    patch.imageUrl = args.imageUrl?.trim()
      ? validateUrl(args.imageUrl.trim(), "Image URL")
      : null;
  }

  if (Object.keys(patch).length === 0) {
    const [unchanged] = await toPostViews([existing], args.viewerId);
    return unchanged;
  }

  const updated = await getRepository().updatePost(args.id, patch);
  const [view] = await toPostViews([updated], args.viewerId);
  return view;
}

/** Author deletion. Soft, so comments beneath the post stay reachable. */
export async function deletePost(
  id: PostId,
  viewerId: UserId,
): Promise<void> {
  await loadOwnPost(id, viewerId);
  await getRepository().softDeletePost(id);
}

/**
 * Moderator removal or approval.
 *
 * TM3's moderation owns the decision; TM2 owns the `removedAt`/`removedBy`
 * columns and every query that has to respect them, so the write lives here.
 * Mirrors `setCommentRemoved` in `comments.ts`: moderator-gated, distinct from
 * author deletion, and recorded in the mod log.
 *
 * Without this, `removedAt` was unreachable — the filter existed but nothing
 * could ever set the flag.
 */
export async function setPostRemoved(input: {
  postId: PostId;
  actorId: UserId;
  subredditId: SubredditId;
  removed: boolean;
  reason?: string | null;
}): Promise<Post> {
  const repo = getRepository();
  await assertModerator(input.actorId, input.subredditId);

  const post = await repo.getPostById(input.postId);
  if (!post) throw notFound("Post not found", "post_not_found");

  // A post can only be moderated in the community it was posted to.
  if (post.subredditId !== input.subredditId) {
    throw forbidden(
      "That post is not in this community",
      "post_wrong_subreddit",
    );
  }

  const updated = await repo.setPostRemoved(
    input.postId,
    input.removed ? input.actorId : null,
  );

  await repo.addModLogEntry({
    subredditId: input.subredditId,
    moderatorId: input.actorId,
    action: input.removed ? "remove_post" : "approve_post",
    targetType: "post",
    targetId: input.postId,
    reason: input.reason ?? null,
  });

  return updated;
}
