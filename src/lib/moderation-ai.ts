/**
 * AI-assisted comment triage, backed by the Omega Bedrock integration.
 *
 * Scoped deliberately narrowly: this ranks a subreddit's recent comments against
 * its own rules so a moderator sees the likely problems first. It **never**
 * removes anything. Removal stays a human action through the existing
 * moderation endpoint, because an automated remove on a false positive is a
 * silent censorship bug and there is no signal that it happened.
 *
 * Omega injects `BEDROCK_REGION`; the model id lives in code.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { Comment, SubredditRule } from "./types";

/**
 * Haiku: triage is a short, high-volume classification over many comments, so
 * latency and cost matter more than deep reasoning.
 */
const MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0";

/** Bounded so one request cannot fan out into an unbounded bill. */
const MAX_COMMENTS = 25;

/** Truncated per comment; a rule breach is evident well before this. */
const MAX_BODY_CHARS = 600;

export type TriageVerdict = {
  commentId: string;
  /** 0 = clearly fine, 1 = almost certainly breaks a rule. */
  concern: number;
  /** 1-based index into the subreddit's rules, or null for a general concern. */
  ruleIndex: number | null;
  reason: string;
};

export function isModerationAiConfigured(): boolean {
  return Boolean(process.env.BEDROCK_REGION);
}

let client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!process.env.BEDROCK_REGION) {
    throw new Error(
      "BEDROCK_REGION is not set. Connect the Omega Bedrock integration.",
    );
  }
  client ??= new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION });
  return client;
}

const SYSTEM_PROMPT = `You review comments for a discussion forum and help human moderators prioritise their queue.

You will be given a community's rules and a list of comments, each with an id.

For every comment, judge how likely it is to breach one of the listed rules.

Rules for your output:
- Return ONLY a JSON array, no prose and no markdown fences.
- Each element: {"commentId": string, "concern": number, "ruleIndex": number|null, "reason": string}
- "concern" is between 0 and 1. Use values below 0.3 for comments that are fine.
- "ruleIndex" is the 1-based index of the rule most likely breached, or null if the concern is general rather than rule-specific.
- "reason" is at most 15 words, factual, and quotes or paraphrases the specific problem.
- Include every comment id exactly once.
- Disagreement, strong opinions, and criticism are NOT rule breaches. Only flag content that plausibly breaches a stated rule.`;

/** Strips markdown fences the model may add despite instructions. */
function parseVerdicts(text: string): TriageVerdict[] {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Model did not return valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Model did not return a JSON array");
  }

  return parsed.flatMap((entry): TriageVerdict[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.commentId !== "string") return [];

    const concern = Number(row.concern);

    return [
      {
        commentId: row.commentId,
        // Clamp: the model occasionally returns percentages or out-of-range values.
        concern: Number.isFinite(concern) ? Math.min(Math.max(concern, 0), 1) : 0,
        ruleIndex:
          typeof row.ruleIndex === "number" && row.ruleIndex > 0
            ? row.ruleIndex
            : null,
        reason: typeof row.reason === "string" ? row.reason.slice(0, 200) : "",
      },
    ];
  });
}

/**
 * Ranks comments by likely rule breach, most concerning first.
 *
 * Advisory only. Callers must treat the result as a suggested ordering, not a
 * decision, and the verdicts are filtered to ids that were actually submitted so
 * a hallucinated id cannot reach the UI.
 */
export async function triageComments(
  comments: Comment[],
  rules: SubredditRule[],
): Promise<TriageVerdict[]> {
  // Tombstones carry no reviewable text.
  const reviewable = comments
    .filter((comment) => !comment.deletedAt && !comment.removedAt)
    .slice(0, MAX_COMMENTS);

  if (reviewable.length === 0) return [];

  const ruleList =
    rules.length > 0
      ? rules
          .map((rule, index) => `${index + 1}. ${rule.title} — ${rule.description}`)
          .join("\n")
      : "(No specific rules configured; judge against general civility.)";

  const commentList = reviewable
    .map(
      (comment) =>
        `id: ${comment.id}\n${comment.body.slice(0, MAX_BODY_CHARS)}`,
    )
    .join("\n---\n");

  const response = await getClient().send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: SYSTEM_PROMPT }],
      messages: [
        {
          role: "user",
          content: [
            { text: `Community rules:\n${ruleList}\n\nComments:\n${commentList}` },
          ],
        },
      ],
      // Low temperature: this is a classification, not a creative task.
      inferenceConfig: { temperature: 0.1, maxTokens: 2000 },
    }),
  );

  const text = response.output?.message?.content?.[0]?.text;
  if (!text) throw new Error("Model returned an empty response");

  const submitted = new Set(reviewable.map((comment) => comment.id));

  return parseVerdicts(text)
    .filter((verdict) => submitted.has(verdict.commentId))
    .sort((a, b) => b.concern - a.concern);
}
