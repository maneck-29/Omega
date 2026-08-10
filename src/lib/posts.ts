/**
 * Posts data layer: create, read, edit, soft-delete, plus the ranked/searched/
 * paginated feed queries.
 *
 * A post and a comment are the same row shape — a reply is a post with a
 * non-null `parent_id`. That keeps ranking, voting and soft-delete uniform
 * across both and lets the comments slice reuse everything here.
 *
 * Security note: `anon_owner_token` is a bearer credential. Anyone holding it
 * can edit or delete that post, so it is never selected into a shape that
 * reaches the browser. Ownership is resolved on the server and exposed only as
 * the boolean `is_owner`.
 */

import { query } from "./db";
import { ownsRecord, type Identity } from "./identity";

export type PostType = "text" | "link" | "image";
export type SortMode = "hot" | "new" | "top" | "controversial";
export type TimeWindow = "day" | "week" | "all";

export const POST_TYPES: readonly PostType[] = ["text", "link", "image"];
export const SORT_MODES: readonly SortMode[] = [
  "hot",
  "new",
  "top",
  "controversial",
];

export const MAX_BODY_LENGTH = 500;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

/** Shape returned to callers. Deliberately excludes anon_owner_token. */
export interface Post {
  id: string;
  body: string;
  post_type: PostType;
  url: string | null;
  image_url: string | null;
  user_id: string | null;
  author_name: string | null;
  parent_id: string | null;
  up_count: number;
  down_count: number;
  score: number;
  created_at: string;
  edited_at: string | null;
  reply_count: number;
  /** -1, 0 or 1 — how the current visitor voted. */
  viewer_vote: number;
  /** Whether the current visitor may edit or delete this post. */
  is_owner: boolean;
}

export interface ListOptions {
  sort?: SortMode;
  search?: string | null;
  postType?: PostType | null;
  /** null lists the top-level feed; a string lists replies to that post. */
  parentId?: string | null;
  /**
   * Restrict to content the caller authored. Replies are included, since
   * "my activity" reasonably covers comments as well as posts.
   */
  ownedOnly?: boolean;
  /** Only applies to `top`; ignored by the other sorts. */
  window?: TimeWindow;
  limit?: number;
  offset?: number;
}

export interface ListResult {
  posts: Post[];
  /** True when another page exists, so the client knows to keep scrolling. */
  hasMore: boolean;
  nextOffset: number;
}

/**
 * Ranking expressions.
 *
 * hot           Reddit-style: order-of-magnitude of the score plus a linear
 *               time term, so a fresh post with a few votes can outrank a stale
 *               post with many. 45000s ≈ 12.5h per point of magnitude.
 * top           Raw score, optionally within a time window.
 * new           Recency only.
 * controversial Total volume weighted by how evenly split the vote is. Zero
 *               when either side is empty, so unanimous posts never surface.
 */
const ORDER_BY: Record<SortMode, string> = {
  hot: `(log(greatest(abs(p.score), 1)::numeric)::double precision
         + sign(p.score)::double precision
           * (extract(epoch from p.created_at) / 45000.0)) desc, p.created_at desc`,

  new: `p.created_at desc`,

  top: `p.score desc, p.created_at desc`,

  controversial: `(case
        when p.up_count = 0 or p.down_count = 0 then 0::double precision
        else power(
          (p.up_count + p.down_count)::double precision,
          least(p.up_count, p.down_count)::double precision
            / greatest(p.up_count, p.down_count)::double precision
        )
      end) desc, p.created_at desc`,
};

/** Escape LIKE wildcards so a literal % or _ in a search term is not a pattern. */
function escapeLike(term: string): string {
  return term.replace(/([\\%_])/g, "\\$1");
}

function windowCutoff(window: TimeWindow): Date | null {
  const now = Date.now();
  if (window === "day") return new Date(now - 24 * 60 * 60 * 1000);
  if (window === "week") return new Date(now - 7 * 24 * 60 * 60 * 1000);
  return null;
}

interface PostRow extends Omit<Post, "viewer_vote" | "is_owner" | "reply_count"> {
  anon_owner_token: string | null;
  reply_count: number | string;
  viewer_vote: number | string | null;
}

function toPost(row: PostRow, identity: Identity): Post {
  const { anon_owner_token, ...rest } = row;
  return {
    ...rest,
    up_count: Number(row.up_count),
    down_count: Number(row.down_count),
    score: Number(row.score),
    reply_count: Number(row.reply_count ?? 0),
    viewer_vote: Number(row.viewer_vote ?? 0),
    is_owner: ownsRecord(identity, { user_id: row.user_id, anon_owner_token }),
  };
}

/**
 * Ranked, filtered, paginated listing.
 *
 * Uses LIMIT/OFFSET rather than keyset pagination: `hot` and `controversial`
 * are computed from vote counts that move while the visitor scrolls, so a
 * cursor would drift anyway. One extra row is fetched to detect `hasMore`
 * without a second COUNT query.
 */
export async function listPosts(
  identity: Identity,
  options: ListOptions = {},
): Promise<ListResult> {
  const sort = options.sort ?? "hot";
  const limit = Math.min(
    Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const offset = Math.max(options.offset ?? 0, 0);

  const conditions: string[] = ["p.deleted_at is null"];
  const params: unknown[] = [];

  // $1 is always the viewer key for the vote join; it may be null.
  params.push(identity.voterKey);

  if (options.ownedOnly) {
    // Nobody is signed in and no token has been issued: nothing can be owned.
    if (!identity.voterKey) {
      return { posts: [], hasMore: false, nextOffset: offset };
    }

    params.push(identity.ownerToken);
    const tokenPlaceholder = `$${params.length}`;
    params.push(identity.userId);
    const userPlaceholder = `$${params.length}`;

    conditions.push(
      `((p.anon_owner_token is not null and p.anon_owner_token = ${tokenPlaceholder})
        or (p.user_id is not null and p.user_id = ${userPlaceholder}))`,
    );
  }

  // "Mine" spans posts and replies, so the top-level restriction only applies
  // when the caller has not asked for their own content.
  if (options.parentId !== undefined && options.parentId !== null) {
    params.push(options.parentId);
    conditions.push(`p.parent_id = $${params.length}`);
  } else if (!options.ownedOnly) {
    conditions.push("p.parent_id is null");
  }

  const search = options.search?.trim();
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    const placeholder = `$${params.length}`;
    // Match the body or a link post's URL.
    conditions.push(
      `(p.body ilike ${placeholder} or coalesce(p.url, '') ilike ${placeholder})`,
    );
  }

  if (options.postType) {
    params.push(options.postType);
    conditions.push(`p.post_type = $${params.length}`);
  }

  if (sort === "top") {
    const cutoff = windowCutoff(options.window ?? "all");
    if (cutoff) {
      params.push(cutoff.toISOString());
      conditions.push(`p.created_at >= $${params.length}`);
    }
  }

  // Fetch one extra row to detect whether a further page exists.
  params.push(limit + 1);
  const limitPlaceholder = `$${params.length}`;
  params.push(offset);
  const offsetPlaceholder = `$${params.length}`;

  const rows = await query<PostRow>(
    `select
       p.id, p.body, p.post_type, p.url, p.image_url,
       p.user_id, p.author_name, p.anon_owner_token, p.parent_id,
       p.up_count, p.down_count, p.score,
       p.created_at, p.edited_at,
       coalesce(v.value, 0) as viewer_vote,
       (select count(*)::int from posts r
          where r.parent_id = p.id and r.deleted_at is null) as reply_count
     from posts p
     left join votes v
       on v.target_type = 'post'
      and v.target_id = p.id
      and v.voter_key is not distinct from $1
     where ${conditions.join(" and ")}
     order by ${ORDER_BY[sort]}
     limit ${limitPlaceholder} offset ${offsetPlaceholder}`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    posts: page.map((row) => toPost(row, identity)),
    hasMore,
    nextOffset: offset + page.length,
  };
}

export async function getPost(
  identity: Identity,
  id: string,
): Promise<Post | null> {
  const rows = await query<PostRow>(
    `select
       p.id, p.body, p.post_type, p.url, p.image_url,
       p.user_id, p.author_name, p.anon_owner_token, p.parent_id,
       p.up_count, p.down_count, p.score,
       p.created_at, p.edited_at,
       coalesce(v.value, 0) as viewer_vote,
       (select count(*)::int from posts r
          where r.parent_id = p.id and r.deleted_at is null) as reply_count
     from posts p
     left join votes v
       on v.target_type = 'post'
      and v.target_id = p.id
      and v.voter_key is not distinct from $1
     where p.id = $2 and p.deleted_at is null`,
    [identity.voterKey, id],
  );

  const row = rows[0];
  return row ? toPost(row, identity) : null;
}

export interface CreatePostInput {
  body: string;
  postType?: PostType;
  url?: string | null;
  imageUrl?: string | null;
  parentId?: string | null;
  authorName?: string | null;
}

export class ValidationError extends Error {}

/** Only http(s) links are accepted, to keep javascript: and data: URLs out. */
function validateUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError("Enter a valid URL, including https://");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("Only http and https links are allowed");
  }
  return parsed.toString();
}

export async function createPost(
  identity: Identity,
  input: CreatePostInput,
): Promise<Post> {
  const body = input.body?.trim() ?? "";
  const postType = input.postType ?? "text";

  if (!POST_TYPES.includes(postType)) {
    throw new ValidationError("Unknown post type");
  }
  if (body === "") {
    throw new ValidationError("Say something first");
  }
  if (body.length > MAX_BODY_LENGTH) {
    throw new ValidationError(
      `Keep it under ${MAX_BODY_LENGTH} characters (currently ${body.length})`,
    );
  }

  let url: string | null = null;
  if (postType === "link") {
    if (!input.url?.trim()) {
      throw new ValidationError("A link post needs a URL");
    }
    url = validateUrl(input.url.trim());
  }

  let imageUrl: string | null = null;
  if (postType === "image") {
    if (!input.imageUrl?.trim()) {
      throw new ValidationError("An image post needs an image URL");
    }
    imageUrl = validateUrl(input.imageUrl.trim());
  }

  if (!identity.voterKey) {
    throw new ValidationError("Missing identity; refresh and try again");
  }

  const id = crypto.randomUUID();
  await query(
    `insert into posts
       (id, body, post_type, url, image_url, user_id, anon_owner_token,
        author_name, parent_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      body,
      postType,
      url,
      imageUrl,
      identity.userId,
      identity.ownerToken,
      input.authorName?.trim() || null,
      input.parentId ?? null,
    ],
  );

  const created = await getPost(identity, id);
  if (!created) {
    throw new Error("Post was created but could not be read back");
  }
  return created;
}

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}

/** Load the ownership columns for an authorisation check. */
async function loadOwnership(id: string) {
  const rows = await query<{
    id: string;
    user_id: string | null;
    anon_owner_token: string | null;
  }>(
    `select id, user_id, anon_owner_token from posts
      where id = $1 and deleted_at is null`,
    [id],
  );
  return rows[0] ?? null;
}

export async function updatePost(
  identity: Identity,
  id: string,
  input: { body?: string; url?: string | null; imageUrl?: string | null },
): Promise<Post> {
  const existing = await loadOwnership(id);
  if (!existing) throw new NotFoundError("That post no longer exists");
  if (!ownsRecord(identity, existing)) {
    throw new ForbiddenError("You can only edit your own posts");
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (input.body !== undefined) {
    const body = input.body.trim();
    if (body === "") throw new ValidationError("Say something first");
    if (body.length > MAX_BODY_LENGTH) {
      throw new ValidationError(
        `Keep it under ${MAX_BODY_LENGTH} characters (currently ${body.length})`,
      );
    }
    params.push(body);
    updates.push(`body = $${params.length}`);
  }

  if (input.url !== undefined) {
    const url = input.url?.trim() ? validateUrl(input.url.trim()) : null;
    params.push(url);
    updates.push(`url = $${params.length}`);
  }

  if (input.imageUrl !== undefined) {
    const imageUrl = input.imageUrl?.trim()
      ? validateUrl(input.imageUrl.trim())
      : null;
    params.push(imageUrl);
    updates.push(`image_url = $${params.length}`);
  }

  if (updates.length === 0) {
    const unchanged = await getPost(identity, id);
    if (!unchanged) throw new NotFoundError("That post no longer exists");
    return unchanged;
  }

  updates.push("edited_at = current_timestamp");
  params.push(id);

  await query(
    `update posts set ${updates.join(", ")} where id = $${params.length}`,
    params,
  );

  const updated = await getPost(identity, id);
  if (!updated) throw new NotFoundError("That post no longer exists");
  return updated;
}

/**
 * Soft delete. The row is retained so replies and votes are not orphaned —
 * DSQL has no FOREIGN KEY, so nothing would cascade for us anyway.
 */
export async function deletePost(
  identity: Identity,
  id: string,
): Promise<void> {
  const existing = await loadOwnership(id);
  if (!existing) throw new NotFoundError("That post no longer exists");
  if (!ownsRecord(identity, existing)) {
    throw new ForbiddenError("You can only delete your own posts");
  }

  await query(
    `update posts set deleted_at = current_timestamp where id = $1`,
    [id],
  );
}
