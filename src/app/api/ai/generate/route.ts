/**
 * /api/ai/generate — owned by TM2 (Posts & Voting).
 *
 *   POST draft a hot take from a prompt.
 *
 * Body: { prompt, tone? }
 *
 * Always returns a usable draft. If Bedrock is unreachable the response carries
 * `source: "fallback"` and a note, so the composer can show the draft and be
 * honest about where it came from rather than failing.
 */

import { generateHotTake } from "@/lib/ai";
import { badRequest } from "@/lib/errors";
import { handler, readJson } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

/** Bedrock is slower than a database read; give the route room. */
export const maxDuration = 30;

export function POST(request: Request) {
  return handler(async () => {
    const body = await readJson(request);

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      throw badRequest(
        "Describe what the take should be about",
        "prompt_required",
      );
    }
    if (prompt.length > 300) {
      throw badRequest("Keep the prompt under 300 characters", "prompt_too_long");
    }

    return generateHotTake(
      prompt,
      typeof body.tone === "string" ? body.tone : undefined,
    );
  });
}
