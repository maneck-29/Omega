/**
 * `ScoreProvider` — owned by TM2 (Posts & Voting).
 *
 * Replaces the zero-filled stub TM3 shipped so comment threads could render
 * before voting existed. Scores now come from the `votes` table via the
 * repository, so `best`, `top` and `controversial` comment sorts work rather
 * than degrading to chronological.
 *
 * Votes are keyed by (targetType, targetId), which is what lets one table and
 * one control serve both posts and comments — see `docs/integration-contract.md`.
 */

import { getRepository } from "./db";
import type { Score, ScoreProvider, UserId, VoteTargetType } from "./types";

export const votesScoreProvider: ScoreProvider = {
  async getScores(
    targetType: VoteTargetType,
    targetIds: string[],
    viewerId: UserId | null,
  ): Promise<Map<string, Score>> {
    if (targetIds.length === 0) return new Map();
    return getRepository().getScores(targetType, targetIds, viewerId);
  },
};

/**
 * Voting is live. TM3's comment thread reads this to decide whether to render
 * vote controls and whether score-dependent sorts are meaningful.
 */
export const VOTING_AVAILABLE = true;

export function getScoreProvider(): ScoreProvider {
  return votesScoreProvider;
}
