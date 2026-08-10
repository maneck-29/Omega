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

import type {
  CreateCommentInput,
  CreateSubredditInput,
  Repository,
  SubredditListOptions,
  UpdateSubredditInput,
} from "./repository";
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

type Tables = {
  subreddits: Subreddit[];
  rules: SubredditRule[];
  subscriptions: { userId: UserId; subredditId: SubredditId }[];
  moderators: SubredditModerator[];
  bans: SubredditBan[];
  comments: Comment[];
  modLog: ModLogEntry[];
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
};

/** Test-only: drop all state. */
export function resetMemoryDb(): void {
  db.subreddits.length = 0;
  db.rules.length = 0;
  db.subscriptions.length = 0;
  db.moderators.length = 0;
  db.bans.length = 0;
  db.comments.length = 0;
  db.modLog.length = 0;
}
