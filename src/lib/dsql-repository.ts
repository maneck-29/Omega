/**
 * Aurora DSQL implementation of `Repository`.
 *
 * Design notes specific to DSQL:
 *
 * - **UUID primary keys, application-generated.** No sequences, and random keys
 *   spread writes across the key range, which reduces OCC conflicts.
 * - **No foreign keys.** Cross-table integrity is checked in the service layer.
 * - **Idempotent transaction bodies.** OCC retries re-run the callback, so
 *   nothing inside `withTransaction` may have external side effects.
 * - **Counter updates are relative** (`subscriberCount + 1`), never
 *   read-then-write, so a retry cannot double-count.
 */

import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import { getDb, withTransaction } from "./dsql";
import type {
  CreateCommentInput,
  CreateSubredditInput,
  Repository,
  SubredditListOptions,
  UpdateSubredditInput,
} from "./repository";
import {
  comments as commentsTable,
  modLog as modLogTable,
  subredditBans,
  subredditModerators,
  subredditRules,
  subredditSubscriptions,
  subreddits as subredditsTable,
} from "./schema";
import type {
  Comment,
  ModLogEntry,
  ModeratorRole,
  Subreddit,
  SubredditBan,
  SubredditId,
  SubredditModerator,
  SubredditRule,
} from "./types";

// --- Row mappers -----------------------------------------------------------
// The domain uses ISO strings; DSQL returns Date objects.

type SubredditRow = typeof subredditsTable.$inferSelect;
type CommentRow = typeof commentsTable.$inferSelect;
type BanRow = typeof subredditBans.$inferSelect;

const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

function toSubreddit(row: SubredditRow): Subreddit {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    bannerUrl: row.bannerUrl,
    iconUrl: row.iconUrl,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    subscriberCount: row.subscriberCount,
  };
}

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    postId: row.postId,
    parentCommentId: row.parentCommentId,
    authorId: row.authorId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: iso(row.editedAt),
    deletedAt: iso(row.deletedAt),
    removedAt: iso(row.removedAt),
    removedBy: row.removedBy,
  };
}

function toBan(row: BanRow): SubredditBan {
  return {
    subredditId: row.subredditId,
    userId: row.userId,
    reason: row.reason,
    bannedBy: row.bannedBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: iso(row.expiresAt),
  };
}

/** Active means no expiry, or an expiry still in the future. */
const activeBanCondition = sql`(${subredditBans.expiresAt} IS NULL OR ${subredditBans.expiresAt} > now())`;

function searchCondition(query?: string) {
  if (!query) return undefined;
  const pattern = `%${query}%`;
  return or(
    ilike(subredditsTable.slug, pattern),
    ilike(subredditsTable.description, pattern),
  );
}

function orderFor(sort: SubredditListOptions["sort"]) {
  switch (sort) {
    case "new":
      return desc(subredditsTable.createdAt);
    case "name":
      return asc(subredditsTable.slug);
    default:
      return desc(subredditsTable.subscriberCount);
  }
}

export const dsqlRepository: Repository = {
  // --- Subreddits ---------------------------------------------------------

  async createSubreddit(input: CreateSubredditInput): Promise<Subreddit> {
    const id = crypto.randomUUID();

    try {
      const [row] = await getDb()
        .insert(subredditsTable)
        .values({
          id,
          name: input.name,
          slug: input.slug,
          description: input.description,
          bannerUrl: input.bannerUrl ?? null,
          iconUrl: input.iconUrl ?? null,
          createdBy: input.createdBy,
        })
        .returning();

      return toSubreddit(row);
    } catch (error) {
      // Unique violation on subreddits_slug_key — case-insensitive name clash.
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        throw new Error(`Subreddit "${input.name}" already exists`);
      }
      throw error;
    }
  },

  async getSubredditById(id) {
    const [row] = await getDb()
      .select()
      .from(subredditsTable)
      .where(eq(subredditsTable.id, id))
      .limit(1);
    return row ? toSubreddit(row) : null;
  },

  async getSubredditBySlug(slug) {
    const [row] = await getDb()
      .select()
      .from(subredditsTable)
      .where(eq(subredditsTable.slug, slug.toLowerCase()))
      .limit(1);
    return row ? toSubreddit(row) : null;
  },

  async listSubreddits(options: SubredditListOptions = {}) {
    const rows = await getDb()
      .select()
      .from(subredditsTable)
      .where(searchCondition(options.query))
      .orderBy(orderFor(options.sort))
      .limit(options.limit ?? 25)
      .offset(options.offset ?? 0);

    return rows.map(toSubreddit);
  },

  async countSubreddits(options: SubredditListOptions = {}) {
    const [row] = await getDb()
      .select({ value: count() })
      .from(subredditsTable)
      .where(searchCondition(options.query));
    return row?.value ?? 0;
  },

  async updateSubreddit(id: SubredditId, patch: UpdateSubredditInput) {
    const [row] = await getDb()
      .update(subredditsTable)
      .set({
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.bannerUrl !== undefined && { bannerUrl: patch.bannerUrl }),
        ...(patch.iconUrl !== undefined && { iconUrl: patch.iconUrl }),
      })
      .where(eq(subredditsTable.id, id))
      .returning();

    if (!row) throw new Error("Subreddit not found");
    return toSubreddit(row);
  },

  // --- Rules --------------------------------------------------------------

  async listRules(subredditId) {
    const rows = await getDb()
      .select()
      .from(subredditRules)
      .where(eq(subredditRules.subredditId, subredditId))
      .orderBy(asc(subredditRules.position));

    return rows.map<SubredditRule>((row) => ({
      id: row.id,
      subredditId: row.subredditId,
      position: row.position,
      title: row.title,
      description: row.description,
    }));
  },

  async addRule(subredditId, title, description) {
    // Position is derived inside the transaction so concurrent adds cannot
    // collide on the same value; an OCC retry recomputes it.
    return withTransaction(async (tx) => {
      const [existing] = await tx
        .select({ value: count() })
        .from(subredditRules)
        .where(eq(subredditRules.subredditId, subredditId));

      const [row] = await tx
        .insert(subredditRules)
        .values({
          id: crypto.randomUUID(),
          subredditId,
          position: existing?.value ?? 0,
          title,
          description,
        })
        .returning();

      return {
        id: row.id,
        subredditId: row.subredditId,
        position: row.position,
        title: row.title,
        description: row.description,
      };
    });
  },

  async updateRule(ruleId, patch) {
    const [row] = await getDb()
      .update(subredditRules)
      .set({
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.description !== undefined && { description: patch.description }),
      })
      .where(eq(subredditRules.id, ruleId))
      .returning();

    if (!row) throw new Error("Rule not found");
    return {
      id: row.id,
      subredditId: row.subredditId,
      position: row.position,
      title: row.title,
      description: row.description,
    };
  },

  async deleteRule(ruleId) {
    await withTransaction(async (tx) => {
      const [deleted] = await tx
        .delete(subredditRules)
        .where(eq(subredditRules.id, ruleId))
        .returning();

      if (!deleted) return;

      // Close the gap so positions stay contiguous.
      const remaining = await tx
        .select()
        .from(subredditRules)
        .where(eq(subredditRules.subredditId, deleted.subredditId))
        .orderBy(asc(subredditRules.position));

      for (const [index, rule] of remaining.entries()) {
        if (rule.position === index) continue;
        await tx
          .update(subredditRules)
          .set({ position: index })
          .where(eq(subredditRules.id, rule.id));
      }
    });
  },

  async reorderRules(subredditId, ruleIds) {
    await withTransaction(async (tx) => {
      for (const [index, id] of ruleIds.entries()) {
        await tx
          .update(subredditRules)
          .set({ position: index })
          .where(
            and(
              eq(subredditRules.id, id),
              eq(subredditRules.subredditId, subredditId),
            ),
          );
      }
    });
  },

  // --- Subscriptions ------------------------------------------------------

  async subscribe(userId, subredditId) {
    return withTransaction(async (tx) => {
      // Composite PK makes this idempotent; onConflictDoNothing reports whether
      // a row was actually inserted, which decides the counter update.
      const inserted = await tx
        .insert(subredditSubscriptions)
        .values({ userId, subredditId })
        .onConflictDoNothing()
        .returning();

      if (inserted.length === 0) return false;

      // Relative update: safe to replay under an OCC retry.
      await tx
        .update(subredditsTable)
        .set({
          subscriberCount: sql`${subredditsTable.subscriberCount} + 1`,
        })
        .where(eq(subredditsTable.id, subredditId));

      return true;
    });
  },

  async unsubscribe(userId, subredditId) {
    return withTransaction(async (tx) => {
      const deleted = await tx
        .delete(subredditSubscriptions)
        .where(
          and(
            eq(subredditSubscriptions.userId, userId),
            eq(subredditSubscriptions.subredditId, subredditId),
          ),
        )
        .returning();

      if (deleted.length === 0) return false;

      // GREATEST guards the counter against going negative.
      await tx
        .update(subredditsTable)
        .set({
          subscriberCount: sql`GREATEST(${subredditsTable.subscriberCount} - 1, 0)`,
        })
        .where(eq(subredditsTable.id, subredditId));

      return true;
    });
  },

  async isSubscribed(userId, subredditId) {
    const [row] = await getDb()
      .select({ userId: subredditSubscriptions.userId })
      .from(subredditSubscriptions)
      .where(
        and(
          eq(subredditSubscriptions.userId, userId),
          eq(subredditSubscriptions.subredditId, subredditId),
        ),
      )
      .limit(1);
    return row !== undefined;
  },

  async getSubscribedSubredditIds(userId) {
    const rows = await getDb()
      .select({ subredditId: subredditSubscriptions.subredditId })
      .from(subredditSubscriptions)
      .where(eq(subredditSubscriptions.userId, userId));
    return rows.map((row) => row.subredditId);
  },

  async listSubscribedSubreddits(userId) {
    const rows = await getDb()
      .select({ subreddit: subredditsTable })
      .from(subredditSubscriptions)
      .innerJoin(
        subredditsTable,
        eq(subredditsTable.id, subredditSubscriptions.subredditId),
      )
      .where(eq(subredditSubscriptions.userId, userId))
      .orderBy(asc(subredditsTable.slug));

    return rows.map((row) => toSubreddit(row.subreddit));
  },

  // --- Moderators ---------------------------------------------------------

  async addModerator(subredditId, userId, role: ModeratorRole) {
    const [row] = await getDb()
      .insert(subredditModerators)
      .values({ subredditId, userId, role })
      .onConflictDoUpdate({
        target: [subredditModerators.subredditId, subredditModerators.userId],
        set: { role },
      })
      .returning();

    return {
      subredditId: row.subredditId,
      userId: row.userId,
      role: row.role as ModeratorRole,
      createdAt: row.createdAt.toISOString(),
    };
  },

  async removeModerator(subredditId, userId) {
    await getDb()
      .delete(subredditModerators)
      .where(
        and(
          eq(subredditModerators.subredditId, subredditId),
          eq(subredditModerators.userId, userId),
        ),
      );
  },

  async getModerator(subredditId, userId) {
    const [row] = await getDb()
      .select()
      .from(subredditModerators)
      .where(
        and(
          eq(subredditModerators.subredditId, subredditId),
          eq(subredditModerators.userId, userId),
        ),
      )
      .limit(1);

    if (!row) return null;
    return {
      subredditId: row.subredditId,
      userId: row.userId,
      role: row.role as ModeratorRole,
      createdAt: row.createdAt.toISOString(),
    };
  },

  async listModerators(subredditId) {
    const rows = await getDb()
      .select()
      .from(subredditModerators)
      .where(eq(subredditModerators.subredditId, subredditId))
      .orderBy(asc(subredditModerators.createdAt));

    return rows.map<SubredditModerator>((row) => ({
      subredditId: row.subredditId,
      userId: row.userId,
      role: row.role as ModeratorRole,
      createdAt: row.createdAt.toISOString(),
    }));
  },

  async listModeratedSubreddits(userId) {
    const rows = await getDb()
      .select({ subreddit: subredditsTable })
      .from(subredditModerators)
      .innerJoin(
        subredditsTable,
        eq(subredditsTable.id, subredditModerators.subredditId),
      )
      .where(eq(subredditModerators.userId, userId));

    return rows.map((row) => toSubreddit(row.subreddit));
  },

  // --- Bans ---------------------------------------------------------------

  async banUser(input) {
    const [row] = await getDb()
      .insert(subredditBans)
      .values({
        subredditId: input.subredditId,
        userId: input.userId,
        reason: input.reason,
        bannedBy: input.bannedBy,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      })
      // Re-banning replaces the previous ban rather than failing.
      .onConflictDoUpdate({
        target: [subredditBans.subredditId, subredditBans.userId],
        set: {
          reason: input.reason,
          bannedBy: input.bannedBy,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        },
      })
      .returning();

    return toBan(row);
  },

  async unbanUser(subredditId, userId) {
    await getDb()
      .delete(subredditBans)
      .where(
        and(
          eq(subredditBans.subredditId, subredditId),
          eq(subredditBans.userId, userId),
        ),
      );
  },

  async getActiveBan(subredditId, userId) {
    const [row] = await getDb()
      .select()
      .from(subredditBans)
      .where(
        and(
          eq(subredditBans.subredditId, subredditId),
          eq(subredditBans.userId, userId),
          activeBanCondition,
        ),
      )
      .limit(1);

    return row ? toBan(row) : null;
  },

  async listBans(subredditId) {
    const rows = await getDb()
      .select()
      .from(subredditBans)
      .where(
        and(eq(subredditBans.subredditId, subredditId), activeBanCondition),
      );
    return rows.map(toBan);
  },

  // --- Comments -----------------------------------------------------------

  async createComment(input: CreateCommentInput) {
    const [row] = await getDb()
      .insert(commentsTable)
      .values({
        id: crypto.randomUUID(),
        postId: input.postId,
        parentCommentId: input.parentCommentId,
        authorId: input.authorId,
        body: input.body,
      })
      .returning();

    return toComment(row);
  },

  async getCommentById(id) {
    const [row] = await getDb()
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.id, id))
      .limit(1);
    return row ? toComment(row) : null;
  },

  async listCommentsByPost(postId) {
    // One query for the whole thread; the tree is assembled in the service
    // layer. Tombstoned rows are included so replies stay reachable.
    const rows = await getDb()
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.postId, postId))
      .orderBy(asc(commentsTable.createdAt));

    return rows.map(toComment);
  },

  async listCommentsByAuthor(authorId, limit = 25) {
    const rows = await getDb()
      .select()
      .from(commentsTable)
      .where(
        and(
          eq(commentsTable.authorId, authorId),
          isNull(commentsTable.deletedAt),
          isNull(commentsTable.removedAt),
        ),
      )
      .orderBy(desc(commentsTable.createdAt))
      .limit(limit);

    return rows.map(toComment);
  },

  async updateCommentBody(id, body) {
    const [row] = await getDb()
      .update(commentsTable)
      .set({ body, editedAt: new Date() })
      .where(eq(commentsTable.id, id))
      .returning();

    if (!row) throw new Error("Comment not found");
    return toComment(row);
  },

  async softDeleteComment(id) {
    // Tombstone only: the row survives so its replies remain reachable.
    const [row] = await getDb()
      .update(commentsTable)
      .set({ deletedAt: new Date() })
      .where(eq(commentsTable.id, id))
      .returning();

    if (!row) throw new Error("Comment not found");
    return toComment(row);
  },

  async setCommentRemoved(id, removedBy) {
    const [row] = await getDb()
      .update(commentsTable)
      .set({
        removedAt: removedBy ? new Date() : null,
        removedBy,
      })
      .where(eq(commentsTable.id, id))
      .returning();

    if (!row) throw new Error("Comment not found");
    return toComment(row);
  },

  async countCommentsByPost(postId) {
    const [row] = await getDb()
      .select({ value: count() })
      .from(commentsTable)
      .where(
        and(
          eq(commentsTable.postId, postId),
          isNull(commentsTable.deletedAt),
          isNull(commentsTable.removedAt),
        ),
      );
    return row?.value ?? 0;
  },

  // --- Mod log ------------------------------------------------------------

  async addModLogEntry(input) {
    const [row] = await getDb()
      .insert(modLogTable)
      .values({
        id: crypto.randomUUID(),
        subredditId: input.subredditId,
        moderatorId: input.moderatorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
      })
      .returning();

    return {
      id: row.id,
      subredditId: row.subredditId,
      moderatorId: row.moderatorId,
      action: row.action as ModLogEntry["action"],
      targetType: row.targetType as ModLogEntry["targetType"],
      targetId: row.targetId,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    };
  },

  async listModLog(subredditId, limit = 50) {
    const rows = await getDb()
      .select()
      .from(modLogTable)
      .where(eq(modLogTable.subredditId, subredditId))
      .orderBy(desc(modLogTable.createdAt))
      .limit(limit);

    return rows.map<ModLogEntry>((row) => ({
      id: row.id,
      subredditId: row.subredditId,
      moderatorId: row.moderatorId,
      action: row.action as ModLogEntry["action"],
      targetType: row.targetType as ModLogEntry["targetType"],
      targetId: row.targetId,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
  },
};
