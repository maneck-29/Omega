/**
 * Storage contract for TM3's domain.
 *
 * Everything above this layer (services, route handlers, pages) talks to this
 * interface and never to a database driver. While the team is still choosing a
 * database, `memoryRepository` backs it; swapping in Postgres means writing one
 * new implementation of this interface and changing `getRepository()`.
 *
 * Method granularity is deliberately close to SQL so a real implementation is a
 * direct translation — no in-memory filtering of full-table reads.
 */

import type {
  Comment,
  CommentId,
  ModLogEntry,
  ModeratorRole,
  Post,
  PostId,
  PostSort,
  PostType,
  PostWindow,
  Score,
  Subreddit,
  SubredditBan,
  SubredditId,
  SubredditModerator,
  SubredditRule,
  UserId,
  VoteTargetType,
} from "./types";

export type CreateSubredditInput = {
  name: string;
  slug: string;
  description: string;
  createdBy: UserId;
  bannerUrl?: string | null;
  iconUrl?: string | null;
};

export type UpdateSubredditInput = {
  description?: string;
  bannerUrl?: string | null;
  iconUrl?: string | null;
};

export type CreateCommentInput = {
  postId: string;
  parentCommentId: CommentId | null;
  authorId: UserId;
  body: string;
};

export type SubredditListOptions = {
  query?: string;
  sort?: "popular" | "new" | "name";
  limit?: number;
  offset?: number;
};

// --- Posts and votes (TM2) -------------------------------------------------

export type CreatePostInput = {
  subredditId: SubredditId;
  authorId: UserId;
  title: string;
  body: string;
  postType: PostType;
  url: string | null;
  imageUrl: string | null;
  /**
   * Backdate the row. For fixtures and backfills only — normal creation lets the
   * database default apply, so callers cannot forge a creation time.
   */
  createdAt?: string;
};

export type UpdatePostInput = {
  title?: string;
  body?: string;
  url?: string | null;
  imageUrl?: string | null;
};

export type PostListOptions = {
  /** Single subreddit, for `/r/[slug]`. */
  subredditId?: SubredditId | null;
  /** Restrict to a set of subreddits, for the subscribed home feed. */
  subredditIds?: SubredditId[] | null;
  /** Post history for a profile page. */
  authorId?: UserId | null;
  /** Substring match against title, body and URL. */
  query?: string | null;
  postType?: PostType | null;
  sort?: PostSort;
  /** Only applies to `top`. */
  window?: PostWindow;
  limit?: number;
  offset?: number;
};

export type Repository = {
  // --- Subreddits ---------------------------------------------------------
  createSubreddit(input: CreateSubredditInput): Promise<Subreddit>;
  getSubredditById(id: SubredditId): Promise<Subreddit | null>;
  /** Lookup by lowercased name. The canonical route param resolver. */
  getSubredditBySlug(slug: string): Promise<Subreddit | null>;
  listSubreddits(options?: SubredditListOptions): Promise<Subreddit[]>;
  countSubreddits(options?: SubredditListOptions): Promise<number>;
  updateSubreddit(
    id: SubredditId,
    patch: UpdateSubredditInput,
  ): Promise<Subreddit>;

  // --- Rules --------------------------------------------------------------
  listRules(subredditId: SubredditId): Promise<SubredditRule[]>;
  addRule(
    subredditId: SubredditId,
    title: string,
    description: string,
  ): Promise<SubredditRule>;
  updateRule(
    ruleId: string,
    patch: { title?: string; description?: string },
  ): Promise<SubredditRule>;
  deleteRule(ruleId: string): Promise<void>;
  /** Persist a full ordering; ids must be the complete rule set. */
  reorderRules(subredditId: SubredditId, ruleIds: string[]): Promise<void>;

  // --- Subscriptions ------------------------------------------------------
  /**
   * Idempotent. Returns true when a new row was inserted, so callers know
   * whether to bump the denormalized counter.
   */
  subscribe(userId: UserId, subredditId: SubredditId): Promise<boolean>;
  unsubscribe(userId: UserId, subredditId: SubredditId): Promise<boolean>;
  isSubscribed(userId: UserId, subredditId: SubredditId): Promise<boolean>;
  /** Consumed by TM2 to build the home feed. */
  getSubscribedSubredditIds(userId: UserId): Promise<SubredditId[]>;
  listSubscribedSubreddits(userId: UserId): Promise<Subreddit[]>;

  // --- Moderators ---------------------------------------------------------
  addModerator(
    subredditId: SubredditId,
    userId: UserId,
    role: ModeratorRole,
  ): Promise<SubredditModerator>;
  removeModerator(subredditId: SubredditId, userId: UserId): Promise<void>;
  getModerator(
    subredditId: SubredditId,
    userId: UserId,
  ): Promise<SubredditModerator | null>;
  listModerators(subredditId: SubredditId): Promise<SubredditModerator[]>;
  /** Consumed by TM1 for "moderator of" on profile pages. */
  listModeratedSubreddits(userId: UserId): Promise<Subreddit[]>;

  // --- Bans ---------------------------------------------------------------
  banUser(ban: Omit<SubredditBan, "createdAt">): Promise<SubredditBan>;
  unbanUser(subredditId: SubredditId, userId: UserId): Promise<void>;
  /** Returns the ban only when currently active (expiry respected). */
  getActiveBan(
    subredditId: SubredditId,
    userId: UserId,
  ): Promise<SubredditBan | null>;
  listBans(subredditId: SubredditId): Promise<SubredditBan[]>;

  // --- Comments -----------------------------------------------------------
  createComment(input: CreateCommentInput): Promise<Comment>;
  getCommentById(id: CommentId): Promise<Comment | null>;
  /**
   * All comments for a post, including tombstoned ones — a deleted parent still
   * has to render so its replies stay reachable. Tree building happens in the
   * service layer.
   */
  listCommentsByPost(postId: string): Promise<Comment[]>;
  listCommentsByAuthor(authorId: UserId, limit?: number): Promise<Comment[]>;
  updateCommentBody(id: CommentId, body: string): Promise<Comment>;
  /** Author deletion: tombstone, never a hard delete. */
  softDeleteComment(id: CommentId): Promise<Comment>;
  /** Moderator removal, tracked separately from author deletion. */
  setCommentRemoved(
    id: CommentId,
    removedBy: UserId | null,
  ): Promise<Comment>;
  countCommentsByPost(postId: string): Promise<number>;

  // --- Mod log ------------------------------------------------------------
  addModLogEntry(entry: Omit<ModLogEntry, "id" | "createdAt">): Promise<ModLogEntry>;
  listModLog(subredditId: SubredditId, limit?: number): Promise<ModLogEntry[]>;

  // --- Posts (TM2) --------------------------------------------------------
  createPost(input: CreatePostInput): Promise<Post>;
  getPostById(id: PostId): Promise<Post | null>;
  /**
   * Ranked, filtered, paginated listing. Implementations MUST exclude rows with
   * `deleted_at` or `removed_at` set — moderator-removed posts must not appear
   * in any listing, sort or search.
   */
  listPosts(options?: PostListOptions): Promise<Post[]>;
  countPosts(options?: PostListOptions): Promise<number>;
  updatePost(id: PostId, patch: UpdatePostInput): Promise<Post>;
  /** Author deletion: tombstone, never a hard delete. */
  softDeletePost(id: PostId): Promise<Post>;
  /** Moderator removal, tracked separately from author deletion. */
  setPostRemoved(id: PostId, removedBy: UserId | null): Promise<Post>;

  // --- Votes (TM2) --------------------------------------------------------
  /**
   * Cast, flip or clear a vote, then refresh the target's tallies, atomically.
   *
   * Re-casting the same direction clears the vote; the opposite direction flips
   * it. Returns the resulting score so callers need no follow-up read.
   *
   * Tallies are recomputed from the votes table rather than incremented, which
   * keeps the transaction body idempotent — a requirement under DSQL's
   * optimistic-concurrency retries.
   */
  castVote(
    targetType: VoteTargetType,
    targetId: string,
    voterId: UserId,
    value: 1 | -1,
  ): Promise<Score>;
  /** Batched score lookup. Backs the `ScoreProvider` contract. */
  getScores(
    targetType: VoteTargetType,
    targetIds: string[],
    viewerId: UserId | null,
  ): Promise<Map<string, Score>>;
  /** Targets this user upvoted, newest first. Feeds the personalised ranking. */
  listVotedTargetIds(
    voterId: UserId,
    targetType: VoteTargetType,
    value: 1 | -1,
    limit?: number,
  ): Promise<string[]>;
};
