/**
 * Vote service — owned by TM2 (Posts & Voting).
 *
 * One engine for posts and comments. The target type is carried through to the
 * repository, which keys votes by (targetType, targetId); keying to post ids
 * would make comment voting a second parallel system.
 *
 * Existence is checked before writing so a vote cannot be recorded against an
 * id that does not exist, and so voting on removed or deleted content is
 * rejected rather than silently counted.
 */

import { getRepository } from "./db";
import { badRequest, forbidden, notFound } from "./errors";
import type { Score, UserId, VoteTargetType } from "./types";

export const VOTE_TARGET_TYPES: readonly VoteTargetType[] = ["post", "comment"];

export function parseTargetType(
  value: string | null | undefined,
): VoteTargetType {
  return VOTE_TARGET_TYPES.includes(value as VoteTargetType)
    ? (value as VoteTargetType)
    : "post";
}

/** Narrow an untrusted value to a vote direction. */
export function parseVoteValue(value: unknown): 1 | -1 {
  const numeric = Number(value);
  if (numeric !== 1 && numeric !== -1) {
    throw badRequest("A vote must be 1 or -1", "invalid_vote_value");
  }
  return numeric;
}

async function assertVotableTarget(
  targetType: VoteTargetType,
  targetId: string,
): Promise<void> {
  const repo = getRepository();

  if (targetType === "post") {
    const post = await repo.getPostById(targetId);
    if (!post || post.deletedAt) {
      throw notFound("Post not found", "post_not_found");
    }
    if (post.removedAt) {
      throw forbidden("This post was removed by a moderator", "post_removed");
    }
    return;
  }

  const comment = await repo.getCommentById(targetId);
  if (!comment || comment.deletedAt) {
    throw notFound("Comment not found", "comment_not_found");
  }
  if (comment.removedAt) {
    throw forbidden("This comment was removed by a moderator", "comment_removed");
  }
}

/**
 * Cast, flip, or clear a vote.
 *
 * Re-casting the same direction clears it, the opposite direction flips it. The
 * repository settles the row and recomputes the target's tallies atomically, and
 * returns the resulting score so no follow-up read is needed.
 */
export async function castVote(args: {
  targetType: VoteTargetType;
  targetId: string;
  voterId: UserId;
  value: 1 | -1;
}): Promise<Score> {
  await assertVotableTarget(args.targetType, args.targetId);

  return getRepository().castVote(
    args.targetType,
    args.targetId,
    args.voterId,
    args.value,
  );
}
