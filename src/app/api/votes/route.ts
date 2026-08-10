/**
 * /api/votes
 *
 *   POST cast, flip or toggle off a vote on a post or a comment.
 *
 * Body: { targetId, value: 1 | -1, targetType?: "post" | "comment" }
 *
 * Responds with the recomputed tallies so the client can update in place
 * without refetching the feed.
 */

import { NextResponse } from "next/server";
import { ensureIdentity } from "@/lib/identity";
import { errorResponse, readJson, str } from "@/lib/http";
import { ValidationError } from "@/lib/posts";
import { castVote, VOTE_TARGET_TYPES, type VoteTargetType } from "@/lib/votes";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);

    const targetId = str(body.targetId);
    if (!targetId) throw new ValidationError("targetId is required");

    const rawValue = Number(body.value);
    if (rawValue !== 1 && rawValue !== -1) {
      throw new ValidationError("value must be 1 or -1");
    }

    const requestedType = str(body.targetType) ?? "post";
    if (!VOTE_TARGET_TYPES.includes(requestedType as VoteTargetType)) {
      throw new ValidationError("Unknown vote target");
    }

    const identity = await ensureIdentity();
    const result = await castVote(
      identity,
      requestedType as VoteTargetType,
      targetId,
      rawValue,
    );

    return NextResponse.json(result);
  } catch (cause) {
    return errorResponse(cause);
  }
}
