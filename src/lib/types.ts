/**
 * Shared contract types.
 *
 * This file is the integration surface between team members:
 *   TM1 — Authentication & User Management
 *   TM2 — Posts & Voting
 *   TM3 — Subreddits & Comments (owner of this file)
 *
 * Changes here affect other people's code. Get a review from whoever owns the
 * other side of the seam.
 */

// ---------------------------------------------------------------------------
// Users — owned by TM1. Minimal shape TM3 needs for bylines and permissions.
// ---------------------------------------------------------------------------

export type UserId = string;

export type PublicUser = {
  id: UserId;
  username: string;
  avatarUrl: string | null;
};

// ---------------------------------------------------------------------------
// Voting — owned by TM2.
//
// Votes MUST be keyed by (targetType, targetId) rather than postId, so the same
// table and UI serve both posts and comments. If this is keyed to posts only,
// comment voting becomes a second parallel system.
// ---------------------------------------------------------------------------

export type VoteTargetType = "post" | "comment";

export type Score = {
  targetType: VoteTargetType;
  targetId: string;
  /** upvotes - downvotes */
  score: number;
  upvotes: number;
  downvotes: number;
  /** Vote direction of the requesting user: 1, -1, or 0 when absent. */
  viewerVote: 1 | 0 | -1;
};

/**
 * Implemented by TM2, consumed by TM3 to sort comment threads.
 *
 * TM3 ships a zero-filled stub (see `src/lib/scores.ts`) so thread rendering
 * works before voting lands. Score-dependent sorts degrade to chronological
 * until the real provider is wired in.
 */
export type ScoreProvider = {
  getScores(
    targetType: VoteTargetType,
    targetIds: string[],
    viewerId: UserId | null,
  ): Promise<Map<string, Score>>;
};

// ---------------------------------------------------------------------------
// Posts — owned by TM2.
//
// A post belongs to exactly one subreddit. `removedAt`/`removedBy` are written
// by TM3's moderation and MUST be filtered out of every TM2 listing, sort,
// search and pagination query.
//
// Tallies are denormalized onto the row so ranking can be expressed as an
// ORDER BY. They are recomputed from the votes table rather than incremented,
// which keeps the update idempotent under DSQL's optimistic-concurrency retries.
// ---------------------------------------------------------------------------

export type PostId = string;

export type PostType = "text" | "link" | "image";

export type PostSort = "hot" | "new" | "top" | "controversial";

/** Time window for `top`; ignored by the other sorts. */
export type PostWindow = "day" | "week" | "all";

export type Post = {
  id: PostId;
  subredditId: SubredditId;
  /** References users.id (TM1). No FK: unsupported in DSQL. */
  authorId: UserId;
  /** The hot take itself. Required. */
  title: string;
  /** Optional elaboration; empty string when absent. */
  body: string;
  postType: PostType;
  /** Set for `link` posts. */
  url: string | null;
  /** Set for `image` posts. */
  imageUrl: string | null;
  createdAt: string;
  editedAt: string | null;
  /** Author deletion. Soft delete, so comments beneath stay reachable. */
  deletedAt: string | null;
  /** Moderator removal, tracked separately from author deletion. */
  removedAt: string | null;
  removedBy: UserId | null;
  upvotes: number;
  downvotes: number;
  /** upvotes - downvotes, denormalized for ranking. */
  score: number;
};

/** A post plus everything the UI needs to render it, resolved in one pass. */
export type PostView = {
  post: Post;
  author: PublicUser | null;
  score: Score;
  commentCount: number;
  subreddit: { id: SubredditId; name: string; slug: string } | null;
  /** Whether the requesting user may edit or delete it. */
  isOwner: boolean;
};

export type Vote = {
  targetType: VoteTargetType;
  targetId: string;
  voterId: UserId;
  /** 1 or -1; a cleared vote is an absent row, never a 0. */
  value: 1 | -1;
  createdAt: string;
  updatedAt: string | null;
};

// ---------------------------------------------------------------------------
// Subreddits — owned by TM3.
// ---------------------------------------------------------------------------

export type SubredditId = string;

export type Subreddit = {
  id: SubredditId;
  /** Display name, preserves creator's casing. Unique case-insensitively. */
  name: string;
  /** Lowercased `name`; the actual uniqueness key and lookup slug. */
  slug: string;
  description: string;
  bannerUrl: string | null;
  iconUrl: string | null;
  createdBy: UserId;
  createdAt: string;
  /**
   * Denormalized counter maintained transactionally on subscribe/unsubscribe.
   * Avoids a COUNT(*) on every page render.
   */
  subscriberCount: number;
};

export type SubredditRule = {
  id: string;
  subredditId: SubredditId;
  /** 0-based display order; rules are reorderable. */
  position: number;
  title: string;
  description: string;
};

export type ModeratorRole = "owner" | "moderator";

export type SubredditModerator = {
  subredditId: SubredditId;
  userId: UserId;
  role: ModeratorRole;
  createdAt: string;
};

export type SubredditBan = {
  subredditId: SubredditId;
  userId: UserId;
  reason: string;
  bannedBy: UserId;
  createdAt: string;
  /** null means permanent. */
  expiresAt: string | null;
};

// ---------------------------------------------------------------------------
// Comments — owned by TM3.
// ---------------------------------------------------------------------------

export type CommentId = string;

export type Comment = {
  id: CommentId;
  /** FK to TM2's posts table. */
  postId: string;
  /** Adjacency list: null for a top-level comment. */
  parentCommentId: CommentId | null;
  authorId: UserId;
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** Set when the author deletes. Soft delete — see `src/lib/comments.ts`. */
  deletedAt: string | null;
  /** Set when a moderator removes. Distinct from author deletion. */
  removedAt: string | null;
  removedBy: UserId | null;
};

/** A comment plus its replies, as rendered. */
export type CommentNode = {
  comment: Comment;
  author: PublicUser | null;
  score: Score | null;
  depth: number;
  replies: CommentNode[];
  /**
   * True when this node's replies were cut off by the depth cap. The UI renders
   * a "continue this thread" link.
   */
  hasMoreReplies: boolean;
  /** Author-deleted or mod-removed: render a tombstone, keep the subtree. */
  isTombstone: boolean;
};

export type CommentSort = "best" | "top" | "new" | "old" | "controversial";

/** Sorts that need TM2's scores; they fall back to chronological without them. */
export const SCORE_DEPENDENT_SORTS: CommentSort[] = [
  "best",
  "top",
  "controversial",
];

// ---------------------------------------------------------------------------
// Moderation — owned by TM3, enforced by both TM3 and TM2.
//
// TM2 MUST call `assertCanPost` before creating a post, otherwise banned users
// can still post. TM2 MUST also filter `removedAt`-flagged posts out of every
// listing, sorting, and search query.
// ---------------------------------------------------------------------------

export type ModActionType =
  | "remove_post"
  | "approve_post"
  | "remove_comment"
  | "approve_comment"
  | "ban_user"
  | "unban_user";

export type ModLogEntry = {
  id: string;
  subredditId: SubredditId;
  moderatorId: UserId;
  action: ModActionType;
  targetType: "post" | "comment" | "user";
  targetId: string;
  reason: string | null;
  createdAt: string;
};
