/**
 * Database access layer.
 *
 * Two backends, one SQL dialect:
 *
 *  - Omega (Aurora DSQL): the `postgres` driver reads the libpq environment
 *    variables (PGHOST, PGUSER, PGDATABASE, PGPORT, PGSSLMODE) that the DSQL
 *    integration injects at build and runtime. Selected whenever PGHOST is set.
 *  - Local development: PGlite (PostgreSQL compiled to WASM) persisted to a
 *    directory so data survives a dev-server restart. No Docker, no cluster.
 *
 * Every caller goes through `query()` with $1-style placeholders, so the same
 * SQL runs on both backends. The SQL is deliberately kept DSQL-compatible:
 *
 *  - no FOREIGN KEY constraints (DSQL does not support them)
 *  - no array columns (use jsonb)
 *  - application-generated uuid text primary keys rather than sequences
 *  - DDL statements issued one per transaction
 *
 * See references/integration-dsql.md in the Omega skill for the full list.
 */

export type Row = Record<string, unknown>;

type Dialect = "dsql" | "pglite";

interface Backend {
  dialect: Dialect;
  query<T>(text: string, params: unknown[]): Promise<T[]>;
}

/** Local PGlite data directory. Gitignored; safe to delete to reset dev data. */
const PGLITE_DIR = process.env.PGLITE_DIR ?? ".pglite";

async function createBackend(): Promise<Backend> {
  if (process.env.PGHOST) {
    // Aurora DSQL via Omega. The driver picks up the libpq variables itself;
    // DSQL uses IAM token auth, so there is no connection string to build.
    const { default: postgres } = await import("postgres");
    const sql = postgres();

    return {
      dialect: "dsql",
      async query<T>(text: string, params: unknown[]): Promise<T[]> {
        // `unsafe` refers only to the SQL text being a plain string; the
        // parameters are still bound server-side, so this is injection-safe.
        const rows = await sql.unsafe(text, params as never[]);
        return rows as unknown as T[];
      },
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const db = await PGlite.create(PGLITE_DIR);

  return {
    dialect: "pglite",
    async query<T>(text: string, params: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
}

// Module-level singletons. Next.js may evaluate this module more than once in
// development; the promises make concurrent callers share one connection and
// one schema bootstrap.
let backendPromise: Promise<Backend> | null = null;
let schemaPromise: Promise<void> | null = null;

async function getBackend(): Promise<Backend> {
  backendPromise ??= createBackend();
  return backendPromise;
}

/**
 * Table definitions. Applied with CREATE TABLE IF NOT EXISTS so the bootstrap
 * is idempotent and safe to run on every cold start.
 *
 * `posts` doubles as the comments table: a row with a non-null parent_id is a
 * reply. That keeps voting, sorting and soft-delete uniform across both, and
 * means the comments slice can reuse this table instead of duplicating it.
 */
const TABLES = [
  `create table if not exists posts (
     id                text primary key,
     body              text not null,
     post_type         text not null default 'text',
     url               text,
     image_url         text,
     user_id           text,
     anon_owner_token  text,
     author_name       text,
     parent_id         text,
     up_count          integer not null default 0,
     down_count        integer not null default 0,
     score             integer not null default 0,
     created_at        timestamptz not null default current_timestamp,
     edited_at         timestamptz,
     deleted_at        timestamptz
   )`,

  // Polymorphic so the same engine serves posts and comments. The unique
  // constraint enforces one vote per voter per target; DSQL supports inline
  // UNIQUE (its own documented migration example uses it).
  `create table if not exists votes (
     id           text primary key,
     target_type  text not null,
     target_id    text not null,
     voter_key    text not null,
     value        smallint not null,
     created_at   timestamptz not null default current_timestamp,
     updated_at   timestamptz,
     unique (target_type, target_id, voter_key)
   )`,
];

/**
 * Indexes are an optimisation, not a correctness requirement, and the syntax
 * differs between backends: DSQL requires CREATE INDEX ASYNC and rejects plain
 * CREATE INDEX. Failures are logged and swallowed so a syntax difference can
 * never stop the app from starting.
 */
function indexStatements(dialect: Dialect): string[] {
  const async = dialect === "dsql" ? "async" : "";
  return [
    `create index ${async} if not exists posts_created_at_idx on posts (created_at desc)`,
    `create index ${async} if not exists posts_score_idx on posts (score desc)`,
    `create index ${async} if not exists posts_parent_id_idx on posts (parent_id)`,
    `create index ${async} if not exists votes_target_idx on votes (target_type, target_id)`,
    `create index ${async} if not exists votes_voter_idx on votes (voter_key)`,
  ];
}

async function ensureSchema(backend: Backend): Promise<void> {
  // One DDL statement per call: DSQL requires DDL to run in its own
  // transaction and rejects multiple DDL statements batched together.
  for (const statement of TABLES) {
    await backend.query(statement, []);
  }

  for (const statement of indexStatements(backend.dialect)) {
    try {
      await backend.query(statement, []);
    } catch (cause) {
      console.warn(
        `[db] skipped index: ${cause instanceof Error ? cause.message : cause}`,
      );
    }
  }
}

/**
 * Run a parameterised query. Placeholders are $1, $2, ... on both backends.
 * The schema is bootstrapped once, lazily, before the first query runs.
 */
export async function query<T = Row>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const backend = await getBackend();
  schemaPromise ??= ensureSchema(backend);
  await schemaPromise;
  return backend.query<T>(text, params);
}

/** Which backend is active. Useful for diagnostics and the health endpoint. */
export async function dialect(): Promise<Dialect> {
  return (await getBackend()).dialect;
}
