/**
 * In-memory `Repository` implementation.
 *
 * Placeholder until the team picks a database. State lives in module scope, so
 * it resets on server restart and is not shared across processes — fine for
 * development, never for production.
 *
 * Kept deliberately dumb: no clever indexes, just the semantics a real
 * implementation has to reproduce (uniqueness, idempotency, soft deletes,
 * transactional counter updates).
 */

import { comparePosts, windowCutoff } from "./ranking";
import type {
  CreateCommentInput,
  CreatePostInput,
  PostListOptions,
  CreateSubredditInput,
  Repository,
  SubredditListOptions,
  UpdatePostInput,
  UpdateSubredditInput,
} from "./repository";
import type {
  Comment,
  CommentId,
  ModLogEntry,
  ModeratorRole,
  Post,
  PostId,
  Score,
  Subreddit,
  SubredditBan,
  SubredditId,
  SubredditModerator,
  SubredditRule,
  UserId,
  Vote,
  VoteTargetType,
} from "./types";

type Tables = {
  subreddits: Subreddit[];
  rules: SubredditRule[];
  subscriptions: { userId: UserId; subredditId: SubredditId }[];
  moderators: SubredditModerator[];
  bans: SubredditBan[];
  comments: Comment[];
  modLog: ModLogEntry[];
  posts: Post[];
  votes: Vote[];
};

// Survives Next.js dev hot-reload, which re-evaluates modules.
const globalStore = globalThis as unknown as { __hotTakesDb?: Tables };

const db: Tables = (globalStore.__hotTakesDb ??= {
  subreddits: [],
  rules: [],
  subscriptions: [],
  moderators: [],
  bans: [],
  comments: [],
  modLog: [],
  posts: [],
  votes: [],
});

const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);

function isBanActive(ban: SubredditBan, at = Date.now()): boolean {
  return ban.expiresAt === null || Date.parse(ban.expiresAt) > at;
}

function matchesQuery(subreddit: Subreddit, query?: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    subreddit.slug.includes(needle) ||
    subreddit.description.toLowerCase().includes(needle)
  );
}

function selectSubreddits(options: SubredditListOptions = {}): Subreddit[] {
  const rows = db.subreddits.filter((s) => matchesQuery(s, options.query));

  switch (options.sort ?? "popular") {
    case "popular":
      rows.sort((a, b) => b.subscriberCount - a.subscriberCount);
      break;
    case "new":
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case "name":
      rows.sort((a, b) => a.slug.localeCompare(b.slug));
      break;
  }

  return rows;
}

export const memoryRepository: Repository = {
  // --- Subreddits ---------------------------------------------------------

  async createSubreddit(input: CreateSubredditInput): Promise<Subreddit> {
    // Mirrors a case-insensitive UNIQUE index on slug.
    if (db.subreddits.some((s) => s.slug === input.slug)) {
      throw new Error(`Subreddit "${input.name}" already exists`);
    }

    const subreddit: Subreddit = {
      id: crypto.randomUUID(),
      name: input.name,
      slug: input.slug,
      description: input.description,
      bannerUrl: input.bannerUrl ?? null,
      iconUrl: input.iconUrl ?? null,
      createdBy: input.createdBy,
      createdAt: now(),
      subscriberCount: 0,
    };

    db.subreddits.push(subreddit);
    return clone(subreddit);
  },

  async getSubredditById(id) {
    const found = db.subreddits.find((s) => s.id === id);
    return found ? clone(found) : null;
  },

  async getSubredditBySlug(slug) {
    const found = db.subreddits.find((s) => s.slug === slug.toLowerCase());
    return found ? clone(found) : null;
  },

  async listSubreddits(options = {}) {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 25;
    return clone(selectSubreddits(options).slice(offset, offset + limit));
  },

  async countSubreddits(options = {}) {
    return selectSubreddits(options).length;
  },

  async updateSubreddit(id: SubredditId, patch: UpdateSubredditInput) {
    const row = db.subreddits.find((s) => s.id === id);
    if (!row) throw new Error("Subreddit not found");

    if (patch.description !== undefined) row.description = patch.description;
    if (patch.bannerUrl !== undefined) row.bannerUrl = patch.bannerUrl;
    if (patch.iconUrl !== undefined) row.iconUrl = patch.iconUrl;

    return clone(row);
  },

  // --- Rules --------------------------------------------------------------

  async listRules(subredditId) {
    return clone(
      db.rules
        .filter((r) => r.subredditId === subredditId)
        .sort((a, b) => a.position - b.position),
    );
  },

  async addRule(subredditId, title, description) {
    const position = db.rules.filter((r) => r.subredditId === subredditId).length;
    const rule: SubredditRule = {
      id: crypto.randomUUID(),
      subredditId,
      position,
      title,
      description,
    };
    db.rules.push(rule);
    return clone(rule);
  },

  async updateRule(ruleId, patch) {
    const rule = db.rules.find((r) => r.id === ruleId);
    if (!rule) throw new Error("Rule not found");
    if (patch.title !== undefined) rule.title = patch.title;
    if (patch.description !== undefined) rule.description = patch.description;
    return clone(rule);
  },

  async deleteRule(ruleId) {
    const index = db.rules.findIndex((r) => r.id === ruleId);
    if (index === -1) return;
    const [removed] = db.rules.splice(index, 1);
    // Close the gap so positions stay contiguous.
    db.rules
      .filter((r) => r.subredditId === removed.subredditId)
      .sort((a, b) => a.position - b.position)
      .forEach((r, i) => {
        r.position = i;
      });
  },

  async reorderRules(subredditId, ruleIds) {
    ruleIds.forEach((id, index) => {
      const rule = db.rules.find(
        (r) => r.id === id && r.subredditId === subredditId,
      );
      if (rule) rule.position = index;
    });
  },

  // --- Subscriptions ------------------------------------------------------

  async subscribe(userId, subredditId) {
    const exists = db.subscriptions.some(
      (s) => s.userId === userId && s.subredditId === subredditId,
    );
    // Idempotent: composite PK (userId, subredditId) makes duplicates impossible.
    if (exists) return false;

    db.subscriptions.push({ userId, subredditId });

    // Same logical transaction as the insert.
    const subreddit = db.subreddits.find((s) => s.id === subredditId);
    if (subreddit) subreddit.subscriberCount += 1;

    return true;
  },

  async unsubscribe(userId, subredditId) {
    const index = db.subscriptions.findIndex(
      (s) => s.userId === userId && s.subredditId === subredditId,
    );
    if (index === -1) return false;

    db.subscriptions.splice(index, 1);

    const subreddit = db.subreddits.find((s) => s.id === subredditId);
    if (subreddit) {
      subreddit.subscriberCount = Math.max(0, subreddit.subscriberCount - 1);
    }

    return true;
  },

  async isSubscribed(userId, subredditId) {
    return db.subscriptions.some(
      (s) => s.userId === userId && s.subredditId === subredditId,
    );
  },

  async getSubscribedSubredditIds(userId) {
    return db.subscriptions
      .filter((s) => s.userId === userId)
      .map((s) => s.subredditId);
  },

  async listSubscribedSubreddits(userId) {
    const ids = new Set(
      db.subscriptions.filter((s) => s.userId === userId).map((s) => s.subredditId),
    );
    return clone(
      db.subreddits
        .filter((s) => ids.has(s.id))
        .sort((a, b) => a.slug.localeCompare(b.slug)),
    );
  },

  // --- Moderators ---------------------------------------------------------

  async addModerator(subredditId, userId, role: ModeratorRole) {
    const existing = db.moderators.find(
      (m) => m.subredditId === subredditId && m.userId === userId,
    );
    if (existing) {
      existing.role = role;
      return clone(existing);
    }

    const moderator: SubredditModerator = {
      subredditId,
      userId,
      role,
      createdAt: now(),
    };
    db.moderators.push(moderator);
    return clone(moderator);
  },

  async removeModerator(subredditId, userId) {
    const index = db.moderators.findIndex(
      (m) => m.subredditId === subredditId && m.userId === userId,
    );
    if (index !== -1) db.moderators.splice(index, 1);
  },

  async getModerator(subredditId, userId) {
    const found = db.moderators.find(
      (m) => m.subredditId === subredditId && m.userId === userId,
    );
    return found ? clone(found) : null;
  },

  async listModerators(subredditId) {
    return clone(
      db.moderators
        .filter((m) => m.subredditId === subredditId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  },

  async listModeratedSubreddits(userId) {
    const ids = new Set(
      db.moderators.filter((m) => m.userId === userId).map((m) => m.subredditId),
    );
    return clone(db.subreddits.filter((s) => ids.has(s.id)));
  },

  // --- Bans ---------------------------------------------------------------

  async banUser(input) {
    await this.unbanUser(input.subredditId, input.userId);
    const ban: SubredditBan = { ...input, createdAt: now() };
    db.bans.push(ban);
    return clone(ban);
  },

  async unbanUser(subredditId, userId) {
    const index = db.bans.findIndex(
      (b) => b.subredditId === subredditId && b.userId === userId,
    );
    if (index !== -1) db.bans.splice(index, 1);
  },

  async getActiveBan(subredditId, userId) {
    const ban = db.bans.find(
      (b) => b.subredditId === subredditId && b.userId === userId,
    );
    if (!ban || !isBanActive(ban)) return null;
    return clone(ban);
  },

  async listBans(subredditId) {
    return clone(
      db.bans.filter((b) => b.subredditId === subredditId && isBanActive(b)),
    );
  },

  // --- Comments -----------------------------------------------------------

  async createComment(input: CreateCommentInput) {
    const comment: Comment = {
      id: crypto.randomUUID(),
      postId: input.postId,
      parentCommentId: input.parentCommentId,
      authorId: input.authorId,
      body: input.body,
      createdAt: now(),
      editedAt: null,
      deletedAt: null,
      removedAt: null,
      removedBy: null,
    };
    db.comments.push(comment);
    return clone(comment);
  },

  async getCommentById(id) {
    const found = db.comments.find((c) => c.id === id);
    return found ? clone(found) : null;
  },

  async listCommentsByPost(postId) {
    return clone(
      db.comments
        .filter((c) => c.postId === postId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  },

  async listCommentsByAuthor(authorId, limit = 25) {
    return clone(
      db.comments
        .filter((c) => c.authorId === authorId && !c.deletedAt && !c.removedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
    );
  },

  async updateCommentBody(id: CommentId, body: string) {
    const comment = db.comments.find((c) => c.id === id);
    if (!comment) throw new Error("Comment not found");
    comment.body = body;
    comment.editedAt = now();
    return clone(comment);
  },

  async softDeleteComment(id) {
    const comment = db.comments.find((c) => c.id === id);
    if (!comment) throw new Error("Comment not found");
    // Tombstone only. Hard-deleting would orphan every reply beneath it.
    comment.deletedAt = now();
    return clone(comment);
  },

  async setCommentRemoved(id, removedBy) {
    const comment = db.comments.find((c) => c.id === id);
    if (!comment) throw new Error("Comment not found");
    comment.removedAt = removedBy ? now() : null;
    comment.removedBy = removedBy;
    return clone(comment);
  },

  async countCommentsByPost(postId) {
    return db.comments.filter(
      (c) => c.postId === postId && !c.deletedAt && !c.removedAt,
    ).length;
  },

  // --- Mod log ------------------------------------------------------------

  async addModLogEntry(input) {
    const entry: ModLogEntry = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now(),
    };
    db.modLog.push(entry);
    return clone(entry);
  },

  async listModLog(subredditId, limit = 50) {
    return clone(
      db.modLog
        .filter((e) => e.subredditId === subredditId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
    );
  },

  // --- Posts (TM2) --------------------------------------------------------

  async createPost(input: CreatePostInput) {
    const post: Post = {
      id: crypto.randomUUID(),
      subredditId: input.subredditId,
      authorId: input.authorId,
      title: input.title,
      body: input.body,
      postType: input.postType,
      url: input.url,
      imageUrl: input.imageUrl,
      createdAt: input.createdAt ?? now(),
      editedAt: null,
      deletedAt: null,
      removedAt: null,
      removedBy: null,
      upvotes: 0,
      downvotes: 0,
      score: 0,
    };
    db.posts.push(post);
    return clone(post);
  },

  async getPostById(id) {
    const found = db.posts.find((p) => p.id === id);
    return found ? clone(found) : null;
  },

  async listPosts(options = {}) {
    const sort = options.sort ?? "hot";
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    return clone(
      selectPosts(options)
        .sort(comparePosts(sort))
        .slice(offset, offset + limit),
    );
  },

  async countPosts(options = {}) {
    return selectPosts(options).length;
  },

  async updatePost(id: PostId, patch: UpdatePostInput) {
    const post = db.posts.find((p) => p.id === id);
    if (!post) throw new Error("Post not found");

    if (patch.title !== undefined) post.title = patch.title;
    if (patch.body !== undefined) post.body = patch.body;
    if (patch.url !== undefined) post.url = patch.url;
    if (patch.imageUrl !== undefined) post.imageUrl = patch.imageUrl;
    post.editedAt = now();

    return clone(post);
  },

  async softDeletePost(id) {
    const post = db.posts.find((p) => p.id === id);
    if (!post) throw new Error("Post not found");
    // Tombstone only; comments beneath it must stay reachable.
    post.deletedAt = now();
    return clone(post);
  },

  async setPostRemoved(id, removedBy) {
    const post = db.posts.find((p) => p.id === id);
    if (!post) throw new Error("Post not found");
    post.removedAt = removedBy === null ? null : now();
    post.removedBy = removedBy;
    return clone(post);
  },

  // --- Votes (TM2) --------------------------------------------------------

  async castVote(targetType, targetId, voterId, value) {
    const existing = db.votes.find(
      (v) =>
        v.targetType === targetType &&
        v.targetId === targetId &&
        v.voterId === voterId,
    );

    if (!existing) {
      db.votes.push({
        targetType,
        targetId,
        voterId,
        value,
        createdAt: now(),
        updatedAt: null,
      });
    } else if (existing.value === value) {
      // Same direction again: clear the vote rather than storing a zero.
      db.votes.splice(db.votes.indexOf(existing), 1);
    } else {
      existing.value = value;
      existing.updatedAt = now();
    }

    return refreshTallies(targetType, targetId, voterId);
  },

  async getScores(targetType, targetIds, viewerId) {
    const wanted = new Set(targetIds);
    const result = new Map<string, Score>();

    for (const targetId of wanted) {
      result.set(targetId, tallyFor(targetType, targetId, viewerId));
    }

    return result;
  },

  async listVotedTargetIds(voterId, targetType, value, limit = 25) {
    return db.votes
      .filter(
        (v) =>
          v.voterId === voterId &&
          v.targetType === targetType &&
          v.value === value,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((v) => v.targetId);
  },
};

/**
 * Shared filter for post listings.
 *
 * Author-deleted and moderator-removed posts are excluded here rather than at
 * each call site, so no listing, sort or search can forget — which the
 * integration contract calls out as a seam that breaks quietly.
 */
function selectPosts(options: PostListOptions): Post[] {
  const cutoff = options.sort === "top" ? windowCutoff(options.window) : null;
  const query = options.query?.trim().toLowerCase();

  return db.posts.filter((post) => {
    if (post.deletedAt || post.removedAt) return false;

    if (options.subredditId && post.subredditId !== options.subredditId) {
      return false;
    }
    if (options.subredditIds && !options.subredditIds.includes(post.subredditId)) {
      return false;
    }
    if (options.authorId && post.authorId !== options.authorId) return false;
    if (options.postType && post.postType !== options.postType) return false;
    if (cutoff && Date.parse(post.createdAt) < cutoff.getTime()) return false;

    if (query) {
      const haystack = `${post.title} ${post.body} ${post.url ?? ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

/** Count votes for one target and report the viewer's own direction. */
function tallyFor(
  targetType: VoteTargetType,
  targetId: string,
  viewerId: UserId | null,
): Score {
  let upvotes = 0;
  let downvotes = 0;
  let viewerVote: 1 | 0 | -1 = 0;

  for (const vote of db.votes) {
    if (vote.targetType !== targetType || vote.targetId !== targetId) continue;
    if (vote.value === 1) upvotes += 1;
    else downvotes += 1;
    if (viewerId && vote.voterId === viewerId) viewerVote = vote.value;
  }

  return {
    targetType,
    targetId,
    score: upvotes - downvotes,
    upvotes,
    downvotes,
    viewerVote,
  };
}

/**
 * Recompute the target's tallies from the votes table and write them back.
 *
 * Recomputed rather than incremented so the operation is idempotent — the DSQL
 * implementation runs the equivalent inside a retryable transaction.
 */
function refreshTallies(
  targetType: VoteTargetType,
  targetId: string,
  viewerId: UserId | null,
): Score {
  const tally = tallyFor(targetType, targetId, viewerId);

  if (targetType === "post") {
    const post = db.posts.find((p) => p.id === targetId);
    if (post) {
      post.upvotes = tally.upvotes;
      post.downvotes = tally.downvotes;
      post.score = tally.score;
    }
  }

  return tally;
}

/** Test-only: drop all state. */
export function resetMemoryDb(): void {
  db.subreddits.length = 0;
  db.rules.length = 0;
  db.subscriptions.length = 0;
  db.moderators.length = 0;
  db.bans.length = 0;
  db.comments.length = 0;
  db.modLog.length = 0;
  db.posts.length = 0;
  db.votes.length = 0;
}
