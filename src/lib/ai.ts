/**
 * AI features — owned by TM2. Backed by Amazon Bedrock.
 *
 *  1. `generateHotTake` turns a prompt into a draft post title.
 *  2. `listForYouViews` ranks posts by interests inferred from what the viewer
 *     upvoted.
 *
 * Both degrade gracefully. Bedrock needs model access granted in the account and
 * a region that serves the model; when a call fails for any reason the feature
 * falls back to a local implementation and reports `source: "fallback"` so the
 * UI can say so rather than failing. That also keeps the app working with no
 * Bedrock integration wired at all.
 *
 * The Bedrock integration injects only BEDROCK_REGION — the model is named here.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { getRepository } from "./db";
import { listPostViews, toPostViews, type ListPostsResult } from "./posts";
import type { PostView, SubredditId, UserId } from "./types";

export type AiSource = "bedrock" | "fallback";

const REGION =
  process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-east-2";

/**
 * Candidate models, cheapest tier first — these tasks produce a sentence or two,
 * so a small model is the right fit. Availability varies by account and region,
 * so an explicit BEDROCK_MODEL_ID wins and the rest are fallbacks.
 */
const MODEL_CANDIDATES = [
  process.env.BEDROCK_MODEL_ID,
  "us.amazon.nova-micro-v1:0",
  "amazon.nova-micro-v1:0",
  "us.amazon.nova-lite-v1:0",
  "amazon.nova-lite-v1:0",
  "us.anthropic.claude-3-5-haiku-20241022-v1:0",
  "anthropic.claude-3-5-haiku-20241022-v1:0",
].filter((id): id is string => Boolean(id));

let client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  client ??= new BedrockRuntimeClient({ region: REGION });
  return client;
}

/**
 * Why a model was skipped, and for how long.
 *
 * The distinction matters: a model the account genuinely cannot call should not
 * be retried on every request, but a failure caused by expired credentials or
 * throttling says nothing about the model. Blacklisting on those would disable
 * AI for the life of the process — a credential refresh would never be picked
 * up, and the feature would silently stay in fallback for no reason.
 */
const COOLDOWN_MS = {
  /** Model is not enabled or does not exist here: unlikely to change soon. */
  unavailable: 30 * 60 * 1000,
  /** Throttled: back off briefly, then try again. */
  throttled: 30 * 1000,
} as const;

/** modelId -> timestamp after which it may be retried. */
const cooldowns = new Map<string, number>();

/**
 * Errors that are about the caller or the connection, never about the model.
 * These must not put a model on cooldown at all.
 */
function isTransientAuthOrNetworkError(name: string, message: string): boolean {
  const signals = [
    "expiredtoken",
    "expired",
    "credential",
    "unrecognizedclient",
    "invalidsignature",
    "notauthorized",
    "timeout",
    "networkingerror",
    "econnreset",
    "enotfound",
    "socket",
  ];
  const haystack = `${name} ${message}`.toLowerCase();
  return signals.some((signal) => haystack.includes(signal));
}

function isThrottlingError(name: string, message: string): boolean {
  const haystack = `${name} ${message}`.toLowerCase();
  return (
    haystack.includes("throttl") ||
    haystack.includes("too many requests") ||
    haystack.includes("serviceunavailable") ||
    haystack.includes("modelnotready")
  );
}

function noteFailure(modelId: string, cause: unknown): void {
  const name = cause instanceof Error ? cause.name : "";
  const message = cause instanceof Error ? cause.message : String(cause);

  if (isTransientAuthOrNetworkError(name, message)) {
    // Deliberately no cooldown: refreshed credentials must take effect at once.
    console.warn(`[ai] ${modelId} failed for a transient reason: ${message}`);
    return;
  }

  const cooldown = isThrottlingError(name, message)
    ? COOLDOWN_MS.throttled
    : COOLDOWN_MS.unavailable;

  cooldowns.set(modelId, Date.now() + cooldown);
  console.warn(
    `[ai] ${modelId} unavailable, retrying in ${Math.round(cooldown / 1000)}s: ${message}`,
  );
}

function isOnCooldown(modelId: string): boolean {
  const until = cooldowns.get(modelId);
  if (until === undefined) return false;
  if (until > Date.now()) return true;

  cooldowns.delete(modelId);
  return false;
}

/** Diagnostics for the health endpoint: which models are currently skipped. */
export function bedrockStatus(): {
  region: string;
  candidates: string[];
  cooledDown: Array<{ modelId: string; retryInSeconds: number }>;
} {
  const now = Date.now();
  return {
    region: REGION,
    candidates: MODEL_CANDIDATES,
    cooledDown: [...cooldowns.entries()]
      .filter(([, until]) => until > now)
      .map(([modelId, until]) => ({
        modelId,
        retryInSeconds: Math.max(0, Math.round((until - now) / 1000)),
      })),
  };
}

async function converse(options: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ text: string; model: string } | null> {
  const candidates = MODEL_CANDIDATES.filter((id) => !isOnCooldown(id));

  // Every candidate is cooling down: try the whole list anyway rather than
  // returning a fallback without attempting a single call.
  const attempts = candidates.length > 0 ? candidates : MODEL_CANDIDATES;

  for (const modelId of attempts) {
    try {
      const response = await getClient().send(
        new ConverseCommand({
          modelId,
          system: [{ text: options.system }],
          messages: [{ role: "user", content: [{ text: options.user }] }],
          inferenceConfig: {
            maxTokens: options.maxTokens ?? 300,
            temperature: options.temperature ?? 0.9,
          },
        }),
      );

      const text = response.output?.message?.content
        ?.map((block) => block.text ?? "")
        .join("")
        .trim();

      if (text) {
        // A success clears any prior cooldown for this model.
        cooldowns.delete(modelId);
        return { text, model: modelId };
      }
    } catch (cause) {
      noteFailure(modelId, cause);
    }
  }

  return null;
}

// --- 1. Hot take generation ------------------------------------------------

const GENERATE_SYSTEM = [
  "You write short, punchy, opinionated social media post titles called hot takes.",
  "Rules:",
  "- One or two sentences, under 240 characters.",
  "- Confident and a little provocative, but never hateful, discriminatory,",
  "  sexual, violent, or targeted at a real named person.",
  "- Keep it about ideas, habits, technology, food, work culture and similar",
  "  everyday debates.",
  "- Output only the post text. No quotes, no preamble, no hashtags.",
].join("\n");

function fallbackTake(prompt: string): string {
  const topic = prompt.trim().replace(/[.!?]+$/, "") || "this whole debate";
  const templates = [
    `${topic} is wildly overrated and everyone is too polite to say it.`,
    `Unpopular opinion: ${topic} only works because nobody has tried the obvious alternative.`,
    `${topic} is not a preference, it is a personality crutch.`,
    `Hot take: the discourse around ${topic} is more interesting than ${topic} itself.`,
    `We collectively agreed to pretend ${topic} makes sense and I am formally withdrawing.`,
  ];
  const pick = templates[Math.floor(Math.random() * templates.length)];
  return pick.charAt(0).toUpperCase() + pick.slice(1);
}

export type GeneratedTake = {
  text: string;
  source: AiSource;
  model: string | null;
  /** Present when the fallback ran, explaining why. */
  note?: string;
};

export async function generateHotTake(
  prompt: string,
  tone?: string,
): Promise<GeneratedTake> {
  const cleaned = prompt.trim();
  if (!cleaned) throw new Error("Describe what the take should be about");

  const toneLine = tone?.trim() ? `\nDesired tone: ${tone.trim()}.` : "";
  const result = await converse({
    system: GENERATE_SYSTEM,
    user: `Write one hot take about: ${cleaned}${toneLine}`,
    maxTokens: 200,
    temperature: 0.9,
  });

  if (result) {
    // Strip quotes some models add despite the instruction.
    return {
      text: result.text.replace(/^["'`]+|["'`]+$/g, "").trim(),
      source: "bedrock",
      model: result.model,
    };
  }

  return {
    text: fallbackTake(cleaned),
    source: "fallback",
    model: null,
    note: "Bedrock was unreachable, so this was composed locally. Edit before posting.",
  };
}

// --- 2. Personalised "For You" feed ---------------------------------------

const STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "have", "just", "your", "you", "for",
  "are", "but", "not", "was", "were", "they", "them", "then", "than", "from",
  "what", "when", "who", "why", "how", "all", "any", "can", "will", "would",
  "should", "could", "there", "their", "been", "being", "into", "out", "about",
  "more", "most", "some", "only", "even", "also", "because", "actually", "like",
  "really", "very", "does", "did", "doing", "make", "makes", "made", "one",
  "two", "get", "got", "has", "had", "its", "it's", "his", "her", "she", "him",
  "people", "thing", "things", "never", "always", "everyone", "someone",
]);

function keywords(text: string, limit = 12): string[] {
  const counts = new Map<string, number>();

  for (const raw of text.toLowerCase().split(/[^a-z']+/)) {
    const word = raw.replace(/^'+|'+$/g, "");
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

const INTEREST_SYSTEM = [
  "You infer a reader's interests from posts they upvoted.",
  "Reply with 3 to 8 short lowercase topic keywords, comma separated.",
  "No explanation, no numbering, no sentences.",
].join("\n");

export type Interests = {
  topics: string[];
  source: AiSource;
  /** How many upvotes the inference was based on. */
  basedOn: number;
};

/** Interests move slowly; cache per viewer to avoid a model call per scroll. */
const interestCache = new Map<
  string,
  { topics: string[]; source: AiSource; basedOn: number; expiresAt: number }
>();

/**
 * A Bedrock-derived result is worth holding for a while. A fallback result is
 * cached far more briefly, so that once Bedrock is reachable again the next
 * request upgrades instead of serving keyword output for another five minutes.
 */
const INTEREST_TTL_MS = { bedrock: 5 * 60 * 1000, fallback: 20 * 1000 } as const;

export async function inferInterests(viewerId: UserId | null): Promise<Interests> {
  if (!viewerId) return { topics: [], source: "fallback", basedOn: 0 };

  const cached = interestCache.get(viewerId);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      topics: cached.topics,
      source: cached.source,
      basedOn: cached.basedOn,
    };
  }

  const repo = getRepository();
  const upvotedIds = await repo.listVotedTargetIds(viewerId, "post", 1, 25);
  if (upvotedIds.length === 0) {
    return { topics: [], source: "fallback", basedOn: 0 };
  }

  const upvoted = (
    await Promise.all(upvotedIds.map((id) => repo.getPostById(id)))
  ).filter((post): post is NonNullable<typeof post> => post !== null);

  if (upvoted.length === 0) {
    return { topics: [], source: "fallback", basedOn: 0 };
  }

  const corpus = upvoted.map((post) => `${post.title} ${post.body}`).join("\n");

  let topics: string[] = [];
  let source: AiSource = "fallback";

  const result = await converse({
    system: INTEREST_SYSTEM,
    user: `Posts this reader upvoted:\n${corpus}`,
    maxTokens: 80,
    temperature: 0.2,
  });

  if (result) {
    topics = result.text
      .toLowerCase()
      .split(/[,\n]/)
      .map((topic) => topic.replace(/[^a-z' ]/g, "").trim())
      .filter((topic) => topic.length >= 3)
      .slice(0, 8);
    if (topics.length > 0) source = "bedrock";
  }

  if (topics.length === 0) {
    topics = keywords(corpus, 10);
    source = "fallback";
  }

  const interests: Interests = {
    topics,
    source,
    basedOn: upvoted.length,
  };

  interestCache.set(viewerId, {
    ...interests,
    expiresAt: Date.now() + INTEREST_TTL_MS[source],
  });

  return interests;
}

export type ForYouResult = ListPostsResult & {
  interests: Interests;
  /** True when there was no signal yet and this is just the hot feed. */
  coldStart: boolean;
};

/** Size of the pool re-ranked in memory. Caps the cost of personalisation. */
const FOR_YOU_POOL = 60;

/**
 * Rank posts by how well they match the viewer's inferred interests, blended
 * with popularity and freshness so a brand-new post still has a chance.
 *
 * A candidate pool is pulled with the normal hot ranking and re-scored in
 * memory, which keeps the repository free of ranking specifics and lets the
 * topic matching stay flexible.
 */
export async function listForYouViews(
  viewerId: UserId | null,
  options: {
    limit?: number;
    offset?: number;
    subredditIds?: SubredditId[] | null;
  } = {},
): Promise<ForYouResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);

  const interests = await inferInterests(viewerId);

  // No signal yet: hot is the best available guess.
  if (interests.topics.length === 0) {
    const hot = await listPostViews(
      { sort: "hot", limit, offset, subredditIds: options.subredditIds ?? null },
      viewerId,
    );
    return { ...hot, interests, coldStart: true };
  }

  const pool = await getRepository().listPosts({
    sort: "hot",
    limit: FOR_YOU_POOL,
    offset: 0,
    subredditIds: options.subredditIds ?? null,
  });

  const now = Date.now();
  const ranked = pool
    .map((post) => {
      const haystack = `${post.title} ${post.body} ${post.url ?? ""}`.toLowerCase();

      // A topic hit outweighs popularity; multi-word topics must match fully.
      const hits = interests.topics.filter((topic) =>
        topic.split(" ").every((word) => haystack.includes(word)),
      ).length;

      const ageHours = (now - Date.parse(post.createdAt)) / 3_600_000;
      const freshness = 1 / (1 + ageHours / 24);
      const popularity = Math.log10(Math.max(Math.abs(post.score), 1));

      return { post, rank: hits * 3 + popularity + freshness * 2 };
    })
    .sort((a, b) => b.rank - a.rank);

  const page = ranked.slice(offset, offset + limit).map((entry) => entry.post);

  return {
    posts: await toPostViews(page, viewerId),
    hasMore: offset + limit < ranked.length,
    nextOffset: offset + page.length,
    total: ranked.length,
    interests,
    coldStart: false,
  };
}

export type { PostView };
