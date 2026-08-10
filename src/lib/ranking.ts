/**
 * Ranking maths for post sorts. Owned by TM2.
 *
 * Kept in one place so the in-memory and DSQL implementations rank identically —
 * the in-memory store exists to reproduce the same semantics, and a sort that
 * disagrees between the two is a bug that only shows up after deployment.
 *
 * The DSQL implementation expresses these as SQL ORDER BY expressions; this
 * module is the reference definition and the in-memory comparator.
 */

import type { Post, PostSort, PostWindow } from "./types";

/**
 * Reddit-style hot ranking: order of magnitude of the score plus a linear time
 * term. 45,000 seconds (12.5 hours) buys one point of magnitude, so a fresh post
 * with a handful of votes can outrank a day-old post with many.
 */
export function hotRank(post: Pick<Post, "score" | "createdAt">): number {
  const magnitude = Math.log10(Math.max(Math.abs(post.score), 1));
  const sign = Math.sign(post.score);
  const seconds = Date.parse(post.createdAt) / 1000;
  return magnitude + (sign * seconds) / 45000;
}

/**
 * Controversy: total volume weighted by how evenly the vote splits. Zero when
 * either side is empty, so a unanimous post never surfaces here however popular.
 */
export function controversyRank(
  post: Pick<Post, "upvotes" | "downvotes">,
): number {
  const { upvotes, downvotes } = post;
  if (upvotes === 0 || downvotes === 0) return 0;

  const magnitude = upvotes + downvotes;
  const balance =
    Math.min(upvotes, downvotes) / Math.max(upvotes, downvotes);
  return Math.pow(magnitude, balance);
}

/** Cutoff timestamp for a `top` window, or null for all time. */
export function windowCutoff(window: PostWindow | undefined): Date | null {
  const now = Date.now();
  if (window === "day") return new Date(now - 24 * 60 * 60 * 1000);
  if (window === "week") return new Date(now - 7 * 24 * 60 * 60 * 1000);
  return null;
}

/** Comparator for the in-memory store; newest-first breaks every tie. */
export function comparePosts(sort: PostSort): (a: Post, b: Post) => number {
  const byNewest = (a: Post, b: Post) => b.createdAt.localeCompare(a.createdAt);

  switch (sort) {
    case "new":
      return byNewest;
    case "top":
      return (a, b) => b.score - a.score || byNewest(a, b);
    case "controversial":
      return (a, b) =>
        controversyRank(b) - controversyRank(a) || byNewest(a, b);
    case "hot":
    default:
      return (a, b) => hotRank(b) - hotRank(a) || byNewest(a, b);
  }
}
