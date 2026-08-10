/**
 * TM2 integration endpoint.
 *
 * The home feed is "posts from subreddits I subscribe to", so TM2 needs the
 * viewer's subscribed subreddit ids. Prefer calling
 * `getSubscribedSubredditIds()` directly in server code — this route exists for
 * client components and for TM2's local development against a stable contract.
 */

import { requireCurrentUser } from "@/lib/auth";
import { handler } from "@/lib/route-helpers";
import {
  getSubscribedSubredditIds,
  listSubscribedSubreddits,
} from "@/lib/subreddits";

/** GET /api/me/subscriptions */
export async function GET() {
  return handler(async () => {
    const user = await requireCurrentUser();
    const [subredditIds, subreddits] = await Promise.all([
      getSubscribedSubredditIds(user.id),
      listSubscribedSubreddits(user.id),
    ]);
    return { subredditIds, subreddits };
  });
}
