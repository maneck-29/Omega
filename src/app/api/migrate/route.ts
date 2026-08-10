import { auroraDSQLPostgres } from "@aws/aurora-dsql-postgresjs-connector";

export async function POST() {
  // Constructed outside the try so the finally block can always close it: on a
  // failed migration the connection would otherwise leak, and DSQL holds it for
  // up to an hour.
  const sql = auroraDSQLPostgres({
    host: process.env.PGHOST!,
    database: process.env.PGDATABASE || "postgres",
    username: process.env.DSQL_ADMIN_USER || "admin",
  });

  try {
    // Each DDL statement must run in its own transaction in DSQL

    await sql`CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;

    await sql`CREATE TABLE IF NOT EXISTS subreddits (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      banner_url TEXT,
      icon_url TEXT,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      subscriber_count INTEGER NOT NULL DEFAULT 0
    )`;

    await sql`CREATE TABLE IF NOT EXISTS subreddit_rules (
      id UUID PRIMARY KEY,
      subreddit_id UUID NOT NULL,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    )`;

    await sql`CREATE TABLE IF NOT EXISTS subreddit_subscriptions (
      user_id TEXT NOT NULL,
      subreddit_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, subreddit_id)
    )`;

    await sql`CREATE TABLE IF NOT EXISTS subreddit_moderators (
      subreddit_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'moderator',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (subreddit_id, user_id)
    )`;

    await sql`CREATE TABLE IF NOT EXISTS subreddit_bans (
      subreddit_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      banned_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ,
      PRIMARY KEY (subreddit_id, user_id)
    )`;

    await sql`CREATE TABLE IF NOT EXISTS comments (
      id UUID PRIMARY KEY,
      post_id TEXT NOT NULL,
      parent_comment_id UUID,
      author_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      removed_at TIMESTAMPTZ,
      removed_by TEXT
    )`;

    await sql`CREATE TABLE IF NOT EXISTS mod_log (
      id UUID PRIMARY KEY,
      subreddit_id UUID NOT NULL,
      moderator_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

    // Grant permissions to the app user
    const appUser = process.env.PGUSER || "omega_user_items_db";
    await sql`GRANT ALL ON TABLE items TO ${sql.unsafe(appUser)}`;
    await sql`GRANT ALL ON TABLE subreddits TO ${sql.unsafe(appUser)}`;
    await sql`GRANT ALL ON TABLE subreddit_rules TO ${sql.unsafe(appUser)}`;
    await sql`GRANT ALL ON TABLE subreddit_subscriptions TO ${sql.unsafe(appUser)}`;
    await sql`GRANT ALL ON TABLE subreddit_moderators TO ${sql.unsafe(appUser)}`;
    await sql`GRANT ALL ON TABLE subreddit_bans TO ${sql.unsafe(appUser)}`;
    await sql`GRANT ALL ON TABLE comments TO ${sql.unsafe(appUser)}`;
    await sql`GRANT ALL ON TABLE mod_log TO ${sql.unsafe(appUser)}`;

    // Async indexes (these run in background)
    await sql`CREATE UNIQUE INDEX ASYNC IF NOT EXISTS subreddits_slug_key ON subreddits (slug)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS subreddits_subscriber_count_idx ON subreddits (subscriber_count)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS subreddits_created_at_idx ON subreddits (created_at)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS subreddit_rules_subreddit_idx ON subreddit_rules (subreddit_id, position)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS subscriptions_subreddit_idx ON subreddit_subscriptions (subreddit_id)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS moderators_user_idx ON subreddit_moderators (user_id)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS comments_post_idx ON comments (post_id, created_at)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS comments_parent_idx ON comments (parent_comment_id)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS comments_author_idx ON comments (author_id, created_at)`;
    await sql`CREATE INDEX ASYNC IF NOT EXISTS mod_log_subreddit_idx ON mod_log (subreddit_id, created_at)`;

    return Response.json({
      success: true,
      message: "All tables and indexes created",
      appUser,
      note: "Index builds are asynchronous; check SELECT * FROM sys.jobs.",
    });
  } catch (error) {
    console.error("Migration error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Migration failed" },
      { status: 500 }
    );
  } finally {
    await sql.end();
  }
}
