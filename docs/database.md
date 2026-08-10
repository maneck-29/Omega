# Database — Amazon Aurora DSQL

Aurora DSQL is a serverless, distributed, PostgreSQL-compatible database.
Access is through Drizzle over the `@aws/aurora-dsql-node-postgres-connector`
pool, which handles IAM auth-token generation and refresh.

## Layout

| File | Purpose |
| --- | --- |
| `src/lib/schema.ts` | Drizzle table definitions |
| `src/lib/dsql.ts` | pool, Drizzle client, `withTransaction()` |
| `src/lib/dsql-repository.ts` | `Repository` implementation |
| `src/lib/db.ts` | driver selection |
| `drizzle/0000_init.sql` | migration — authoritative DDL |

## Driver selection

`getRepository()` picks an implementation from the environment:

| Condition | Driver |
| --- | --- |
| `PGHOST` set | `dsql` |
| `PGHOST` unset | `memory` |
| `DB_DRIVER=dsql` | `dsql` — fails loudly if `PGHOST` is missing |
| `DB_DRIVER=memory` | `memory`, even with `PGHOST` set |

So `npm run dev` works with no AWS credentials, and forcing `dsql` without a
configured host raises `PGHOST is not set` rather than silently falling back to
in-memory data.

## Setup

```bash
export PGHOST=<cluster-id>.dsql.<region>.on.aws
export PGUSER=admin           # defaults to admin
export AWS_REGION=<region>
```

The connector mints IAM auth tokens from the ambient AWS credential chain — no
password. The role needs `dsql:DbConnectAdmin` (or `dsql:DbConnect` for a
non-admin database role).

Apply the migration:

```bash
psql --host "$PGHOST" --username admin --dbname postgres \
     --file drizzle/0000_init.sql
```

Indexes are built asynchronously; track them with `SELECT * FROM sys.jobs;`.

## Constraints that shaped the schema

DSQL is PostgreSQL-compatible but distributed, and several familiar features are
unavailable. Each of these is a deliberate design consequence, not an oversight:

**No foreign keys.** Referential integrity is enforced in the service layer —
`createComment()` verifies the parent comment belongs to the same post, and
subreddit existence is checked before writes. Columns that would be FKs
(`comments.post_id` → TM2's posts, `*.user_id` → TM1's users) are documented as
references but carry no constraint. This also suits the cross-workstream split,
since no table needs to exist before another team's code can write to it.

**No sequences or `SERIAL`.** Primary keys are application-generated UUIDs
(`crypto.randomUUID()`). Random keys also spread writes across the key range,
which reduces contention.

**`CREATE INDEX ASYNC`.** Plain `CREATE INDEX` is unsupported, which is why the
migration is hand-written rather than generated from the Drizzle schema. Treat
`drizzle/0000_init.sql` as authoritative and keep `schema.ts` in step with it.

**Optimistic concurrency, no row locks.** Isolation is fixed at Repeatable Read.
Conflicts surface at commit time as serialization errors, and the connector
retries the transaction. Two consequences:

- Transaction callbacks must be **idempotent**. No emails, queue messages, or
  third-party calls inside `withTransaction()` — the body may run several times.
- Counter updates are **relative** (`subscriber_count + 1`), never
  read-then-write, so a retry cannot double-count.

**Transaction limits.** At most 3,000 rows modified per transaction; DDL and DML
cannot share a transaction, and only one DDL statement per transaction.

## Known contention point

`subreddits.subscriber_count` is denormalized and updated in the same
transaction as the subscription row, which keeps the counter exact and avoids a
`COUNT(*)` per page render. The tradeoff is that a popular subreddit makes that
row an OCC hotspot: every subscribe and unsubscribe writes it, and concurrent
writes will retry.

Acceptable at current scale. If retries become visible, the options are a
sharded counter (N rows summed on read) or an asynchronous rollup, at the cost of
exactness.

## Threading query

`listCommentsByPost` fetches every comment for a post in one indexed query
(`comments_post_idx` on `(post_id, created_at)`) and the tree is assembled in
memory. One round-trip, and fine to roughly a thousand comments per post.

Recursive CTEs are supported if a deeper strategy is ever needed, but that is the
escalation path once the ceiling is measured — not before.

## Testing without a cluster

The in-memory repository implements the same interface and reproduces the
semantics that matter: case-insensitive name uniqueness, idempotent
subscriptions, counters that never go negative, soft deletes, and expiry-aware
bans. Behaviour verified against it holds for DSQL, with the caveat that OCC
retries and true concurrency only appear against a real cluster.
