/**
 * Shared Amazon Bedrock client.
 *
 * One client, one model-candidate list, and one cooldown map for every AI
 * feature in the app: hot-take drafting and interest inference (TM2), comment
 * triage and thread summaries (TM3).
 *
 * This exists because the plumbing was duplicated, and the copies had drifted:
 * one resolved the region from `BEDROCK_REGION ?? AWS_REGION` and fell back
 * through several models, the other required `BEDROCK_REGION` and hardcoded a
 * single model id. The result was a feature reporting itself unconfigured in a
 * deployment where its sibling worked. Region resolution and availability are
 * properties of the integration, not of the feature, so they live here.
 *
 * Callers get `null` from `converse()` rather than an exception, so every
 * feature is obliged to have a non-AI fallback and none can take a page down
 * because a model was throttled.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

/** Whether a result came from a model or from a local fallback. */
export type AiSource = "bedrock" | "fallback";

/**
 * The Omega Bedrock integration injects `BEDROCK_REGION`. `AWS_REGION` is always
 * present in Lambda, so it is a usable second choice: an account with model
 * access in its own region works with no integration wired at all.
 */
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

/**
 * Whether a Bedrock call is worth attempting.
 *
 * Deliberately loose: any resolvable region qualifies, because credentials may
 * come from the integration, an instance role, or a developer's profile, and
 * none of those are visible from here. A call that turns out to be impossible
 * fails into the caller's fallback, which is cheaper than a false negative that
 * hides a working feature.
 */
export function isBedrockConfigured(): boolean {
  return Boolean(REGION);
}

let client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  // Cached: constructing a client per request re-resolves credentials.
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
  configured: boolean;
  candidates: string[];
  cooledDown: Array<{ modelId: string; retryInSeconds: number }>;
} {
  const now = Date.now();
  return {
    region: REGION,
    configured: isBedrockConfigured(),
    candidates: MODEL_CANDIDATES,
    cooledDown: [...cooldowns.entries()]
      .filter(([, until]) => until > now)
      .map(([modelId, until]) => ({
        modelId,
        retryInSeconds: Math.max(0, Math.round((until - now) / 1000)),
      })),
  };
}

/**
 * Sends one prompt, trying each candidate model until one answers.
 *
 * Returns null when every candidate failed, which is the signal for the caller
 * to produce a local result instead.
 */
export async function converse(options: {
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

/** Strips markdown fences a model may add despite being told not to. */
export function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}
