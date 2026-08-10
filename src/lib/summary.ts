/**
 * TL;DR summaries for comment threads.
 *
 * A long thread is the one place on the site where reading everything is
 * expensive, so this condenses it into a few bullets plus the shape of the
 * disagreement. Read-only and advisory: it never edits, hides or reorders a
 * comment, and the thread below it is unchanged.
 *
 * Three properties are deliberate:
 *
 *   * **Only real, visible text is sent.** Tombstoned comments are excluded
 *     before the prompt is built, so deleted and moderator-removed bodies are
 *     never sent to a model — the same rule that redacts them for clients.
 *   * **It degrades to an extractive summary.** With no Bedrock access the top
 *     comments are excerpted locally, so the feature still does something
 *     useful and reports `source: "fallback"` rather than erroring.
 *   * **It is cached per thread revision.** The key includes the comment count
 *     and newest timestamp, so a new reply invalidates it but a re-render does
 *     not pay for another model call.
 */

import { converse, stripFences, type AiSource } from "./bedrock";
import { getRepository } from "./db";
import { getScoreProvider } from "./scores";
import type { Comment, Score } from "./types";

/**
 * Below this a reader can just read the thread, and a summary of three comments
 * is longer than the comments. Exported so the UI can hide the control rather
 * than offer one that refuses.
 */
export const MIN_COMMENTS_FOR_SUMMARY = 4;

/** Bounded so one request cannot fan out into an unbounded bill. */
const MAX_COMMENTS = 40;

/** Truncated per comment; the gist of an argument survives this. */
const MAX_BODY_CHARS = 700;

const MAX_BULLETS = 4;

export type ThreadSummary = {
  /** Two or three sentences: what the thread is actually about. */
  tldr: string;
  /** The distinct positions people took. */
  bullets: string[];
  /** How contested it is, for a one-glance read. */
  tone: "agreement" | "mixed" | "heated";
  source: AiSource;
  /** How many comments the summary was built from. */
  basedOn: number;
  /** Present when the fallback ran, explaining why. */
  note?: string;
};

const SYSTEM_PROMPT = `You summarise discussion threads for readers deciding whether to read the whole thing.

You will be given a post title and a numbered list of comments, most-upvoted first.

Return ONLY a JSON object, no prose and no markdown fences:
{"tldr": string, "bullets": string[], "tone": "agreement" | "mixed" | "heated"}

Rules:
- "tldr" is 2 to 3 sentences describing what the thread is about and where it landed.
- "bullets" is 2 to ${MAX_BULLETS} short strings, each a distinct position someone took. Under 20 words each. No leading dashes or numbering.
- "tone" is "agreement" if commenters broadly agree, "heated" if there is real conflict, otherwise "mixed".
- Summarise what people said. Do not add your own opinion, do not judge who is right, and do not invent points nobody made.
- Never name or quote a specific commenter. Describe positions, not people.`;

type Parsed = Pick<ThreadSummary, "tldr" | "bullets" | "tone">;

function parseSummary(text: string): Parsed | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const row = parsed as Record<string, unknown>;
  const tldr = typeof row.tldr === "string" ? row.tldr.trim() : "";
  if (tldr === "") return null;

  const bullets = Array.isArray(row.bullets)
    ? row.bullets
        .filter((bullet): bullet is string => typeof bullet === "string")
        // Models sometimes bullet the bullets despite being told not to.
        .map((bullet) => bullet.replace(/^\s*[-*\d.)\s]+/, "").trim())
        .filter((bullet) => bullet.length > 0)
        .slice(0, MAX_BULLETS)
    : [];

  const tone =
    row.tone === "agreement" || row.tone === "heated" ? row.tone : "mixed";

  return { tldr: tldr.slice(0, 600), bullets, tone };
}

/**
 * Local extractive summary: excerpt the most-upvoted comments.
 *
 * Not a real summary, and it does not pretend to be — the UI labels fallback
 * output. It is still the most useful thing available without a model, because
 * the top comments are usually where the substance is.
 */
function fallbackSummary(
  ranked: Comment[],
  scores: Map<string, Score>,
): Parsed {
  const excerpt = (comment: Comment) => {
    const flat = comment.body.replace(/\s+/g, " ").trim();
    return flat.length > 140 ? `${flat.slice(0, 137)}…` : flat;
  };

  // Contested when a meaningful share of the votes cast were downvotes.
  const totals = ranked.reduce(
    (acc, comment) => {
      const score = scores.get(comment.id);
      return {
        up: acc.up + (score?.upvotes ?? 0),
        down: acc.down + (score?.downvotes ?? 0),
      };
    },
    { up: 0, down: 0 },
  );
  const cast = totals.up + totals.down;
  const contested = cast > 0 ? totals.down / cast : 0;

  return {
    tldr: `${ranked.length} comments, summarised by excerpting the most-upvoted replies.`,
    bullets: ranked.slice(0, MAX_BULLETS).map(excerpt),
    tone: contested > 0.4 ? "heated" : contested > 0.2 ? "mixed" : "agreement",
  };
}

/**
 * Cache key for a thread's current state.
 *
 * Comment count plus the newest timestamp: a new reply or an edit changes one of
 * them, and nothing else needs to. Bodies are not hashed because an edit bumps
 * `editedAt`, which is part of the newest-timestamp calculation.
 */
function revisionKey(postId: string, comments: Comment[]): string {
  const newest = comments.reduce((latest, comment) => {
    const stamp = comment.editedAt ?? comment.createdAt;
    return stamp > latest ? stamp : latest;
  }, "");
  return `${postId}:${comments.length}:${newest}`;
}

/**
 * Cached per thread revision, and only for Bedrock results.
 *
 * A fallback is cheap to recompute and must not be held: once Bedrock is
 * reachable again the next request should upgrade rather than serve an
 * extractive summary for the life of the process.
 */
const cache = new Map<string, ThreadSummary>();

/** Keeps a long-lived server from accumulating summaries for every thread. */
const MAX_CACHE_ENTRIES = 200;

/**
 * Summarises a post's comment thread.
 *
 * `postTitle` gives the model the subject, which materially improves the result:
 * without it, a thread of replies has no stated topic.
 *
 * Takes no viewer: a summary is the same for everyone who can see the thread,
 * which is what makes it cacheable. Anything viewer-specific would have to key
 * the cache per reader and would multiply the model calls by the audience.
 */
export async function summarizeThread(
  postId: string,
  postTitle: string,
): Promise<ThreadSummary> {
  const repo = getRepository();
  const all = await repo.listCommentsByPost(postId);

  // Tombstones carry no summarisable text, and their bodies must not be sent.
  const visible = all.filter(
    (comment) => !comment.deletedAt && !comment.removedAt,
  );

  if (visible.length < MIN_COMMENTS_FOR_SUMMARY) {
    return {
      tldr: "",
      bullets: [],
      tone: "agreement",
      source: "fallback",
      basedOn: visible.length,
      note: `A summary needs at least ${MIN_COMMENTS_FOR_SUMMARY} comments.`,
    };
  }

  const key = revisionKey(postId, visible);
  const cached = cache.get(key);
  if (cached) return cached;

  /*
   * Scores decide which comments are worth summarising when a thread exceeds the
   * cap. The viewer is deliberately not passed: `viewerVote` would vary the
   * ranking per reader and make the cache key wrong.
   */
  const scores = await getScoreProvider().getScores(
    "comment",
    visible.map((comment) => comment.id),
    null,
  );

  const ranked = [...visible]
    .sort(
      (a, b) =>
        (scores.get(b.id)?.score ?? 0) - (scores.get(a.id)?.score ?? 0) ||
        a.createdAt.localeCompare(b.createdAt),
    )
    .slice(0, MAX_COMMENTS);

  const commentList = ranked
    .map((comment, index) => {
      const score = scores.get(comment.id)?.score ?? 0;
      const body = comment.body.replace(/\s+/g, " ").trim();
      return `${index + 1}. (${score >= 0 ? "+" : ""}${score}) ${body.slice(0, MAX_BODY_CHARS)}`;
    })
    .join("\n");

  const result = await converse({
    system: SYSTEM_PROMPT,
    user: `Post title: ${postTitle}\n\nComments:\n${commentList}`,
    // Low temperature: a summary should be faithful, not inventive.
    temperature: 0.2,
    maxTokens: 700,
  });

  const parsed = result ? parseSummary(result.text) : null;

  if (!parsed) {
    return {
      ...fallbackSummary(ranked, scores),
      source: "fallback",
      basedOn: ranked.length,
      note: result
        ? "The model's reply could not be read, so the top comments were excerpted instead."
        : "Bedrock was unreachable, so the top comments were excerpted instead.",
    };
  }

  const summary: ThreadSummary = {
    ...parsed,
    source: "bedrock",
    basedOn: ranked.length,
  };

  // Evict oldest-first; insertion order is enough for a cache this size.
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, summary);

  return summary;
}
