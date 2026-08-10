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

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import { getDb, withTransaction } from "./dsql";
import { windowCutoff } from "./ranking";
import type {
  CreateCommentInput,
  CreatePostInput,
  CreateSubredditInput,
  PostListOptions,
  Repository,
  SubredditListOptions,
  UpdatePostInput,
  UpdateSubredditInput,
} from "./repository";
import {
  comments as commentsTable,
  modLog as modLogTable,
  posts as postsTable,
  subredditBans,
  subredditModerators,
  subredditRules,
  subredditSubscriptions,
  subreddits as subredditsTable,
  votes as votesTable,
} from "./schema";
import type {
  Comment,
  ModLogEntry,
  ModeratorRole,
  Post,
  PostId,
  PostSort,
  Score,
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
type PostRow = typeof postsTable.$inferSelect;

function toPost(row: PostRow): Post {
  return {
    id: row.id,
    subredditId: row.subredditId,
    authorId: row.authorId,
    title: row.title,
    body: row.body,
    postType: row.postType as Post["postType"],
    url: row.url,
    imageUrl: row.imageUrl,
    createdAt: row.createdAt.toISOString(),
    editedAt: iso(row.editedAt),
    deletedAt: iso(row.deletedAt),
    removedAt: iso(row.removedAt),
    removedBy: row.removedBy,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    score: row.score,
  };
}

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

function toComment(row: CommentRow): Comment {  return {
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

  // --- Posts (TM2) --------------------------------------------------------

  async createPost(input: CreatePostInput) {
    const [row] = await getDb()
      .insert(postsTable)
      .values({
        id: input.id ?? crypto.randomUUID(),
        subredditId: input.subredditId,
        authorId: input.authorId,
        title: input.title,
        body: input.body,
        postType: input.postType,
        url: input.url,
        imageUrl: input.imageUrl,
        // Omitted for normal creation so the column default applies.
        ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
      })
      .returning();

    return toPost(row);
  },

  async getPostById(id) {
    const [row] = await getDb()
      .select()
      .from(postsTable)
      .where(eq(postsTable.id, id))
      .limit(1);
    return row ? toPost(row) : null;
  },

  async listPosts(options = {}) {
    const rows = await getDb()
      .select()
      .from(postsTable)
      .where(postFilter(options))
      .orderBy(...postOrderBy(options.sort ?? "hot"))
      .limit(options.limit ?? 20)
      .offset(options.offset ?? 0);

    return rows.map(toPost);
  },

  async countPosts(options = {}) {
    const [row] = await getDb()
      .select({ value: count() })
      .from(postsTable)
      .where(postFilter(options));
    return Number(row?.value ?? 0);
  },

  async updatePost(id: PostId, patch: UpdatePostInput) {
    const [row] = await getDb()
      .update(postsTable)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(patch.imageUrl !== undefined ? { imageUrl: patch.imageUrl } : {}),
        editedAt: new Date(),
      })
      .where(eq(postsTable.id, id))
      .returning();

    if (!row) throw new Error("Post not found");
    return toPost(row);
  },

  async softDeletePost(id) {
    // Tombstone only; comments beneath it must stay reachable.
    const [row] = await getDb()
      .update(postsTable)
      .set({ deletedAt: new Date() })
      .where(eq(postsTable.id, id))
      .returning();

    if (!row) throw new Error("Post not found");
    return toPost(row);
  },

  async setPostRemoved(id, removedBy) {
    const [row] = await getDb()
      .update(postsTable)
      .set({
        removedAt: removedBy === null ? null : new Date(),
        removedBy,
      })
      .where(eq(postsTable.id, id))
      .returning();

    if (!row) throw new Error("Post not found");
    return toPost(row);
  },

  // --- Votes (TM2) --------------------------------------------------------

  async castVote(targetType, targetId, voterId, value) {
    /*
     * One transaction: settle the vote row, then recompute the target's tallies
     * from the votes table.
     *
     * The recompute is a single UPDATE ... FROM (SELECT ...), so it is both
     * atomic and idempotent — which matters because an OCC conflict re-runs this
     * whole callback. A relative `score + 1` update would be wrong here: on
     * retry it would count the same vote twice.
     */
    return withTransaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(votesTable)
        .where(
          and(
            eq(votesTable.targetType, targetType),
            eq(votesTable.targetId, targetId),
            eq(votesTable.voterId, voterId),
          ),
        )
        .limit(1);

      if (!existing) {
        await tx.insert(votesTable).values({
          targetType,
          targetId,
          voterId,
          value,
        });
      } else if (existing.value === value) {
        // Same direction again: clear it rather than storing a zero.
        await tx
          .delete(votesTable)
          .where(
            and(
              eq(votesTable.targetType, targetType),
              eq(votesTable.targetId, targetId),
              eq(votesTable.voterId, voterId),
            ),
          );
      } else {
        await tx
          .update(votesTable)
          .set({ value, updatedAt: new Date() })
          .where(
            and(
              eq(votesTable.targetType, targetType),
              eq(votesTable.targetId, targetId),
              eq(votesTable.voterId, voterId),
            ),
          );
      }

      const [tally] = await tx
        .select({
          upvotes: sql<number>`coalesce(sum(case when ${votesTable.value} = 1 then 1 else 0 end), 0)::int`,
          downvotes: sql<number>`coalesce(sum(case when ${votesTable.value} = -1 then 1 else 0 end), 0)::int`,
        })
        .from(votesTable)
        .where(
          and(
            eq(votesTable.targetType, targetType),
            eq(votesTable.targetId, targetId),
          ),
        );

      const upvotes = Number(tally?.upvotes ?? 0);
      const downvotes = Number(tally?.downvotes ?? 0);

      // Only posts carry denormalized tallies; comment scores are read live.
      if (targetType === "post") {
        await tx
          .update(postsTable)
          .set({ upvotes, downvotes, score: upvotes - downvotes })
          .where(eq(postsTable.id, targetId));
      }

      const [own] = await tx
        .select({ value: votesTable.value })
        .from(votesTable)
        .where(
          and(
            eq(votesTable.targetType, targetType),
            eq(votesTable.targetId, targetId),
            eq(votesTable.voterId, voterId),
          ),
        )
        .limit(1);

      return {
        targetType,
        targetId,
        score: upvotes - downvotes,
        upvotes,
        downvotes,
        viewerVote: (own ? (Number(own.value) as 1 | -1) : 0) as 1 | 0 | -1,
      };
    });
  },

  async getScores(targetType, targetIds, viewerId) {
    const result = new Map<string, Score>();
    if (targetIds.length === 0) return result;

    const unique = [...new Set(targetIds)];

    // Zero-fill first so a target with no votes still gets an entry — callers
    // treat a missing key as "not found" rather than "no votes yet".
    for (const targetId of unique) {
      result.set(targetId, {
        targetType,
        targetId,
        score: 0,
        upvotes: 0,
        downvotes: 0,
        viewerVote: 0,
      });
    }

    const rows = await getDb()
      .select({
        targetId: votesTable.targetId,
        upvotes: sql<number>`coalesce(sum(case when ${votesTable.value} = 1 then 1 else 0 end), 0)::int`,
        downvotes: sql<number>`coalesce(sum(case when ${votesTable.value} = -1 then 1 else 0 end), 0)::int`,
        viewerVote: viewerId
          ? sql<number>`coalesce(max(case when ${votesTable.voterId} = ${viewerId} then ${votesTable.value} else 0 end), 0)::int`
          : sql<number>`0::int`,
      })
      .from(votesTable)
      .where(
        and(
          eq(votesTable.targetType, targetType),
          inArray(votesTable.targetId, unique),
        ),
      )
      .groupBy(votesTable.targetId);

    for (const row of rows) {
      const upvotes = Number(row.upvotes);
      const downvotes = Number(row.downvotes);
      result.set(row.targetId, {
        targetType,
        targetId: row.targetId,
        score: upvotes - downvotes,
        upvotes,
        downvotes,
        viewerVote: Number(row.viewerVote) as 1 | 0 | -1,
      });
    }

    return result;
  },

  async recordVotes(targetType, targetId, votes) {
    /*
     * One transaction for the whole batch, then a single tally refresh.
     *
     * `castVote` recomputes tallies per call, which turns seeding a few hundred
     * fixture votes into a few hundred transactions. Same end state, one round
     * trip.
     *
     * Chunked well inside DSQL's 3,000-rows-per-transaction cap, and idempotent:
     * a re-run overwrites the same voter rows rather than adding duplicates.
     */
    const CHUNK = 500;

    return withTransaction(async (tx) => {
      for (let start = 0; start < votes.length; start += CHUNK) {
        const chunk = votes.slice(start, start + CHUNK);

        // Clear any prior vote by these voters, so a re-run overwrites rather
        // than colliding with the composite primary key.
        for (const { voterId } of chunk) {
          await tx
            .delete(votesTable)
            .where(
              and(
                eq(votesTable.targetType, targetType),
                eq(votesTable.targetId, targetId),
                eq(votesTable.voterId, voterId),
              ),
            );
        }

        if (chunk.length > 0) {
          await tx.insert(votesTable).values(
            chunk.map(({ voterId, value }) => ({
              targetType,
              targetId,
              voterId,
              value,
            })),
          );
        }
      }

      const [tally] = await tx
        .select({
          upvotes: sql<number>`coalesce(sum(case when ${votesTable.value} = 1 then 1 else 0 end), 0)::int`,
          downvotes: sql<number>`coalesce(sum(case when ${votesTable.value} = -1 then 1 else 0 end), 0)::int`,
        })
        .from(votesTable)
        .where(
          and(
            eq(votesTable.targetType, targetType),
            eq(votesTable.targetId, targetId),
          ),
        );

      const upvotes = Number(tally?.upvotes ?? 0);
      const downvotes = Number(tally?.downvotes ?? 0);

      if (targetType === "post") {
        await tx
          .update(postsTable)
          .set({ upvotes, downvotes, score: upvotes - downvotes })
          .where(eq(postsTable.id, targetId));
      }

      return {
        targetType,
        targetId,
        score: upvotes - downvotes,
        upvotes,
        downvotes,
        viewerVote: 0 as const,
      };
    });
  },

  async listVotedTargetIds(voterId, targetType, value, limit = 25) {
    const rows = await getDb()
      .select({ targetId: votesTable.targetId })
      .from(votesTable)
      .where(
        and(
          eq(votesTable.voterId, voterId),
          eq(votesTable.targetType, targetType),
          eq(votesTable.value, value),
        ),
      )
      .orderBy(desc(votesTable.createdAt))
      .limit(limit);

    return rows.map((row) => row.targetId);
  },
};

// --- Post query construction ----------------------------------------------

/**
 * Filter shared by `listPosts` and `countPosts`, so a listing and its count can
 * never disagree.
 *
 * Author-deleted and moderator-removed rows are excluded unconditionally. The
 * integration contract flags this as a seam that breaks quietly: if any query
 * forgets, moderator-removed posts keep appearing.
 */
function postFilter(options: PostListOptions) {
  const conditions = [isNull(postsTable.deletedAt), isNull(postsTable.removedAt)];

  if (options.subredditId) {
    conditions.push(eq(postsTable.subredditId, options.subredditId));
  }
  if (options.subredditIds) {
    // An empty subscription list must match nothing, not everything.
    conditions.push(
      options.subredditIds.length > 0
        ? inArray(postsTable.subredditId, options.subredditIds)
        : sql`false`,
    );
  }
  if (options.authorId) {
    conditions.push(eq(postsTable.authorId, options.authorId));
  }
  if (options.postType) {
    conditions.push(eq(postsTable.postType, options.postType));
  }

  if (options.sort === "top") {
    const cutoff = windowCutoff(options.window);
    if (cutoff) conditions.push(gte(postsTable.createdAt, cutoff));
  }

  const query = options.query?.trim();
  if (query) {
    // Drizzle parameterises the pattern, and ilike escaping of % and _ is
    // handled by escapeLike at the service layer.
    const pattern = `%${query}%`;
    const match = or(
      ilike(postsTable.title, pattern),
      ilike(postsTable.body, pattern),
      ilike(sql`coalesce(${postsTable.url}, '')`, pattern),
    );
    if (match) conditions.push(match);
  }

  return and(...conditions);
}

/**
 * SQL equivalents of the comparators in `ranking.ts`. The two must agree, or a
 * sort behaves differently locally than deployed.
 */
function postOrderBy(sort: PostSort) {
  const newest = desc(postsTable.createdAt);

  switch (sort) {
    case "new":
      return [newest];
    case "top":
      return [desc(postsTable.score), newest];
    case "controversial":
      return [
        desc(sql`case
          when ${postsTable.upvotes} = 0 or ${postsTable.downvotes} = 0 then 0::double precision
          else power(
            (${postsTable.upvotes} + ${postsTable.downvotes})::double precision,
            least(${postsTable.upvotes}, ${postsTable.downvotes})::double precision
              / greatest(${postsTable.upvotes}, ${postsTable.downvotes})::double precision
          )
        end`),
        newest,
      ];
    case "hot":
    default:
      return [
        desc(sql`log(greatest(abs(${postsTable.score}), 1)::numeric)::double precision
          + sign(${postsTable.score})::double precision
            * (extract(epoch from ${postsTable.createdAt}) / 45000.0)`),
        newest,
      ];
  }
}
