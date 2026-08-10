/**
 * Drizzle schema for Amazon Aurora DSQL.
 *
 * DSQL is PostgreSQL-compatible but distributed, which constrains the design:
 *
 * - **No foreign keys.** Referential integrity is enforced in the service layer
 *   (see `comments.ts` validating parent/post agreement). Columns that would be
 *   FKs are documented as such but carry no database constraint.
 * - **No sequences or SERIAL.** Primary keys are application-generated UUIDs,
 *   which also spread writes across the key range and reduce OCC contention.
 * - **Repeatable Read + optimistic concurrency.** There is no row locking;
 *   conflicts surface at commit and the transaction is retried, so transaction
 *   bodies must be idempotent.
 * - **3,000 rows modified per transaction.**
 *
 * Indexes are declared here for documentation, but DSQL requires
 * `CREATE INDEX ASYNC`, so the migration in `drizzle/0000_init.sql` is the
 * authoritative DDL rather than generated Drizzle output.
 */

import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const subreddits = pgTable(
  "subreddits",
  {
    id: uuid("id").primaryKey(),
    /** Display name; preserves the creator's casing. */
    name: text("name").notNull(),
    /** Lowercased name — the uniqueness key and route slug. */
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    bannerUrl: text("banner_url"),
    iconUrl: text("icon_url"),
    /** References users.id (TM1). No FK: unsupported in DSQL. */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Denormalized counter, updated in the same transaction as the subscription
     * row. Avoids COUNT(*) per page render.
     *
     * Contention note: a popular subreddit makes this row an OCC hotspot, since
     * every subscribe/unsubscribe writes it. If conflicts become common, move to
     * a sharded counter or an async rollup.
     */
    subscriberCount: integer("subscriber_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("subreddits_slug_key").on(table.slug),
    index("subreddits_subscriber_count_idx").on(table.subscriberCount),
    index("subreddits_created_at_idx").on(table.createdAt),
  ],
);

export const subredditRules = pgTable(
  "subreddit_rules",
  {
    id: uuid("id").primaryKey(),
    subredditId: uuid("subreddit_id").notNull(),
    /** 0-based display order; rules are reorderable. */
    position: integer("position").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
  },
  (table) => [index("subreddit_rules_subreddit_idx").on(table.subredditId)],
);

/**
 * Composite primary key makes a duplicate subscription impossible at the storage
 * layer, so `subscribe()` is idempotent without a read-modify-write.
 */
export const subredditSubscriptions = pgTable(
  "subreddit_subscriptions",
  {
    userId: text("user_id").notNull(),
    subredditId: uuid("subreddit_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.subredditId] }),
    index("subscriptions_subreddit_idx").on(table.subredditId),
  ],
);

export const subredditModerators = pgTable(
  "subreddit_moderators",
  {
    subredditId: uuid("subreddit_id").notNull(),
    userId: text("user_id").notNull(),
    /** "owner" is the creator; "moderator" is appointed. */
    role: text("role").notNull().default("moderator"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.subredditId, table.userId] }),
    // Supports "moderator of" on TM1's profile pages.
    index("moderators_user_idx").on(table.userId),
  ],
);

export const subredditBans = pgTable(
  "subreddit_bans",
  {
    subredditId: uuid("subreddit_id").notNull(),
    userId: text("user_id").notNull(),
    reason: text("reason").notNull().default(""),
    bannedBy: text("banned_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** NULL means permanent. Expiry is evaluated on read. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.subredditId, table.userId] })],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey(),
    /** References TM2's posts.id. No FK: unsupported in DSQL. */
    postId: text("post_id").notNull(),
    /** Adjacency list; NULL for a top-level comment. */
    parentCommentId: uuid("parent_comment_id"),
    /** References users.id (TM1). */
    authorId: text("author_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    /** Author deletion. Soft only — replies must stay reachable. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Moderator removal, tracked separately from author deletion. */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: text("removed_by"),
  },
  (table) => [
    // The hot path: every comment for a post in one query.
    index("comments_post_idx").on(table.postId),
    index("comments_parent_idx").on(table.parentCommentId),
    // Comment history on TM1's profile pages.
    index("comments_author_idx").on(table.authorId),
  ],
);

export const modLog = pgTable(
  "mod_log",
  {
    id: uuid("id").primaryKey(),
    subredditId: uuid("subreddit_id").notNull(),
    moderatorId: text("moderator_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("mod_log_subreddit_idx").on(table.subredditId)],
);
