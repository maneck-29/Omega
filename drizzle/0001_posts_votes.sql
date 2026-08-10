-- Posts and votes for Amazon Aurora DSQL. Owned by TM2 (Posts & Voting).
--
-- A separate file from 0000_init.sql because DSQL allows only one DDL statement
-- per transaction, so applying migrations independently is simpler than
-- extending a single script (see docs/integration-contract.md, open decision 4).
--
-- Same constraints as the initial migration:
--
--   * CREATE INDEX ASYNC for secondary indexes (CREATE INDEX is unsupported)
--   * one DDL statement per transaction, so each statement runs standalone
--   * no FOREIGN KEY constraints — referential integrity lives in the service
--     layer
--   * no sequences or SERIAL — primary keys are application-generated UUIDs
--
-- Apply with psql against the cluster endpoint. Each statement is idempotent, so
-- a partial run can be resumed.
--
--   psql --host "$PGHOST" --username admin --dbname postgres \
--        --file drizzle/0001_posts_votes.sql
--
-- Index builds are asynchronous. Check progress with:
--   SELECT * FROM sys.jobs;

CREATE TABLE IF NOT EXISTS posts (
    id           UUID PRIMARY KEY,
    subreddit_id UUID NOT NULL,
    author_id    TEXT NOT NULL,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL DEFAULT '',
    post_type    TEXT NOT NULL DEFAULT 'text',
    url          TEXT,
    image_url    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at    TIMESTAMPTZ,
    -- Author deletion and moderator removal are separate columns, never a hard
    -- delete: a removed post still has to render so its comments stay reachable.
    deleted_at   TIMESTAMPTZ,
    removed_at   TIMESTAMPTZ,
    removed_by   TEXT,
    -- Denormalized tallies. Recomputed from votes inside the vote transaction
    -- rather than incremented, so the write is idempotent under OCC retry.
    upvotes      INTEGER NOT NULL DEFAULT 0,
    downvotes    INTEGER NOT NULL DEFAULT 0,
    score        INTEGER NOT NULL DEFAULT 0
);

-- Generic in (target_type, target_id) so one table serves post and comment
-- votes. Keying this to post_id would make comment voting a second parallel
-- system — the cheapest thing to get right early, the most expensive to
-- retrofit.
--
-- The composite primary key makes a double vote impossible at the storage layer,
-- which is what lets castVote() skip a read-modify-write.
CREATE TABLE IF NOT EXISTS votes (
    target_type TEXT NOT NULL,
    target_id   UUID NOT NULL,
    voter_id    TEXT NOT NULL,
    value       INTEGER NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ,
    PRIMARY KEY (target_type, target_id, voter_id)
);

CREATE INDEX ASYNC IF NOT EXISTS posts_subreddit_created_idx
    ON posts (subreddit_id, created_at);

CREATE INDEX ASYNC IF NOT EXISTS posts_score_idx
    ON posts (score);

CREATE INDEX ASYNC IF NOT EXISTS posts_created_at_idx
    ON posts (created_at);

CREATE INDEX ASYNC IF NOT EXISTS posts_author_idx
    ON posts (author_id);

CREATE INDEX ASYNC IF NOT EXISTS votes_target_idx
    ON votes (target_type, target_id);

CREATE INDEX ASYNC IF NOT EXISTS votes_voter_idx
    ON votes (voter_id);
