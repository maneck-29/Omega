import { NextResponse, type NextRequest } from "next/server";
import { readSessionValue, SESSION_COOKIE } from "@/lib/session";

/**
 * Requires a signed-in session for the whole app.
 *
 * Next.js 16 renamed Middleware to Proxy; the behaviour is identical, and this
 * file must live beside `app` (so `src/proxy.ts`) with the function exported as
 * `proxy` or as the default.
 *
 * The session cookie is verified rather than merely checked for presence, so a
 * hand-written cookie does not get past the gate. This is a coarse gate, not the
 * whole authorisation story: the routes that mutate data re-check ownership and
 * moderator status themselves, which is what Next's own guidance recommends —
 * Proxy is for optimistic checks, not as a substitute for server-side checks.
 *
 * Runs on the edge runtime, which is why `session.ts` uses Web Crypto rather
 * than node:crypto.
 */

/**
 * Reachable without a session, or signing in would be impossible.
 *
 * `/api/media` is here because it serves images referenced by `<img src>`, and
 * the CDN in front of the app caches those paths with cookies stripped — the
 * session never reaches this proxy, so gating them produced a 401 for every
 * banner and icon even when the reader was signed in.
 *
 * Making them public is the right call rather than a workaround. Object keys
 * carry a random UUID, so a URL cannot be guessed, and the route confines reads
 * to the `subreddits/` prefix. What leaks is a community's banner to someone who
 * already has its exact URL, which is the same exposure any CDN-hosted image has.
 */
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/health",
  "/api/media",
];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (
    PUBLIC_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  ) {
    return NextResponse.next();
  }

  const session = await readSessionValue(
    request.cookies.get(SESSION_COOKIE)?.value,
  );
  if (session) return NextResponse.next();

  // API callers get a status code; redirecting fetch() to an HTML page would
  // produce a confusing parse error rather than a clear 401.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Not authenticated", code: "unauthorized" },
      { status: 401 },
    );
  }

  // Remember where they were headed so login can return them there.
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  /*
   * Everything except Next's own assets and the favicon. Static files must stay
   * public, or the login page itself would render unstyled.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
