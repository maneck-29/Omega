import { cookies } from "next/headers";
import { handler } from "@/lib/route-helpers";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * POST /api/auth/logout — clear the session cookie.
 *
 * POST rather than GET so a link or prefetch cannot sign someone out.
 */
export const dynamic = "force-dynamic";

export function POST() {
  return handler(async () => {
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    return { ok: true };
  });
}
