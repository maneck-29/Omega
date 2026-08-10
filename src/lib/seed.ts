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

  await seedPosts({
    typescript: typescript.id,
    webdev: webdev.id,
    users: [alice.id, bob.id, carol.id],
  });
}

/**
 * Post and vote fixtures — owned by TM2 (Posts & Voting).
 *
 * Vote spreads and ages are deliberately varied so the four ranking modes
 * visibly disagree: an old high-scoring post leads `top` but not `hot`, a fresh
 * one climbs `hot`, and near-even splits lead `controversial`.
 *
 * Real vote rows are inserted rather than counters being set directly, because
 * casting a vote recomputes tallies from the votes table — counters written by
 * hand would be overwritten by the first real vote.
 */
async function seedPosts(context: {
  typescript: string;
  webdev: string;
  users: string[];
}): Promise<void> {
  const repo = getRepository();

  // Idempotency: the outer seed() only runs once per process, but a shared
  // database may already be populated by another instance.
  const existing = await repo.listPosts({ limit: 1 });
  if (existing.length > 0) return;

  const [alice, bob, carol] = context.users;

  const hoursAgo = (hours: number) =>
    new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  /*
   * Vote counts are kept small on purpose. Each cast recomputes the target's
   * tallies, so seeding hundreds of votes per post would mean hundreds of
   * sequential recomputes on first request. A couple of dozen is enough to make
   * the ranking modes disagree.
   */
  const fixtures: Array<{
    subredditId: string;
    authorId: string;
    title: string;
    body: string;
    postType: "text" | "link" | "image";
    url: string | null;
    imageUrl: string | null;
    ageHours: number;
    up: number;
    down: number;
  }> = [
    {
      subredditId: context.typescript,
      authorId: bob,
      title:
        "Type inference is a crutch and explicit return types are self-documenting",
      body: "Every signature you write down is a decision you do not have to re-derive later.",
      postType: "text",
      url: null,
      imageUrl: null,
      ageHours: 30,
      up: 21,
      down: 19, // near-even split: leads `controversial`
    },
    {
      subredditId: context.typescript,
      authorId: alice,
      title: "`any` should require a written justification in the PR description",
      body: "",
      postType: "text",
      url: null,
      imageUrl: null,
      ageHours: 1,
      up: 14,
      down: 1, // fresh with a solid score: leads `hot`
    },
    {
      subredditId: context.webdev,
      authorId: carol,
      title:
        "Remote work did not kill company culture, it revealed which companies never had one",
      body: "The free snacks were not culture. Say it with me.",
      postType: "text",
      url: null,
      imageUrl: null,
      ageHours: 50,
      up: 60,
      down: 4, // oldest but highest score: leads `top`, never `hot`
    },
    {
      subredditId: context.webdev,
      authorId: bob,
      title: "My desk setup after three years of 'I will tidy the cables later'",
      body: "",
      postType: "image",
      url: null,
      imageUrl: "https://picsum.photos/seed/hottakes-desk/900/700",
      ageHours: 7,
      // 3x the score of the newest post, which is enough to overcome a 6h age
      // gap in the hot formula: leads `hot` while `new` leads with the 1h post.
      up: 45,
      down: 2,
    },
    {
      subredditId: context.webdev,
      authorId: alice,
      title: "Found the real documentation and it was a five year old blog post",
      body: "As is tradition.",
      postType: "link",
      url: "https://example.com/why-the-docs-are-always-a-blog-post",
      imageUrl: null,
      ageHours: 14,
      up: 12,
      down: 1,
    },
    {
      subredditId: context.typescript,
      authorId: carol,
      title: "Standing desks are a socially acceptable way to pace during meetings",
      body: "",
      postType: "text",
      url: null,
      imageUrl: null,
      ageHours: 38,
      up: 15,
      down: 14, // second `controversial` contender
    },
    {
      subredditId: context.webdev,
      authorId: carol,
      title: "Sunset over the office car park. Peak corporate beauty.",
      body: "",
      postType: "image",
      url: null,
      imageUrl: "https://picsum.photos/seed/hottakes-sunset/900/600",
      ageHours: 26,
      up: 16,
      down: 2,
    },
    {
      subredditId: context.typescript,
      authorId: alice,
      title:
        "Every meeting that could have been an email becomes a recurring meeting",
      body: "",
      postType: "text",
      url: null,
      imageUrl: null,
      ageHours: 2,
      up: 4,
      down: 1,
    },
  ];

  for (const fixture of fixtures) {
    const post = await repo.createPost({
      subredditId: fixture.subredditId,
      authorId: fixture.authorId,
      title: fixture.title,
      body: fixture.body,
      postType: fixture.postType,
      url: fixture.url,
      imageUrl: fixture.imageUrl,
      createdAt: hoursAgo(fixture.ageHours),
    });

    // Synthetic voter ids, so the fixture spread survives a real vote landing.
    for (let i = 0; i < fixture.up; i += 1) {
      await repo.castVote("post", post.id, `seed-up-${post.id}-${i}`, 1);
    }
    for (let i = 0; i < fixture.down; i += 1) {
      await repo.castVote("post", post.id, `seed-down-${post.id}-${i}`, -1);
    }
  }
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
