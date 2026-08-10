/**
 * Single swap point for storage.
 *
 * The team chose Amazon Aurora DSQL (Postgres-compatible, accessed through
 * Drizzle). Both implementations satisfy the same `Repository` interface, so the
 * choice is this one function.
 *
 * Selection is driven by `PGHOST`: when a cluster endpoint is configured, the
 * DSQL repository is used; otherwise the in-memory store backs local
 * development. That keeps `npm run dev` working with no AWS credentials while
 * the cluster is being provisioned.
 *
 * Set `DB_DRIVER=memory` to force the in-memory store even with PGHOST set, or
 * `DB_DRIVER=dsql` to fail fast rather than silently falling back.
 */

import { dsqlRepository } from "./dsql-repository";
import { memoryRepository } from "./memory-repository";
import type { Repository } from "./repository";

export type DbDriver = "dsql" | "memory";

export function getDriver(): DbDriver {
  const explicit = process.env.DB_DRIVER;
  if (explicit === "dsql" || explicit === "memory") return explicit;
  return process.env.PGHOST ? "dsql" : "memory";
}

export function getRepository(): Repository {
  if (getDriver() === "memory") return memoryRepository;
  return dsqlRepository;
}
