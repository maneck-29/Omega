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
import type { PublicUser, UserId } from "./types";

/** Fixture users, shared with the seed script so all three of us test alike. */
export const DEV_USERS: PublicUser[] = [
  { id: "user-1", username: "alice", avatarUrl: null },
  { id: "user-2", username: "bob", avatarUrl: null },
  { id: "user-3", username: "carol", avatarUrl: null },
];

const DEFAULT_USER_ID = "user-1";

export async function getCurrentUser(): Promise<PublicUser | null> {
  const store = await cookies();
  const id = store.get("dev_user")?.value ?? DEFAULT_USER_ID;
  return DEV_USERS.find((u) => u.id === id) ?? null;
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
