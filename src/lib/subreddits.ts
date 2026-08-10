/**
 * Subreddit service — create, settings, rules, subscriptions, moderators, bans.
 */

import { getRepository } from "./db";
import { badRequest, forbidden, notFound } from "./errors";
import { assertModerator } from "./permissions";
import type {
  ModLogEntry,
  Subreddit,
  SubredditBan,
  SubredditId,
  SubredditModerator,
  SubredditRule,
  UserId,
} from "./types";
import {
  RULE_DESCRIPTION_MAX,
  RULE_TITLE_MAX,
  SUBREDDIT_DESCRIPTION_MAX,
  normalizeSubredditName,
  validateOptionalUrl,
  validateText,
} from "./validation";

export type SubredditView = Subreddit & {
  rules: SubredditRule[];
  isSubscribed: boolean;
  isModerator: boolean;
  isBanned: boolean;
};

/**
 * Creates a subreddit. The creator becomes owner-moderator and subscriber, so a
 * new subreddit is never left unmoderated or with a zero count.
 */
export async function createSubreddit(input: {
  name: unknown;
  description?: unknown;
  bannerUrl?: unknown;
  iconUrl?: unknown;
  createdBy: UserId;
}): Promise<Subreddit> {
  const repo = getRepository();
  const { name, slug } = normalizeSubredditName(input.name);
  const description = validateText(
    input.description ?? "",
    "Description",
    SUBREDDIT_DESCRIPTION_MAX,
    { required: false },
  );

  const subreddit = await repo.createSubreddit({
    name,
    slug,
    description,
    createdBy: input.createdBy,
    bannerUrl: validateOptionalUrl(input.bannerUrl, "Banner URL"),
    iconUrl: validateOptionalUrl(input.iconUrl, "Icon URL"),
  });

  await repo.addModerator(subreddit.id, input.createdBy, "owner");
  await repo.subscribe(input.createdBy, subreddit.id);

  // Re-read so the caller sees the incremented subscriber count.
  return (await repo.getSubredditById(subreddit.id)) ?? subreddit;
}

/** Resolves a `/r/[subreddit]` route param, or throws 404. */
export async function getSubredditBySlugOrThrow(
  slug: string,
): Promise<Subreddit> {
  const subreddit = await getRepository().getSubredditBySlug(slug);
  if (!subreddit) {
    throw notFound(`Subreddit "${slug}" not found`, "subreddit_not_found");
  }
  return subreddit;
}

/** Subreddit plus viewer-relative flags, for page rendering. */
export async function getSubredditView(
  slug: string,
  viewerId: UserId | null,
): Promise<SubredditView> {
  const repo = getRepository();
  const subreddit = await getSubredditBySlugOrThrow(slug);

  const [rules, isSubscribed, moderator, ban] = await Promise.all([
    repo.listRules(subreddit.id),
    viewerId ? repo.isSubscribed(viewerId, subreddit.id) : Promise.resolve(false),
    viewerId
      ? repo.getModerator(subreddit.id, viewerId)
      : Promise.resolve(null),
    viewerId
      ? repo.getActiveBan(subreddit.id, viewerId)
      : Promise.resolve(null),
  ]);

  return {
    ...subreddit,
    rules,
    isSubscribed,
    isModerator: moderator !== null,
    isBanned: ban !== null,
  };
}

export async function updateSubredditSettings(
  slug: string,
  actorId: UserId,
  patch: { description?: unknown; bannerUrl?: unknown; iconUrl?: unknown },
): Promise<Subreddit> {
  const subreddit = await getSubredditBySlugOrThrow(slug);
  await assertModerator(actorId, subreddit.id);

  return getRepository().updateSubreddit(subreddit.id, {
    ...(patch.description !== undefined && {
      description: validateText(
        patch.description,
        "Description",
        SUBREDDIT_DESCRIPTION_MAX,
        { required: false },
      ),
    }),
    ...(patch.bannerUrl !== undefined && {
      bannerUrl: validateOptionalUrl(patch.bannerUrl, "Banner URL"),
    }),
    ...(patch.iconUrl !== undefined && {
      iconUrl: validateOptionalUrl(patch.iconUrl, "Icon URL"),
    }),
  });
}

/**
 * Sets a banner or icon to a URL this server produced.
 *
 * Separate from `updateSubredditSettings` because that validates URLs as http(s)
 * to keep `javascript:` and `data:` out of fields a user can type into. An
 * uploaded image may legitimately be a `data:` URL when S3 is not connected, and
 * it never passed through a request body — it was built from bytes this server
 * sniffed and encoded. Validating it again would reject the one caller that is
 * trustworthy, and relaxing the shared validator would accept the ones that are
 * not.
 */
export async function setSubredditImage(
  slug: string,
  actorId: UserId,
  kind: "banner" | "icon",
  url: string,
): Promise<Subreddit> {
  const subreddit = await getSubredditBySlugOrThrow(slug);
  await assertModerator(actorId, subreddit.id);

  // Empty clears the field. Storing "" instead of null would render as a broken
  // image rather than falling back.
  const value = url === "" ? null : url;

  return getRepository().updateSubreddit(
    subreddit.id,
    kind === "banner" ? { bannerUrl: value } : { iconUrl: value },
  );
}

// --- Rules ----------------------------------------------------------------

export async function addRule(
  slug: string,
  actorId: UserId,
  input: { title: unknown; description?: unknown },
): Promise<SubredditRule> {
  const subreddit = await getSubredditBySlugOrThrow(slug);
  await assertModerator(actorId, subreddit.id);

  return getRepository().addRule(
    subreddit.id,
    validateText(input.title, "Rule title", RULE_TITLE_MAX),
    validateText(
      input.description ?? "",
      "Rule description",
      RULE_DESCRIPTION_MAX,
      { required: false },
    ),
  );
}

/**
 * Confirms a rule belongs to the given subreddit before it is modified.
 *
 * Without this, a moderator of one subreddit could edit or delete another
 * subreddit's rule by id — the moderator check alone only proves they moderate
 * *somewhere*.
 */
async function assertRuleBelongsTo(
  subredditId: SubredditId,
  ruleId: string,
): Promise<void> {
  const rules = await getRepository().listRules(subredditId);
  if (!rules.some((rule) => rule.id === ruleId)) {
    throw notFound("Rule not found in this subreddit", "rule_not_found");
  }
}

export async function updateRule(
  slug: string,
  actorId: UserId,
  ruleId: string,
  patch: { title?: unknown; description?: unknown },
): Promise<SubredditRule> {
  const subreddit = await getSubredditBySlugOrThrow(slug);
  await assertModerator(actorId, subreddit.id);
  await assertRuleBelongsTo(subreddit.id, ruleId);

  return getRepository().updateRule(ruleId, {
    ...(patch.title !== undefined && {
      title: validateText(patch.title, "Rule title", RULE_TITLE_MAX),
    }),
    ...(patch.description !== undefined && {
      description: validateText(
        patch.description,
        "Rule description",
        RULE_DESCRIPTION_MAX,
        { required: false },
      ),
    }),
  });
}

export async function deleteRule(
  slug: string,
  actorId: UserId,
  ruleId: string,
): Promise<void> {
  const subreddit = await getSubredditBySlugOrThrow(slug);
  await assertModerator(actorId, subreddit.id);
  await assertRuleBelongsTo(subreddit.id, ruleId);
  await getRepository().deleteRule(ruleId);
}

/**
 * Persists a new rule ordering. `ruleIds` must be the complete set for the
 * subreddit; a partial list would leave positions inconsistent.
 */
export async function reorderRules(
  slug: string,
  actorId: UserId,
  ruleIds: string[],
): Promise<SubredditRule[]> {
  const repo = getRepository();
  const subreddit = await getSubredditBySlugOrThrow(slug);
  await assertModerator(actorId, subreddit.id);

  const existing = await repo.listRules(subreddit.id);
  const existingIds = new Set(existing.map((rule) => rule.id));

  if (
    ruleIds.length !== existing.length ||
    !ruleIds.every((id) => existingIds.has(id))
  ) {
    throw badRequest(
      "ruleIds must contain every rule in this subreddit exactly once",
      "incomplete_rule_order",
    );
  }

  await repo.reorderRules(subreddit.id, ruleIds);
  return repo.listRules(subreddit.id);
}

// --- Subscriptions --------------------------------------------------------

/**
 * Idempotent subscribe. Banned users may not subscribe, so a ban is not
 * trivially worked around.
 */
export async function subscribe(
  slug: string,
  userId: UserId,
): Promise<{ subscribed: boolean; subscriberCount: number }> {
  const repo = getRepository();
  const subreddit = await getSubredditBySlugOrThrow(slug);

  if (await repo.getActiveBan(subreddit.id, userId)) {
    throw forbidden("You are banned from this subreddit", "banned");
  }

  await repo.subscribe(userId, subreddit.id);
  const updated = await repo.getSubredditById(subreddit.id);

  return {
    subscribed: true,
    subscriberCount: updated?.subscriberCount ?? subreddit.subscriberCount,
  };
}

export async function unsubscribe(
  slug: string,
  userId: UserId,
): Promise<{ subscribed: boolean; subscriberCount: number }> {
  const repo = getRepository();
  const subreddit = await getSubredditBySlugOrThrow(slug);

  await repo.unsubscribe(userId, subreddit.id);
  const updated = await repo.getSubredditById(subreddit.id);

  return {
    subscribed: false,
    subscriberCount: updated?.subscriberCount ?? subreddit.subscriberCount,
  };
}

/**
 * TM2 integration point: the set of subreddits whose posts belong in a user's
 * home feed.
 */
export async function getSubscribedSubredditIds(
  userId: UserId,
): Promise<SubredditId[]> {
  return getRepository().getSubscribedSubredditIds(userId);
}

export async function listSubscribedSubreddits(
  userId: UserId,
): Promise<Subreddit[]> {
  return getRepository().listSubscribedSubreddits(userId);
}

// --- Discovery ------------------------------------------------------------

export async function listSubreddits(options: {
  query?: string;
  sort?: "popular" | "new" | "name";
  limit?: number;
  offset?: number;
}): Promise<{ subreddits: Subreddit[]; total: number }> {
  const repo = getRepository();
  const [subreddits, total] = await Promise.all([
    repo.listSubreddits(options),
    repo.countSubreddits(options),
  ]);
  return { subreddits, total };
}

// --- Moderation -----------------------------------------------------------

export async function banUser(
  slug: string,
  actorId: UserId,
  input: {
    userId: UserId;
    reason?: unknown;
    /** Days from now; omit for a permanent ban. */
    durationDays?: number | null;
  },
): Promise<SubredditBan> {
  const repo = getRepository();
  const subreddit = await getSubredditBySlugOrThrow(slug);
  await assertModerator(actorId, subreddit.id);

  // Moderators outrank each other only via ownership; keep it simple and
  // disallow banning any moderator.
  if (await repo.getModerator(subreddit.id, input.userId)) {
    throw forbidden("Cannot ban a moderator", "target_is_moderator");
  }

  const reason = validateText(input.reason ?? "", "Reason", 500, {
    required: false,
  });

  const expiresAt =
    input.durationDays && input.durationDays > 0
      ? new Date(Date.now() + input.durationDays * 86_400_000).toISOString()
      : null;

  const ban = await repo.banUser({
    subredditId: subreddit.id,
    userId: input.userId,
    reason: reason || "No reason given",
    bannedBy: actorId,
    expiresAt,
  });

  // A banned user should not keep the subreddit in their feed.
  await repo.unsubscribe(input.userId, subreddit.id);

  await repo.addModLogEntry({
    subredditId: subreddit.id,
    moderatorId: actorId,
    action: "ban_user",
    targetType: "user",
    targetId: input.userId,
    reason: ban.reason,
  });

  return ban;
}

export async function unbanUser(
  slug: string,
  actorId: UserId,
  userId: UserId,
): Promise<void> {
  const repo = getRepository();
  const subreddit = await getSubredditBySlugOrThrow(slug);
  await assertModerator(actorId, subreddit.id);

  await repo.unbanUser(subreddit.id, userId);
  await repo.addModLogEntry({
    subredditId: subreddit.id,
    moderatorId: actorId,
    action: "unban_user",
    targetType: "user",
    targetId: userId,
    reason: null,
  });
}

/** Active bans for the moderation UI. Moderator only. */
export async function listBans(
  slug: string,
  actorId: UserId,
): Promise<SubredditBan[]> {
  const subreddit = await getSubredditBySlugOrThrow(slug);
  await assertModerator(actorId, subreddit.id);
  return getRepository().listBans(subreddit.id);
}

/**
 * Moderation audit trail. Moderator only — it exposes who removed what, which
 * is not public information.
 */
export async function listModLog(
  slug: string,
  actorId: UserId,
  limit = 50,
): Promise<ModLogEntry[]> {
  const subreddit = await getSubredditBySlugOrThrow(slug);
  await assertModerator(actorId, subreddit.id);
  return getRepository().listModLog(subreddit.id, limit);
}

export async function listModerators(
  slug: string,
): Promise<SubredditModerator[]> {
  const subreddit = await getSubredditBySlugOrThrow(slug);
  return getRepository().listModerators(subreddit.id);
}
