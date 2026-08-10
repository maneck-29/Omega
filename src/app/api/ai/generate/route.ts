/**
 * /api/ai/generate
 *
 *   POST turn a prompt into a draft hot take.
 *
 * Body: { prompt, tone? }
 *
 * Always returns 200 with a usable draft: if Bedrock is unreachable the
 * response carries `source: "fallback"` and a note, so the composer can show
 * the draft and be honest about where it came from rather than failing.
 */

import { NextResponse } from "next/server";
import { generateHotTake } from "@/lib/ai";
import { errorResponse, readJson, str } from "@/lib/http";
import { ValidationError } from "@/lib/posts";

export const dynamic = "force-dynamic";

/** Bedrock calls are slower than a DB read; give the route room. */
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = await readJson(request);

    const prompt = str(body.prompt);
    if (!prompt) throw new ValidationError("Describe what the take should be about");
    if (prompt.length > 300) {
      throw new ValidationError("Keep the prompt under 300 characters");
    }

    const result = await generateHotTake(prompt, str(body.tone) ?? undefined);
    return NextResponse.json(result);
  } catch (cause) {
    return errorResponse(cause);
  }
}
