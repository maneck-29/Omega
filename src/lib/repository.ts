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
  Subreddit,
  SubredditBan,
  SubredditId,
  SubredditModerator,
  SubredditRule,
  UserId,
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
};
