/**
 * Voting engine.
 *
 * Polymorphic by design: a vote row carries `target_type` ('post' | 'comment')
 * alongside `target_id`, so the same engine serves both without a second table.
 * Replies are stored as rows in `posts` with a non-null `parent_id`, so comment
 * votes resolve against the same table today; if the comments slice introduces
 * its own table later, only `targetExists` needs to learn about it.
 *
 * One vote per voter per target, enforced by a unique constraint on
 * (target_type, target_id, voter_key). Re-casting the same direction removes
 * the vote (a toggle), and casting the opposite direction flips it.
 *
 * Counters on the target row are never incremented in place. They are recomputed
 * from the votes table in a single UPDATE ... FROM statement, which is atomic
 * and therefore cannot drift under concurrent voting the way read-modify-write
 * counters do.
 */

import { query } from "./db";
import type { Identity } from "./identity";
import { NotFoundError, ValidationError } from "./posts";

export type VoteTargetType = "post" | "comment";
export type VoteValue = 1 | -1;

export const VOTE_TARGET_TYPES: readonly VoteTargetType[] = ["post", "comment"];

export interface VoteResult {
  /** How the visitor now votes: 1, -1, or 0 if the vote was toggled off. */
  viewerVote: number;
  upCount: number;
  downCount: number;
  score: number;
}

async function targetExists(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `select id from posts where id = $1 and deleted_at is null`,
    [id],
  );
  return rows.length > 0;
}

/**
 * Recompute the target's tallies from the votes table.
 *
 * `sum(case ...)` rather than `count(*) filter (...)` for the widest engine
 * compatibility — DSQL is PostgreSQL-compatible but not identical.
 */
async function recount(
  targetType: VoteTargetType,
  targetId: string,
): Promise<Omit<VoteResult, "viewerVote">> {
  const rows = await query<{
    up_count: number | string;
    down_count: number | string;
    score: number | string;
  }>(
    `update posts set
       up_count = c.up,
       down_count = c.down,
       score = c.up - c.down
     from (
       select
         coalesce(sum(case when value = 1 then 1 else 0 end), 0)::int as up,
         coalesce(sum(case when value = -1 then 1 else 0 end), 0)::int as down
       from votes
       where target_type = $1 and target_id = $2
     ) c
     where posts.id = $2
     returning posts.up_count, posts.down_count, posts.score`,
    [targetType, targetId],
  );

  const row = rows[0];
  if (!row) {
    throw new NotFoundError("That post no longer exists");
  }

  return {
    upCount: Number(row.up_count),
    downCount: Number(row.down_count),
    score: Number(row.score),
  };
}

/**
 * Cast, flip, or toggle off a vote.
 *
 * Returns the resulting tallies so the caller can update the UI without a
 * refetch.
 */
export async function castVote(
  identity: Identity,
  targetType: VoteTargetType,
  targetId: string,
  value: VoteValue,
): Promise<VoteResult> {
  if (!VOTE_TARGET_TYPES.includes(targetType)) {
    throw new ValidationError("Unknown vote target");
  }
  if (value !== 1 && value !== -1) {
    throw new ValidationError("A vote must be +1 or -1");
  }
  if (!identity.voterKey) {
    throw new ValidationError("Missing identity; refresh and try again");
  }

  if (!(await targetExists(targetId))) {
    throw new NotFoundError("That post no longer exists");
  }

  const existing = await query<{ id: string; value: number | string }>(
    `select id, value from votes
      where target_type = $1 and target_id = $2 and voter_key = $3`,
    [targetType, targetId, identity.voterKey],
  );

  const current = existing[0];
  let viewerVote: number;

  if (!current) {
    await query(
      `insert into votes (id, target_type, target_id, voter_key, value)
       values ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), targetType, targetId, identity.voterKey, value],
    );
    viewerVote = value;
  } else if (Number(current.value) === value) {
    // Same direction again: treat as undo.
    await query(`delete from votes where id = $1`, [current.id]);
    viewerVote = 0;
  } else {
    await query(
      `update votes set value = $1, updated_at = current_timestamp where id = $2`,
      [value, current.id],
    );
    viewerVote = value;
  }

  const tallies = await recount(targetType, targetId);
  return { viewerVote, ...tallies };
}

/**
 * The visitor's votes for a set of targets, as a map of target id to value.
 * Lets a caller hydrate vote state for a page of rows in one query.
 */
export async function getViewerVotes(
  identity: Identity,
  targetType: VoteTargetType,
  targetIds: string[],
): Promise<Record<string, number>> {
  if (!identity.voterKey || targetIds.length === 0) return {};

  // DSQL has no array columns, but = ANY($n) on a parameter is a query-level
  // construct and works regardless.
  const rows = await query<{ target_id: string; value: number | string }>(
    `select target_id, value from votes
      where target_type = $1 and voter_key = $2 and target_id = any($3)`,
    [targetType, identity.voterKey, targetIds],
  );

  return Object.fromEntries(
    rows.map((row) => [row.target_id, Number(row.value)]),
  );
}
