/**
 * Aurora DSQL connection.
 *
 * The connector handles IAM token generation and refresh (DSQL uses short-lived
 * auth tokens rather than static passwords) and retries transactions that fail
 * on optimistic-concurrency conflicts.
 *
 * The pool is cached on `globalThis` so Next.js dev hot-reload does not leak a
 * new pool on every module re-evaluation. DSQL closes idle connections after an
 * hour, which the pool handles by reconnecting.
 */

import { AuroraDSQLPool } from "@aws/aurora-dsql-node-postgres-connector";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

/**
 * Drizzle bound to a single pooled connection, as used inside a transaction.
 * Distinct from `Database`, which is bound to the pool.
 */
export type TransactionDatabase = NodePgDatabase<typeof schema> & {
  $client: PoolClient;
};

function createPool(): AuroraDSQLPool {
  const host = process.env.PGHOST;
  if (!host) {
    throw new Error(
      "PGHOST is not set. Point it at the Aurora DSQL cluster endpoint.",
    );
  }

  return new AuroraDSQLPool({
    host,
    // The DSQL admin role is `admin`; non-admin roles map to database roles.
    user: process.env.PGUSER ?? "admin",
    database: process.env.PGDATABASE ?? "postgres",
    port: Number(process.env.PGPORT ?? 5432),
    // `DSQL_REGION` is the cluster's region, published by the Omega
    // integration. It must win over `AWS_REGION`, which the Lambda runtime sets
    // to the region the function runs in — the IAM auth token is signed per
    // region, so a cross-region deployment would sign for the wrong one.
    region:
      process.env.DSQL_REGION ??
      process.env.PGREGION ??
      process.env.AWS_REGION,
    ssl: { rejectUnauthorized: true },
  });
}

function createDb(pool: AuroraDSQLPool) {
  return drizzle({ client: pool, schema });
}

const globalForDb = globalThis as unknown as {
  __dsqlPool?: AuroraDSQLPool;
  __dsqlDb?: ReturnType<typeof createDb>;
};

export function getPool(): AuroraDSQLPool {
  return (globalForDb.__dsqlPool ??= createPool());
}

export function getDb(): Database {
  return (globalForDb.__dsqlDb ??= createDb(getPool()));
}

/**
 * Runs `fn` inside a DSQL transaction with automatic OCC retry.
 *
 * The callback may run more than once, so it MUST be idempotent — no external
 * side effects (emails, queue messages, third-party calls) inside it. Database
 * writes are safe because a retried transaction starts from a fresh snapshot.
 *
 * DSQL constraints that apply inside the callback:
 *   - at most 3,000 rows modified
 *   - DDL and DML cannot share a transaction
 *   - at most one DDL statement per transaction
 */
export async function withTransaction<T>(
  fn: (tx: TransactionDatabase) => Promise<T>,
): Promise<T> {
  return getPool().transaction(async (client: PoolClient) =>
    fn(drizzle({ client, schema })),
  );
}
