/**
 * Permission and ban checks for TM3's domain.
 *
 * Cross-cutting: TM3 enforces these on comment writes, but TM2 MUST call
 * `assertCanPost` before creating a post. Without that call, banned users can
 * still post — the ban only looks enforced.
 */

import { getRepository } from "./db";
import { forbidden, notFound } from "./errors";
import type { SubredditId, UserId } from "./types";

export async function isModerator(
  userId: UserId | null,
  subredditId: SubredditId,
): Promise<boolean> {
  if (!userId) return false;
  const moderator = await getRepository().getModerator(subredditId, userId);
  return moderator !== null;
}

export async function assertModerator(
  userId: UserId | null,
  subredditId: SubredditId,
): Promise<void> {
  if (!(await isModerator(userId, subredditId))) {
    throw forbidden("You must be a moderator of this subreddit", "not_moderator");
  }
}

export async function isBanned(
  userId: UserId | null,
  subredditId: SubredditId,
): Promise<boolean> {
  if (!userId) return false;
  return (await getRepository().getActiveBan(subredditId, userId)) !== null;
}

/**
 * Throws when the user is banned from the subreddit.
 *
 * Call before ANY content write — comments (TM3) and posts (TM2).
 */
export async function assertNotBanned(
  userId: UserId,
  subredditId: SubredditId,
): Promise<void> {
  const ban = await getRepository().getActiveBan(subredditId, userId);
  if (ban) {
    const until = ban.expiresAt
      ? ` until ${new Date(ban.expiresAt).toLocaleDateString()}`
      : "";
    throw forbidden(
      `You are banned from this subreddit${until}: ${ban.reason}`,
      "banned",
    );
  }
}

/**
 * Public entry point for TM2's post-creation path.
 *
 * Verifies the subreddit exists and the author is not banned. Resolves by slug
 * so TM2 can call it straight from the route param.
 */
export async function assertCanPost(
  userId: UserId,
  subredditSlug: string,
): Promise<{ subredditId: SubredditId }> {
  const subreddit = await getRepository().getSubredditBySlug(subredditSlug);
  if (!subreddit) {
    throw notFound(
      `Subreddit "${subredditSlug}" not found`,
      "subreddit_not_found",
    );
  }
  await assertNotBanned(userId, subreddit.id);
  return { subredditId: subreddit.id };
}

/** Author or moderator; used for comment edit/delete authorization. */
export async function canModifyComment(
  userId: UserId | null,
  authorId: UserId,
  subredditId: SubredditId,
): Promise<boolean> {
  if (!userId) return false;
  if (userId === authorId) return true;
  return isModerator(userId, subredditId);
}
