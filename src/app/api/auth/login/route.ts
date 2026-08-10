import { cookies } from "next/headers";
import { badRequest, unauthorized } from "@/lib/errors";
import { handler, readJson } from "@/lib/route-helpers";
import {
  createSessionValue,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifyCredentials,
} from "@/lib/session";

/**
 * POST /api/auth/login — exchange a username and password for a session cookie.
 *
 * The cookie is httpOnly, so client JavaScript cannot read it, and signed, so it
 * cannot be forged by editing browser storage.
 *
 * The cookie is written through the cookie store rather than a NextResponse,
 * because `handler()` serialises whatever this returns into the response body.
 */
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handler(async () => {
    const body = await readJson(request);

    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || !password) {
      throw badRequest("Enter a username and password", "missing_credentials");
    }

    const userId = verifyCredentials(username, password);
    // Deliberately vague: naming which half was wrong would confirm whether a
    // username exists.
    if (!userId) throw unauthorized("Incorrect username or password");

    const store = await cookies();
    store.set(SESSION_COOKIE, await createSessionValue(userId), sessionCookieOptions);

    return { ok: true };
  });
}
