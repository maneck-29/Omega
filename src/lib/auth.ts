/**
 * Stub authentication — owned by TM1 (Authentication & User Management).
 *
 * TM3 ships this fake so subreddit and comment work is not blocked on real auth.
 * Every TM3 feature is gated on identity, so a stub on day one is what keeps the
 * three workstreams independent.
 *
 * TM1: replace the body of `getCurrentUser()` with real session/JWT lookup and
 * `getUsersByIds()` with a batched user fetch. Keep the signatures — TM2 and TM3
 * both call them.
 *
 * Dev-only: the active user can be switched with the `dev_user` cookie, so
 * permissions and bans are testable without a login screen.
 */

import { cookies } from "next/headers";
import {
  readSessionValue,
  SESSION_COOKIE,
  sessionAccount,
  sessionUsername,
} from "./session";
import type { PublicUser, UserId } from "./types";

/** Fixture users, shared with the seed script so all three of us test alike. */
export const DEV_USERS: PublicUser[] = [
  { id: "user-1", username: "alice", avatarUrl: null },
  { id: "user-2", username: "bob", avatarUrl: null },
  { id: "user-3", username: "carol", avatarUrl: null },
];

const DEFAULT_USER_ID = "user-1";

/**
 * The signed-in user.
 *
 * A valid session cookie wins. Without one this falls back to the `dev_user`
 * stub, so every flow teammates built against the fixture users keeps working
 * and nothing depends on signing in.
 */
export async function getCurrentUser(): Promise<PublicUser | null> {
  const store = await cookies();

  const sessionUserId = await readSessionValue(store.get(SESSION_COOKIE)?.value);
  if (sessionUserId) {
    const signedIn = DEV_USERS.find((u) => u.id === sessionUserId);
    if (signedIn) {
      // The session's account may be named differently from the fixture user it
      // maps onto, so show the name they signed in with.
      return { ...signedIn, username: sessionUsername() };
    }
  }

  const id = store.get("dev_user")?.value ?? DEFAULT_USER_ID;
  return DEV_USERS.find((u) => u.id === id) ?? null;
}

/**
 * Whether the visitor has actually signed in, as opposed to being served the
 * development stub. Used by the login page and the sign-out control.
 */
export async function isSignedIn(): Promise<boolean> {
  const store = await cookies();
  return (await readSessionValue(store.get(SESSION_COOKIE)?.value)) !== null;
}

/**
 * Resolve a username to a user.
 *
 * Must be used instead of searching `DEV_USERS` directly, because the name a
 * visitor signs in with need not be one of the fixture usernames.
 * `getCurrentUser()` reports the signed-in name, so `/me` links to `/u/<that
 * name>` — and looking that up against the fixtures alone returns nothing, which
 * made the signed-in user's own profile a 404.
 */
export function findUserByUsername(username: string): PublicUser | null {
  const wanted = username.trim().toLowerCase();

  // The sign-in account, presented as the fixture user it maps onto.
  const account = sessionAccount();
  if (wanted === account.username.toLowerCase()) {
    const base = DEV_USERS.find((u) => u.id === account.userId);
    if (base) return { ...base, username: account.username };
  }

  return DEV_USERS.find((u) => u.username.toLowerCase() === wanted) ?? null;
}

/** Throwing variant for routes that require a session. */
export async function requireCurrentUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}

/** Batched lookup for comment bylines; avoids N+1 when rendering a thread. */
export async function getUsersByIds(
  ids: UserId[],
): Promise<Map<UserId, PublicUser>> {
  const wanted = new Set(ids);
  return new Map(
    DEV_USERS.filter((u) => wanted.has(u.id)).map((u) => [u.id, u]),
  );
}
