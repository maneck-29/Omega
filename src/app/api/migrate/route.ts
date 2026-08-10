import { auroraDSQLPostgres } from "@aws/aurora-dsql-postgresjs-connector";

/**
 * POST /api/migrate — create tables and grant access to the application role.
 *
 * Runs the schema in a deployed environment, where `psql` is not available.
 * `drizzle/0000_init.sql` is the same schema for local use and remains the
 * readable reference; keep the two in step.
 *
 * Connects as the admin role, because table creation and GRANT require it. The
 * deployed app itself connects as a non-admin role, which is why every table
 * needs an explicit grant — without one, queries fail at runtime with a
 * permission error rather than failing here.
 *
 * DSQL requires one DDL statement per transaction, so each statement is sent
 * separately rather than batched. Every statement is idempotent, so a partial
 * run can simply be retried.
 */

const TABLES = [
  // Connectivity smoke test, predates the domain tables.
  "items",
  // TM3 — subreddits and comments.
  "subreddits",
  "subreddit_rules",
  "subreddit_subscriptions",
  "subreddit_moderators",
  "subreddit_bans",
  "comments",
  "mod_log",
] as const;

export async function POST() {
  const sql = auroraDSQLPostgres({
    host: process.env.PGHOST!,
    database: process.env.PGDATABASE || "postgres",
    username: process.env.DSQL_ADMIN_USER || "admin",
  });

  try {
    // --- Tables -----------------------------------------------------------
    // No foreign keys and no sequences: both are unsupported in DSQL, so
    // referential integrity lives in the service layer and ids are
    // application-generated UUIDs.

    await sql`
      CREATE TABLE IF NOT EXISTS items (
        id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name       TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS subreddits (
        id               UUID PRIMARY KEY,
        name             TEXT NOT NULL,
        slug             TEXT NOT NULL,
        description      TEXT NOT NULL DEFAULT '',
        banner_url       TEXT,
        icon_url         TEXT,
        created_by       TEXT NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        subscriber_count INTEGER NOT NULL DEFAULT 0
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS subreddit_rules (
        id           UUID PRIMARY KEY,
        subreddit_id UUID NOT NULL,
        position     INTEGER NOT NULL,
        title        TEXT NOT NULL,
        description  TEXT NOT NULL DEFAULT ''
      )
    `;

    // Composite primary key is what makes subscribe() idempotent.
    await sql`
      CREATE TABLE IF NOT EXISTS subreddit_subscriptions (
        user_id      TEXT NOT NULL,
        subreddit_id UUID NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, subreddit_id)
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS subreddit_moderators (
        subreddit_id UUID NOT NULL,
        user_id      TEXT NOT NULL,
        role         TEXT NOT NULL DEFAULT 'moderator',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (subreddit_id, user_id)
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS subreddit_bans (
        subreddit_id UUID NOT NULL,
        user_id      TEXT NOT NULL,
        reason       TEXT NOT NULL DEFAULT '',
        banned_by    TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at   TIMESTAMPTZ,
        PRIMARY KEY (subreddit_id, user_id)
      )
    `;

    // deleted_at (author) and removed_at (moderator) are distinct, and both are
    // soft: the row survives as a tombstone so replies stay reachable.
    await sql`
      CREATE TABLE IF NOT EXISTS comments (
        id                UUID PRIMARY KEY,
        post_id           TEXT NOT NULL,
        parent_comment_id UUID,
        author_id         TEXT NOT NULL,
        body              TEXT NOT NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        edited_at         TIMESTAMPTZ,
        deleted_at        TIMESTAMPTZ,
        removed_at        TIMESTAMPTZ,
        removed_by        TEXT
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS mod_log (
        id           UUID PRIMARY KEY,
        subreddit_id UUID NOT NULL,
        moderator_id TEXT NOT NULL,
        action       TEXT NOT NULL,
        target_type  TEXT NOT NULL,
        target_id    TEXT NOT NULL,
        reason       TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    // --- Indexes ----------------------------------------------------------
    // ASYNC because plain CREATE INDEX is unsupported. Builds continue in the
    // background; track them with `SELECT * FROM sys.jobs`.

    await sql`CREATE UNIQUE INDEX ASYNC IF NOT EXISTS subreddits_slug_key ON subreddits (slug)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS subreddits_subscriber_count_idx ON subreddits (subscriber_count DESC)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS subreddits_created_at_idx ON subreddits (created_at DESC)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS subreddit_rules_subreddit_idx ON subreddit_rules (subreddit_id, position)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS subscriptions_subreddit_idx ON subreddit_subscriptions (subreddit_id)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS moderators_user_idx ON subreddit_moderators (user_id)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS comments_post_idx ON comments (post_id, created_at)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS comments_parent_idx ON comments (parent_comment_id)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS comments_author_idx ON comments (author_id, created_at DESC)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS mod_log_subreddit_idx ON mod_log (subreddit_id, created_at DESC)`;

    // --- Grants -----------------------------------------------------------
    // The app connects as a non-admin role, so each table needs an explicit
    // grant. A no-op when the app also runs as admin.

    const appUser = process.env.PGUSER;
    const granted: string[] = [];

    if (appUser && appUser !== "admin") {
      for (const table of TABLES) {
        await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${sql.unsafe(table)} TO ${sql.unsafe(appUser)}`;
        granted.push(table);
      }
    }

    return Response.json({
      success: true,
      tables: TABLES,
      granted: appUser && appUser !== "admin" ? granted : [],
      appUser: appUser ?? "(unset — running as admin, no grants needed)",
      note: "Index builds are asynchronous; check SELECT * FROM sys.jobs.",
    });
  } catch (error) {
    console.error("Migration error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Migration failed" },
      { status: 500 },
    );
  } finally {
    await sql.end();
  }
}
