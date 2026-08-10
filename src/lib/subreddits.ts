/**
 * Subreddit service — create, settings, rules, subscriptions, moderators, bans.
 */

import { getRepository } from "./db";
import { forbidden, notFound } from "./errors";
import { assertModerator } from "./permissions";
import type {
  Subreddit,
  SubredditBan,
  SubredditId,
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

export async function deleteRule(
  slug: string,
  actorId: UserId,
  ruleId: string,
): Promise<void> {
  const subreddit = await getSubredditBySlugOrThrow(slug);
  await assertModerator(actorId, subreddit.id);
  await getRepository().deleteRule(ruleId);
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
