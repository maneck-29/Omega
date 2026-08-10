/**
 * Anonymous identity.
 *
 * Every visitor gets a random UUID in an httpOnly cookie on their first
 * mutation. That token is the author identity (so an anonymous poster can edit
 * or delete their own post) and the vote identity (so one browser counts as one
 * vote).
 *
 * When real accounts land, `userId` takes precedence over the token in
 * `voterKey`, so signed-in users are deduplicated by account while anonymous
 * visitors keep working exactly as before. Nothing here needs to change and no
 * data migration is required — `posts` and `votes` already carry both columns.
 */

import { cookies } from "next/headers";

export const OWNER_COOKIE = "ht_owner";

/** One year, in seconds. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface Identity {
  /** Set once accounts exist; null for anonymous visitors. */
  userId: string | null;
  /** The anonymous owner token, if this visitor has one yet. */
  ownerToken: string | null;
  /**
   * The key votes and ownership are recorded against: the account when signed
   * in, otherwise the anonymous token. Null only for a first-time visitor who
   * has not yet performed a mutation.
   */
  voterKey: string | null;
}

/**
 * Resolve the current identity without creating one. Safe to call from Server
 * Components — it only reads. A visitor with no token yet has no votes and no
 * posts, so a null voterKey is not a problem for reads.
 */
export async function readIdentity(): Promise<Identity> {
  const store = await cookies();
  const ownerToken = store.get(OWNER_COOKIE)?.value ?? null;

  // Placeholder for the accounts slice: read the session here and the rest of
  // the app picks it up automatically.
  const userId: string | null = null;

  return { userId, ownerToken, voterKey: userId ?? ownerToken };
}

/**
 * Resolve the current identity, minting and setting a token if absent.
 *
 * Only valid inside a Route Handler or Server Function — cookies cannot be
 * written during a Server Component render.
 */
export async function ensureIdentity(): Promise<Identity> {
  const store = await cookies();
  const existing = store.get(OWNER_COOKIE)?.value;

  if (existing) {
    const userId: string | null = null;
    return { userId, ownerToken: existing, voterKey: userId ?? existing };
  }

  const ownerToken = crypto.randomUUID();
  store.set(OWNER_COOKIE, ownerToken, {
    httpOnly: true,
    sameSite: "lax",
    // Omega serves over HTTPS; keep it relaxed on localhost so dev works.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  const userId: string | null = null;
  return { userId, ownerToken, voterKey: userId ?? ownerToken };
}

/**
 * Whether `identity` may edit or delete a record authored by the given owner.
 * A signed-in user matches on user_id; an anonymous visitor matches on token.
 */
export function ownsRecord(
  identity: Identity,
  record: { user_id?: string | null; anon_owner_token?: string | null },
): boolean {
  if (identity.userId && record.user_id) {
    return identity.userId === record.user_id;
  }
  if (identity.ownerToken && record.anon_owner_token) {
    return identity.ownerToken === record.anon_owner_token;
  }
  return false;
}
