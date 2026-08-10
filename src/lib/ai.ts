/**
 * AI features, backed by Amazon Bedrock.
 *
 *  1. generateHotTake  — turn a user prompt into a postable opinion.
 *  2. listForYou       — a personalised feed ranked by inferred interests.
 *
 * Both degrade gracefully. Bedrock needs model access granted in the account and
 * a region that serves the chosen model; when a call fails for any reason the
 * feature falls back to a local implementation and reports `source: "fallback"`
 * so the UI can be honest about it. That keeps the app fully usable on
 * localhost, where no Bedrock integration is wired at all.
 *
 * The Bedrock integration injects only BEDROCK_REGION — the model is named
 * here, not by Omega.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { query } from "./db";
import type { Identity } from "./identity";
import { listPosts, type ListResult, type Post } from "./posts";

export type AiSource = "bedrock" | "fallback";

const REGION =
  process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-east-2";

/**
 * Candidate models, tried in order, cheapest tier first — these tasks are a
 * couple of sentences of output, so the small models are a good fit and there
 * is no reason to pay for a large one. Availability varies by account and
 * region, so an explicit BEDROCK_MODEL_ID wins and the rest are fallbacks.
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

/** Models that failed once are skipped for the rest of the process lifetime. */
const deadModels = new Set<string>();

interface ConverseOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Call Bedrock's Converse API, trying each candidate model until one answers.
 * Returns null when every candidate fails, letting callers fall back.
 */
async function converse(options: ConverseOptions): Promise<
  { text: string; model: string } | null
> {
  const candidates = MODEL_CANDIDATES.filter((id) => !deadModels.has(id));

  for (const modelId of candidates) {
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

      if (text) return { text, model: modelId };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.warn(`[ai] model ${modelId} unavailable: ${message}`);
      deadModels.add(modelId);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 1. Hot take generation
// ---------------------------------------------------------------------------

const GENERATE_SYSTEM = [
  "You write short, punchy, opinionated social media posts called hot takes.",
  "Rules:",
  "- One or two sentences, under 240 characters.",
  "- Confident and a little provocative, but never hateful, discriminatory,",
  "  sexual, violent, or targeted at a real named person.",
  "- Keep it about ideas, habits, technology, food, work culture and similar",
  "  everyday debates.",
  "- Output only the post text. No quotes, no preamble, no hashtags.",
].join("\n");

/** Local generator used when Bedrock is unavailable. */
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

export interface GeneratedTake {
  text: string;
  source: AiSource;
  model: string | null;
  /** Present when the fallback ran, explaining why. */
  note?: string;
}

export async function generateHotTake(
  prompt: string,
  tone?: string,
): Promise<GeneratedTake> {
  const cleaned = prompt.trim();
  if (!cleaned) {
    throw new Error("Describe what the take should be about");
  }

  const toneLine = tone?.trim() ? `\nDesired tone: ${tone.trim()}.` : "";
  const result = await converse({
    system: GENERATE_SYSTEM,
    user: `Write one hot take about: ${cleaned}${toneLine}`,
    maxTokens: 200,
    temperature: 0.9,
  });

  if (result) {
    // Strip surrounding quotes some models add despite instructions.
    const text = result.text.replace(/^["'`]+|["'`]+$/g, "").trim();
    return { text, source: "bedrock", model: result.model };
  }

  return {
    text: fallbackTake(cleaned),
    source: "fallback",
    model: null,
    note: "Bedrock was unreachable, so this was composed locally. Edit before posting.",
  };
}

// ---------------------------------------------------------------------------
// 2. Personalised "For You" feed
// ---------------------------------------------------------------------------

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

interface CachedInterests {
  topics: string[];
  source: AiSource;
  expiresAt: number;
}

/** Interests change slowly; cache per visitor to avoid a model call per scroll. */
const interestCache = new Map<string, CachedInterests>();
const INTEREST_TTL_MS = 5 * 60 * 1000;

export interface Interests {
  topics: string[];
  source: AiSource;
  /** How many upvotes the inference was based on. */
  basedOn: number;
}

/**
 * Infer what a visitor is interested in from the posts they upvoted.
 *
 * Bedrock does the inference when reachable; otherwise term frequency over the
 * same text produces a comparable keyword list.
 */
export async function inferInterests(identity: Identity): Promise<Interests> {
  if (!identity.voterKey) return { topics: [], source: "fallback", basedOn: 0 };

  const cached = interestCache.get(identity.voterKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      topics: cached.topics,
      source: cached.source,
      basedOn: cached.topics.length,
    };
  }

  const upvoted = await query<{ body: string }>(
    `select p.body
       from votes v
       join posts p on p.id = v.target_id
      where v.voter_key = $1
        and v.value = 1
        and p.deleted_at is null
      order by v.created_at desc
      limit 25`,
    [identity.voterKey],
  );

  if (upvoted.length === 0) {
    return { topics: [], source: "fallback", basedOn: 0 };
  }

  const corpus = upvoted.map((row) => row.body).join("\n");
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

  interestCache.set(identity.voterKey, {
    topics,
    source,
    expiresAt: Date.now() + INTEREST_TTL_MS,
  });

  return { topics, source, basedOn: upvoted.length };
}

export interface ForYouResult extends ListResult {
  interests: Interests;
  /** True when there was no signal yet and this is just the hot feed. */
  coldStart: boolean;
}

/**
 * Rank posts by how well they match the visitor's inferred interests, blended
 * with popularity and freshness so a brand-new post still has a chance.
 *
 * A candidate pool is pulled with the existing hot ranking and re-scored in
 * memory. That keeps the SQL simple and the topic matching flexible; at feed
 * scale the pool is small enough that the cost is negligible.
 */
export async function listForYou(
  identity: Identity,
  options: { limit?: number; offset?: number } = {},
): Promise<ForYouResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);

  const interests = await inferInterests(identity);

  // No signal yet: hot is the best available guess.
  if (interests.topics.length === 0) {
    const hot = await listPosts(identity, { sort: "hot", limit, offset });
    return { ...hot, interests, coldStart: true };
  }

  const pool = await listPosts(identity, {
    sort: "hot",
    limit: 50,
    offset: 0,
  });

  const now = Date.now();
  const scored = pool.posts.map((post) => {
    const haystack = `${post.body} ${post.url ?? ""}`.toLowerCase();

    // Topic match dominates; each hit is worth a lot more than popularity.
    const hits = interests.topics.filter((topic) =>
      topic.split(" ").every((word) => haystack.includes(word)),
    ).length;

    const ageHours = (now - new Date(post.created_at).getTime()) / 3_600_000;
    const freshness = 1 / (1 + ageHours / 24);
    const popularity = Math.log10(Math.max(Math.abs(post.score), 1));

    return {
      post,
      rank: hits * 3 + popularity + freshness * 2,
    };
  });

  scored.sort((a, b) => b.rank - a.rank);

  const page = scored.slice(offset, offset + limit).map((entry) => entry.post);

  return {
    posts: page,
    hasMore: offset + limit < scored.length,
    nextOffset: offset + page.length,
    interests,
    coldStart: false,
  };
}

export type { Post };
