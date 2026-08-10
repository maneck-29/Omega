/**
 * Stub `ScoreProvider` — owned by TM2 (Posts & Voting).
 *
 * Returns zeroed scores so comment threads render before voting exists.
 * Score-dependent sorts (best/top/controversial) degrade to chronological until
 * the real provider lands; see `sortComments` in `comments.ts`.
 *
 * TM2: replace the body of `getScoreProvider()` with the real implementation.
 * The contract requirement is that votes are keyed by (targetType, targetId) so
 * one table and one UI serve both posts and comments.
 */

import type { Score, ScoreProvider, VoteTargetType } from "./types";

export const stubScoreProvider: ScoreProvider = {
  // viewerId is part of the contract (TM2 needs it for `viewerVote`) but the
  // stub has no votes to look up.
  async getScores(
    targetType: VoteTargetType,
    targetIds: string[],
  ): Promise<Map<string, Score>> {
    return new Map(
      targetIds.map((targetId) => [
        targetId,
        {
          targetType,
          targetId,
          score: 0,
          upvotes: 0,
          downvotes: 0,
          viewerVote: 0 as const,
        },
      ]),
    );
  },
};

/** True while the stub is active, so the UI can hide vote controls. */
export const VOTING_AVAILABLE = false;

export function getScoreProvider(): ScoreProvider {
  return stubScoreProvider;
}
