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
import { isMediaConfigured, migratedUrl } from "./media";
import { createSubreddit } from "./subreddits";

/**
 * Stable IDs so the fixture comment threads and the fixture posts refer to the
 * same rows.
 *
 * These must be real UUIDs. `posts.id` and `comments.post_id` are both UUID
 * columns, so a readable placeholder like "post-fixture-1" inserts fine into the
 * in-memory store but is rejected outright by Aurora DSQL — the kind of
 * difference that only shows up after deployment. Fixed literals keep the
 * reproducibility that readable ids were there for.
 */
export const FIXTURE_POSTS = {
  typescript: "11111111-1111-4111-8111-111111111111",
  webdev: "22222222-2222-4222-8222-222222222222",
} as const;

/**
 * Fixture community icons, as inline SVG data URLs.
 *
 * Inlined rather than served from `public/` or S3 for two reasons. The sign-in
 * gate covers everything except `_next/static` and a short allowlist, so a file
 * under `public/` redirects to `/login` for a signed-out reader and would need
 * the same allowlist exemption `/api/media` already needed. And S3 is not
 * provisioned, so a bucket URL would 404.
 *
 * A data URL renders with no request at all, which sidesteps both. These are
 * deliberately tiny — a circle and a glyph, a few hundred bytes each — because
 * the value lives in a column that is read on every page render. Real uploads go
 * through `POST /api/subreddits/[slug]/images`; this is only so the fixture
 * communities are visually distinct out of the box.
 *
 * `SubredditIcon` still falls back to a slug-derived gradient when a community
 * has no icon, so nothing here is load-bearing.
 */
function svgIcon(background: string, glyph: string): string {
  // No newlines: a data URL cannot contain raw line breaks. `#` is percent-
  // encoded because it would otherwise start a fragment and truncate the colour.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="32" fill="${background}"/>` +
    `<text x="32" y="33" font-family="ui-sans-serif,system-ui,sans-serif" ` +
    `font-size="30" font-weight="700" fill="#ffffff" text-anchor="middle" ` +
    `dominant-baseline="central">${glyph}</text>` +
    `</svg>`;

  return `data:image/svg+xml,${svg.replace(/#/g, "%23").replace(/"/g, "'")}`;
}

const FIXTURE_ICONS = {
  // TypeScript blue, with the language's own initials.
  typescript: svgIcon("#3178c6", "TS"),
  // Web orange, angle bracket for markup.
  webdev: svgIcon("#e34f26", "&lt;/&gt;"),
  // Hot pink, flame for "hot" takes.
  hottakes: svgIcon("#db2777", "🔥"),
} as const;

let seeding: Promise<void> | null = null;

async function seed(): Promise<void> {
  const repo = getRepository();

  // Subreddits, subscriptions and comment threads are seeded only when the
  // board is empty. Post fixtures are handled separately below, because they
  // must still appear on a database that was seeded before posts existed.
  if ((await repo.countSubreddits()) === 0) {
    await seedSubredditsAndComments();
  }

  // Always attempted; guards on its own emptiness and resolves subreddits by
  // slug, so it works whether or not the block above just ran.
  await seedPosts();

  await repairImageUrls();
}

/**
 * Rewrites stored image URLs that point at the S3 regional endpoint.
 *
 * Images uploaded before they were served through the app hold an absolute S3
 * URL, and Omega blocks public access on its buckets, so those render as 403 in a
 * browser even though the object is intact and the app can read it. Only the URL
 * is wrong, so this rewrites it to `/api/media/<key>`.
 *
 * Runs on every seed rather than only on an empty board, because the rows needing
 * it are precisely the ones that already exist. It is a no-op once migrated, and
 * a no-op entirely when S3 is not configured.
 */
async function repairImageUrls(): Promise<void> {
  if (!isMediaConfigured()) return;

  const repo = getRepository();
  const subreddits = await repo.listSubreddits({ limit: 1000 });

  for (const subreddit of subreddits) {
    const bannerUrl = migratedUrl(subreddit.bannerUrl);
    const iconUrl = migratedUrl(subreddit.iconUrl);

    if (!bannerUrl && !iconUrl) continue;

    await repo.updateSubreddit(subreddit.id, {
      ...(bannerUrl ? { bannerUrl } : {}),
      ...(iconUrl ? { iconUrl } : {}),
    });

    console.info(
      `Rewrote S3 endpoint URL(s) for r/${subreddit.slug} to /api/media`,
    );
  }
}

async function seedSubredditsAndComments(): Promise<void> {
  const repo = getRepository();

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

  const hottakes = await createSubreddit({
    name: "HotTakes",
    description: "Opinions that should be controversial but are not.",
    createdBy: carol.id,
  });

  /*
   * Icons are written straight to the repository rather than passed to
   * `createSubreddit`, which runs them through `validateOptionalUrl`. That
   * rejects any scheme other than http(s) — the guard that stops a
   * `javascript:` URL reaching an `<img src>` — and a `data:` URL is caught by
   * the same rule. Relaxing it to admit these fixtures would weaken a real
   * check for cosmetic seed data, so the write goes through the same path
   * uploads use for server-built values.
   */
  await repo.updateSubreddit(typescript.id, {
    iconUrl: FIXTURE_ICONS.typescript,
  });
  await repo.updateSubreddit(webdev.id, { iconUrl: FIXTURE_ICONS.webdev });
  await repo.updateSubreddit(hottakes.id, { iconUrl: FIXTURE_ICONS.hottakes });

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
async function seedPosts(): Promise<void> {
  const repo = getRepository();

  // Idempotency: seed() runs once per process, but a shared database may already
  // be populated by another instance or an earlier deployment.
  const existing = await repo.listPosts({ limit: 1 });
  if (existing.length > 0) return;

  /*
   * Resolved by slug rather than passed in, so post fixtures also land on a
   * database that was seeded before the posts table existed. Previously this ran
   * inside seed()'s "already seeded" early return, which meant an existing
   * deployment never got them.
   */
  const [typescriptSub, webdevSub] = await Promise.all([
    repo.getSubredditBySlug("typescript"),
    repo.getSubredditBySlug("webdev"),
  ]);

  if (!typescriptSub || !webdevSub) return;

  const context = {
    typescript: typescriptSub.id,
    webdev: webdevSub.id,
  };

  const [alice, bob, carol] = DEV_USERS.map((user) => user.id);

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
    /** Set for the two posts the fixture comment threads hang off. */
    id?: string;
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
      // The fixture comment thread for r/typescript hangs off this post.
      id: FIXTURE_POSTS.typescript,
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
      // The fixture comment thread for r/webdev hangs off this post.
      id: FIXTURE_POSTS.webdev,
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
      id: fixture.id,
    });

    /*
     * Synthetic voter ids, so the fixture spread survives real votes landing on
     * top of it. Recorded in one batch: castVote refreshes tallies per call, so
     * casting these individually would be hundreds of transactions on DSQL.
     */
    const votes: Array<{ voterId: string; value: 1 | -1 }> = [
      ...Array.from({ length: fixture.up }, (_, i) => ({
        voterId: `seed-up-${post.id}-${i}`,
        value: 1 as const,
      })),
      ...Array.from({ length: fixture.down }, (_, i) => ({
        voterId: `seed-down-${post.id}-${i}`,
        value: -1 as const,
      })),
    ];

    await repo.recordVotes("post", post.id, votes);
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
