/**
 * Shared development fixtures.
 *
 * All three workstreams should seed from this so we test against identical data
 * and bug reports are reproducible. Post IDs are fixed strings TM2 can reuse
 * when their posts table lands.
 *
 * Idempotent: safe to call on every request path (see `ensureSeeded`).
 */

import { DEV_USERS } from "./auth";
import { getRepository } from "./db";
import { createComment } from "./comments";
import { createSubreddit } from "./subreddits";

/** Stable IDs so TM2 can attach real posts to these threads later. */
export const FIXTURE_POSTS = {
  typescript: "post-fixture-1",
  webdev: "post-fixture-2",
} as const;

let seeding: Promise<void> | null = null;

async function seed(): Promise<void> {
  const repo = getRepository();

  // Cheap idempotency guard for the in-memory store.
  if ((await repo.countSubreddits()) > 0) return;

  const [alice, bob, carol] = DEV_USERS;

  const typescript = await createSubreddit({
    name: "typescript",
    description: "Discussion about TypeScript, types, and tooling.",
    createdBy: alice.id,
  });

  const webdev = await createSubreddit({
    name: "webdev",
    description: "Everything web development.",
    createdBy: bob.id,
  });

  await createSubreddit({
    name: "HotTakes",
    description: "Opinions that should be controversial but are not.",
    createdBy: carol.id,
  });

  await repo.addRule(typescript.id, "Stay on topic", "Posts must relate to TypeScript.");
  await repo.addRule(typescript.id, "Be civil", "No personal attacks.");
  await repo.addRule(webdev.id, "No self-promotion", "Share knowledge, not ads.");

  // Cross-subscriptions so feed and counter behaviour is visible.
  await repo.subscribe(bob.id, typescript.id);
  await repo.subscribe(carol.id, typescript.id);
  await repo.subscribe(alice.id, webdev.id);

  // A nested thread exercising depth, replies, and a tombstone.
  const root = await createComment({
    postId: FIXTURE_POSTS.typescript,
    subredditId: typescript.id,
    authorId: bob.id,
    body: "Satisfies is the most underrated operator in the language.",
  });

  const reply = await createComment({
    postId: FIXTURE_POSTS.typescript,
    subredditId: typescript.id,
    parentCommentId: root.id,
    authorId: carol.id,
    body: "Agreed — it keeps inference while still checking the shape.",
  });

  await createComment({
    postId: FIXTURE_POSTS.typescript,
    subredditId: typescript.id,
    parentCommentId: reply.id,
    authorId: alice.id,
    body: "It replaced almost every `as const` cast I used to write.",
  });

  const doomed = await createComment({
    postId: FIXTURE_POSTS.typescript,
    subredditId: typescript.id,
    parentCommentId: root.id,
    authorId: alice.id,
    body: "This comment will be deleted by its author.",
  });

  // Reply first, then delete the parent: the tombstone must keep this reachable.
  await createComment({
    postId: FIXTURE_POSTS.typescript,
    subredditId: typescript.id,
    parentCommentId: doomed.id,
    authorId: carol.id,
    body: "Reply under a deleted parent — should still render.",
  });

  await repo.softDeleteComment(doomed.id);

  await createComment({
    postId: FIXTURE_POSTS.webdev,
    subredditId: webdev.id,
    authorId: alice.id,
    body: "Server components changed how I structure data loading.",
  });
}

/**
 * Seeds once per process. Concurrent callers await the same promise, so parallel
 * requests during startup cannot double-seed.
 */
export function ensureSeeded(): Promise<void> {
  seeding ??= seed().catch((error) => {
    // Allow a retry on the next request rather than caching the failure.
    seeding = null;
    throw error;
  });
  return seeding;
}
