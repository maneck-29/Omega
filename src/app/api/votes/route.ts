/**
 * /api/votes — owned by TM2 (Posts & Voting).
 *
 *   POST cast, flip or clear a vote on a post or a comment.
 *
 * Body: { targetId, value: 1 | -1, targetType?: "post" | "comment" }
 *
 * Responds with the recomputed score so the client can update in place without
 * refetching the feed or the thread.
 */

import { requireCurrentUser } from "@/lib/auth";
import { badRequest } from "@/lib/errors";
import { handler, readJson } from "@/lib/route-helpers";
import { castVote, parseTargetType, parseVoteValue } from "@/lib/votes";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handler(async () => {
    const body = await readJson(request);
    const voter = await requireCurrentUser();

    const targetId =
      typeof body.targetId === "string" ? body.targetId.trim() : "";
    if (!targetId) throw badRequest("targetId is required", "target_required");

    const score = await castVote({
      targetType: parseTargetType(
        typeof body.targetType === "string" ? body.targetType : null,
      ),
      targetId,
      voterId: voter.id,
      value: parseVoteValue(body.value),
    });

    return score;
  });
}
