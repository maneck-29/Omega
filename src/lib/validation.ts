/**
 * Input validation for TM3's domain.
 *
 * Kept dependency-free so the team can adopt zod later without unpicking rules
 * scattered across route handlers.
 */

import { badRequest } from "./errors";

export const SUBREDDIT_NAME_MIN = 3;
export const SUBREDDIT_NAME_MAX = 21;
const SUBREDDIT_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

/** Names that would collide with routes or confuse users. */
const RESERVED_NAMES = new Set([
  "about",
  "admin",
  "all",
  "api",
  "create",
  "friends",
  "help",
  "home",
  "mod",
  "new",
  "popular",
  "r",
  "random",
  "settings",
  "submit",
  "subreddits",
  "u",
  "user",
]);

export const COMMENT_BODY_MAX = 10_000;
export const RULE_TITLE_MAX = 100;
export const RULE_DESCRIPTION_MAX = 500;
export const SUBREDDIT_DESCRIPTION_MAX = 500;

/**
 * Validates a subreddit name and returns display name plus lookup slug.
 * Uniqueness is case-insensitive, so the slug is the stored key.
 */
export function normalizeSubredditName(raw: unknown): {
  name: string;
  slug: string;
} {
  if (typeof raw !== "string") {
    throw badRequest("Subreddit name is required", "invalid_name");
  }

  const name = raw.trim();

  if (name.length < SUBREDDIT_NAME_MIN || name.length > SUBREDDIT_NAME_MAX) {
    throw badRequest(
      `Subreddit name must be ${SUBREDDIT_NAME_MIN}-${SUBREDDIT_NAME_MAX} characters`,
      "invalid_name",
    );
  }

  if (!SUBREDDIT_NAME_PATTERN.test(name)) {
    throw badRequest(
      "Subreddit name may only contain letters, numbers, and underscores",
      "invalid_name",
    );
  }

  const slug = name.toLowerCase();

  if (RESERVED_NAMES.has(slug)) {
    throw badRequest(`"${name}" is a reserved name`, "reserved_name");
  }

  return { name, slug };
}

export function validateCommentBody(raw: unknown): string {
  if (typeof raw !== "string") {
    throw badRequest("Comment body is required", "invalid_body");
  }

  const body = raw.trim();

  if (body.length === 0) {
    throw badRequest("Comment cannot be empty", "invalid_body");
  }

  if (body.length > COMMENT_BODY_MAX) {
    throw badRequest(
      `Comment must be at most ${COMMENT_BODY_MAX} characters`,
      "invalid_body",
    );
  }

  return body;
}

export function validateText(
  raw: unknown,
  field: string,
  maxLength: number,
  { required = true }: { required?: boolean } = {},
): string {
  if (raw === undefined || raw === null) {
    if (required) throw badRequest(`${field} is required`, "invalid_field");
    return "";
  }

  if (typeof raw !== "string") {
    throw badRequest(`${field} must be a string`, "invalid_field");
  }

  const value = raw.trim();

  if (required && value.length === 0) {
    throw badRequest(`${field} is required`, "invalid_field");
  }

  if (value.length > maxLength) {
    throw badRequest(
      `${field} must be at most ${maxLength} characters`,
      "invalid_field",
    );
  }

  return value;
}

/** Optional URL field; rejects non-http(s) schemes to avoid javascript: URLs. */
export function validateOptionalUrl(
  raw: unknown,
  field: string,
): string | null {
  if (raw === undefined || raw === null || raw === "") return null;

  if (typeof raw !== "string") {
    throw badRequest(`${field} must be a string`, "invalid_field");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw badRequest(`${field} must be a valid URL`, "invalid_field");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw badRequest(`${field} must be an http(s) URL`, "invalid_field");
  }

  return parsed.toString();
}
