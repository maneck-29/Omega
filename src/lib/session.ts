/**
 * Sign-in sessions.
 *
 * A session is a cookie holding `userId.expiry.signature`, where the signature is
 * an HMAC over the first two parts. Signing is the point: without it, anyone
 * could set `session=user-1` in their browser and be signed in as someone else.
 *
 * Uses Web Crypto rather than node:crypto so the same helpers work in
 * middleware, which runs on the edge runtime.
 *
 * Interim implementation. Real accounts are TM1's slice — see
 * `docs/integration-contract.md`. This exists so the app has a login screen and a
 * single demo user; `getCurrentUser()` in `auth.ts` prefers a session when one is
 * present and otherwise falls back to the dev-user stub, so nothing teammates
 * rely on changes.
 */

export const SESSION_COOKIE = "ht_session";

/** Eight hours: long enough for a working day, short enough to expire. */
const SESSION_TTL_SECONDS = 8 * 60 * 60;

/**
 * The demo account. Read from the environment so the deployed app can be given
 * real values without a code change — the defaults exist only so local
 * development works out of the box.
 *
 * Never put a credential you care about in the defaults: this file is in a public
 * repository.
 */
function demoAccount(): { username: string; password: string; userId: string } {
  return {
    username: process.env.APP_USERNAME ?? "user",
    password: process.env.APP_PASSWORD ?? "12345",
    // Maps onto the existing fixture user, so posts and votes made while signed
    // in belong to a user the rest of the app already knows about.
    userId: process.env.APP_USER_ID ?? "user-1",
  };
}

function secret(): string {
  const configured = process.env.AUTH_SECRET;
  if (configured && configured.length >= 16) return configured;

  // A fixed development fallback keeps sessions valid across restarts. In a
  // deployed environment AUTH_SECRET must be set, or sessions are signed with a
  // value that is public knowledge.
  if (process.env.NODE_ENV === "production" && !configured) {
    console.warn(
      "[auth] AUTH_SECRET is not set; sessions are signed with the development key.",
    );
  }
  return "hot-takes-development-signing-key";
}

const encoder = new TextEncoder();

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));

  // Base64url, so the value is cookie-safe.
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Length-independent comparison, so a mismatch cannot be timed. */
function equals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Verify a username and password. Returns the user id, or null. */
export function verifyCredentials(
  username: string,
  password: string,
): string | null {
  const account = demoAccount();

  // Both comparisons run regardless, so a wrong username and a wrong password
  // take the same time.
  const userOk = equals(username.trim().toLowerCase(), account.username.toLowerCase());
  const passOk = equals(password, account.password);

  return userOk && passOk ? account.userId : null;
}

export async function createSessionValue(userId: string): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${userId}.${expiry}`;
  return `${payload}.${await hmac(payload)}`;
}

/**
 * Validate a cookie value and return the user id it authenticates.
 *
 * Returns null when the value is malformed, tampered with, or expired.
 */
export async function readSessionValue(
  value: string | undefined | null,
): Promise<string | null> {
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length !== 3) return null;

  const [userId, expiryRaw, signature] = parts;
  const expected = await hmac(`${userId}.${expiryRaw}`);
  if (!equals(signature, expected)) return null;

  const expiry = Number.parseInt(expiryRaw, 10);
  if (!Number.isFinite(expiry) || expiry * 1000 < Date.now()) return null;

  return userId;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};

/** The username to show in the UI for a signed-in session. */
export function sessionUsername(): string {
  return demoAccount().username;
}

/**
 * The sign-in account's username and the fixture user it maps onto.
 *
 * Exposed so username lookups can resolve the signed-in account as well as the
 * fixture users. Deliberately excludes the password.
 */
export function sessionAccount(): { username: string; userId: string } {
  const { username, userId } = demoAccount();
  return { username, userId };
}
