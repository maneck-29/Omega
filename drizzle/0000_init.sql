-- Initial schema for Amazon Aurora DSQL.
--
-- NOTE: `src/app/api/migrate/route.ts` applies the same schema over HTTP, for
-- deployed environments where psql is unavailable. The two must stay in step.
-- They currently differ only in index direction (this file declares DESC on the
-- time and counter indexes); Postgres can scan an index in either direction, so
-- both produce equivalent plans. Consolidating on one source would be better
-- than keeping them synchronised by hand.
--
-- Hand-written rather than generated, because DSQL requires DDL that standard
-- Drizzle output does not produce:
--
--   * CREATE INDEX ASYNC for secondary indexes (CREATE INDEX is unsupported)
--   * one DDL statement per transaction, so each statement runs standalone
--   * no FOREIGN KEY constraints — referential integrity lives in the service
--     layer (see docs/integration-contract.md)
--   * no sequences or SERIAL — primary keys are application-generated UUIDs,
--     which also spread writes and reduce optimistic-concurrency conflicts
--
-- Apply with psql against the cluster endpoint. Statements are ordered so a
-- partial run can be resumed; each is idempotent.
--
--   psql --host "$PGHOST" --username admin --dbname postgres \
--        --file drizzle/0000_init.sql
--
-- Index builds are asynchronous. Check progress with:
--   SELECT * FROM sys.jobs;

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
);

CREATE TABLE IF NOT EXISTS subreddit_rules (
    id           UUID PRIMARY KEY,
    subreddit_id UUID NOT NULL,
    position     INTEGER NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT ''
);

-- Composite primary key makes a duplicate subscription impossible, which is
-- what keeps subscribe() idempotent without a read-modify-write.
CREATE TABLE IF NOT EXISTS subreddit_subscriptions (
    user_id      TEXT NOT NULL,
    subreddit_id UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, subreddit_id)
);

CREATE TABLE IF NOT EXISTS subreddit_moderators (
    subreddit_id UUID NOT NULL,
    user_id      TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'moderator',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subreddit_id, user_id)
);

CREATE TABLE IF NOT EXISTS subreddit_bans (
    subreddit_id UUID NOT NULL,
    user_id      TEXT NOT NULL,
    reason       TEXT NOT NULL DEFAULT '',
    banned_by    TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULL means permanent.
    expires_at   TIMESTAMPTZ,
    PRIMARY KEY (subreddit_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
    id                UUID PRIMARY KEY,
    -- References posts(id), owned by TM2. No FK: unsupported in DSQL.
    post_id           TEXT NOT NULL,
    -- Adjacency list; NULL for a top-level comment.
    parent_comment_id UUID,
    author_id         TEXT NOT NULL,
    body              TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at         TIMESTAMPTZ,
    -- Author deletion and moderator removal are distinct, and both are soft:
    -- the row survives as a tombstone so replies stay reachable.
    deleted_at        TIMESTAMPTZ,
    removed_at        TIMESTAMPTZ,
    removed_by        TEXT
);

CREATE TABLE IF NOT EXISTS mod_log (
    id            UUID PRIMARY KEY,
    subreddit_id  UUID NOT NULL,
    moderator_id  TEXT NOT NULL,
    action        TEXT NOT NULL,
    target_type   TEXT NOT NULL,
    target_id     TEXT NOT NULL,
    reason        TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforces case-insensitive subreddit name uniqueness; `slug` is the lowercased
-- name, so a plain unique index is sufficient.
CREATE UNIQUE INDEX ASYNC IF NOT EXISTS subreddits_slug_key
    ON subreddits (slug);

CREATE INDEX ASYNC IF NOT EXISTS subreddits_subscriber_count_idx
    ON subreddits (subscriber_count DESC);

CREATE INDEX ASYNC IF NOT EXISTS subreddits_created_at_idx
    ON subreddits (created_at DESC);

CREATE INDEX ASYNC IF NOT EXISTS subreddit_rules_subreddit_idx
    ON subreddit_rules (subreddit_id, position);

-- Reverse lookup: subscribers of a subreddit. The forward direction is served
-- by the primary key.
CREATE INDEX ASYNC IF NOT EXISTS subscriptions_subreddit_idx
    ON subreddit_subscriptions (subreddit_id);

-- Supports "moderator of" on TM1's profile pages.
CREATE INDEX ASYNC IF NOT EXISTS moderators_user_idx
    ON subreddit_moderators (user_id);

-- The hot path: every comment for a post in a single query.
CREATE INDEX ASYNC IF NOT EXISTS comments_post_idx
    ON comments (post_id, created_at);

CREATE INDEX ASYNC IF NOT EXISTS comments_parent_idx
    ON comments (parent_comment_id);

-- Comment history on TM1's profile pages, and karma aggregation.
CREATE INDEX ASYNC IF NOT EXISTS comments_author_idx
    ON comments (author_id, created_at DESC);

CREATE INDEX ASYNC IF NOT EXISTS mod_log_subreddit_idx
    ON mod_log (subreddit_id, created_at DESC);

-- Grants.
--
-- DSQL manages permissions through explicit grants, and the deployed app
-- connects as a non-admin role (the Omega integration provisions something like
-- `omega_user_<name>`; see src/app/api/migrate/route.ts). Tables created by
-- `admin` are not readable by that role without this, so skipping these grants
-- produces permission errors at runtime rather than at migration time.
--
-- Substitute the application role before running, e.g.:
--   psql ... --set=app_user=omega_user_items_db --file drizzle/0000_init.sql
-- and replace :app_user below. When running everything as admin, these are
-- harmless no-ops.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE subreddits TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE subreddit_rules TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE subreddit_subscriptions TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE subreddit_moderators TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE subreddit_bans TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE comments TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE mod_log TO :"app_user";
