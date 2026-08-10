/**
 * Demo seed data.
 *
 * Seeding inserts real rows in `votes` rather than just setting the counters on
 * `posts`. The voting engine recomputes tallies from the votes table on every
 * cast, so counters written directly would be wiped by the first real vote.
 *
 * Vote spreads and post ages are deliberately varied so the four ranking modes
 * visibly disagree with each other:
 *   - a old post with a huge score dominates `top` but not `hot`
 *   - a fresh post with a few votes climbs `hot`
 *   - near-even up/down splits dominate `controversial`
 */

import { query } from "./db";
import type { PostType } from "./posts";

interface SeedComment {
  body: string;
  up: number;
  down: number;
  ageMinutes: number;
}

interface SeedPost {
  body: string;
  postType: PostType;
  url?: string;
  imageUrl?: string;
  author: string;
  ageHours: number;
  up: number;
  down: number;
  comments?: SeedComment[];
}

const SEED_POSTS: SeedPost[] = [
  {
    body: "Pineapple on pizza is objectively correct and the people who disagree have simply never had a good one.",
    postType: "text",
    author: "anchovy_truther",
    ageHours: 30,
    up: 184,
    down: 172, // near-even: controversial winner
    comments: [
      { body: "This is the hill I die on too.", up: 12, down: 1, ageMinutes: 900 },
      { body: "Absolutely unhinged take.", up: 31, down: 4, ageMinutes: 700 },
      { body: "Sweet + salty is basic food science, cope.", up: 8, down: 6, ageMinutes: 200 },
    ],
  },
  {
    body: "Tabs vs spaces was never a real debate. Your editor renders whatever you want. Touch grass.",
    postType: "text",
    author: "whitespace_wizard",
    ageHours: 4,
    up: 96,
    down: 7,
    comments: [
      { body: "Finally someone said it.", up: 14, down: 0, ageMinutes: 120 },
      { body: "Tabs are an accessibility win actually.", up: 22, down: 2, ageMinutes: 60 },
    ],
  },
  {
    body: "Every meeting that could have been an email eventually becomes a recurring meeting.",
    postType: "text",
    author: "calendar_goblin",
    ageHours: 2,
    up: 58,
    down: 3,
    comments: [
      { body: "Do not put this in my calendar as a reminder.", up: 9, down: 0, ageMinutes: 45 },
    ],
  },
  {
    body: "Sunset over the office car park. Peak corporate beauty.",
    postType: "image",
    imageUrl: "https://picsum.photos/seed/hottakes-sunset/900/600",
    author: "golden_hour_andy",
    ageHours: 7,
    up: 141,
    down: 12,
    comments: [
      { body: "This is genuinely gorgeous.", up: 18, down: 0, ageMinutes: 300 },
      { body: "The parking lot really said cinematic.", up: 25, down: 1, ageMinutes: 180 },
    ],
  },
  {
    body: "My desk setup after three years of 'I will tidy the cables later'.",
    postType: "image",
    imageUrl: "https://picsum.photos/seed/hottakes-desk/900/700",
    author: "cable_spaghetti",
    ageHours: 1,
    up: 39,
    down: 2, // fresh + decent score: hot winner
    comments: [
      { body: "I can hear this photo.", up: 16, down: 0, ageMinutes: 20 },
      { body: "Velcro ties change lives.", up: 6, down: 0, ageMinutes: 10 },
    ],
  },
  {
    body: "Remote work did not kill company culture, it just revealed that some companies never had one.",
    postType: "text",
    author: "wfh_forever",
    ageHours: 52,
    up: 612,
    down: 44, // old + massive: top winner
    comments: [
      { body: "Brutal and accurate.", up: 47, down: 2, ageMinutes: 2000 },
      { body: "Culture was the free snacks. Say it.", up: 88, down: 5, ageMinutes: 1500 },
      { body: "Counterpoint: onboarding juniors remotely is genuinely hard.", up: 64, down: 9, ageMinutes: 1000 },
    ],
  },
  {
    body: "Dark mode is not a personality, but light mode at 2am is a cry for help.",
    postType: "text",
    author: "oled_enjoyer",
    ageHours: 11,
    up: 203,
    down: 31,
    comments: [
      { body: "Light mode users are simply built different.", up: 20, down: 3, ageMinutes: 480 },
    ],
  },
  {
    body: "The best code review comment is 'why does this exist' and it should be used more often.",
    postType: "text",
    author: "rubber_duck_rex",
    ageHours: 20,
    up: 167,
    down: 21,
    comments: [
      { body: "Deleting code is the highest form of contribution.", up: 34, down: 1, ageMinutes: 800 },
      { body: "My PRs would not survive this.", up: 11, down: 0, ageMinutes: 400 },
    ],
  },
  {
    body: "Found the actual documentation and it was a five year old blog post. As is tradition.",
    postType: "link",
    url: "https://example.com/why-the-docs-are-always-a-blog-post",
    author: "stackoverflow_native",
    ageHours: 14,
    up: 88,
    down: 9,
    comments: [
      { body: "The blog post is always someone's weekend project.", up: 13, down: 0, ageMinutes: 600 },
    ],
  },
  {
    body: "Standing desks are just a socially acceptable way to pace during meetings.",
    postType: "text",
    author: "ergonomic_menace",
    ageHours: 38,
    up: 124,
    down: 118, // second controversial contender
    comments: [
      { body: "I pace regardless of desk height.", up: 7, down: 2, ageMinutes: 1200 },
      { body: "Sitting is fine actually, this is propaganda.", up: 19, down: 17, ageMinutes: 900 },
    ],
  },
  {
    body: "Morning commute view. Almost worth leaving the house for.",
    postType: "image",
    imageUrl: "https://picsum.photos/seed/hottakes-commute/900/650",
    author: "train_window_pete",
    ageHours: 26,
    up: 97,
    down: 8,
  },
  {
    body: "Naming a variable 'data' should require a written justification.",
    postType: "text",
    author: "semantic_sam",
    ageHours: 6,
    up: 72,
    down: 5,
    comments: [
      { body: "data2 is where I draw the line.", up: 28, down: 0, ageMinutes: 240 },
    ],
  },
];

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

async function insertRow(options: {
  id: string;
  body: string;
  postType: PostType;
  url: string | null;
  imageUrl: string | null;
  author: string;
  parentId: string | null;
  createdAt: string;
}): Promise<void> {
  await query(
    `insert into posts
       (id, body, post_type, url, image_url, author_name, anon_owner_token,
        parent_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      options.id,
      options.body,
      options.postType,
      options.url,
      options.imageUrl,
      options.author,
      // Seeded content is owned by a reserved token, so no visitor can edit or
      // delete it by accident.
      "seed",
      options.parentId,
      options.createdAt,
    ],
  );
}

/**
 * Insert synthetic votes for a target and refresh its tallies.
 *
 * Votes are chunked well below DSQL's 3,000-row-per-transaction cap.
 */
async function insertVotes(
  targetId: string,
  up: number,
  down: number,
): Promise<void> {
  const rows: Array<[string, number]> = [];
  for (let i = 0; i < up; i += 1) rows.push([`seed-up-${targetId}-${i}`, 1]);
  for (let i = 0; i < down; i += 1) rows.push([`seed-down-${targetId}-${i}`, -1]);

  const CHUNK = 200;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];

    for (const [voterKey, value] of chunk) {
      params.push(crypto.randomUUID(), targetId, voterKey, value);
      const base = params.length - 4;
      values.push(
        `($${base + 1}, 'post', $${base + 2}, $${base + 3}, $${base + 4})`,
      );
    }

    await query(
      `insert into votes (id, target_type, target_id, voter_key, value)
       values ${values.join(", ")}`,
      params,
    );
  }

  await query(
    `update posts set
       up_count = c.up, down_count = c.down, score = c.up - c.down
     from (
       select
         coalesce(sum(case when value = 1 then 1 else 0 end), 0)::int as up,
         coalesce(sum(case when value = -1 then 1 else 0 end), 0)::int as down
       from votes where target_type = 'post' and target_id = $1
     ) c
     where posts.id = $1`,
    [targetId],
  );
}

async function insertSeedData(): Promise<number> {
  let inserted = 0;

  for (const post of SEED_POSTS) {
    const id = crypto.randomUUID();
    await insertRow({
      id,
      body: post.body,
      postType: post.postType,
      url: post.url ?? null,
      imageUrl: post.imageUrl ?? null,
      author: post.author,
      parentId: null,
      createdAt: hoursAgo(post.ageHours),
    });
    await insertVotes(id, post.up, post.down);
    inserted += 1;

    for (const comment of post.comments ?? []) {
      const commentId = crypto.randomUUID();
      await insertRow({
        id: commentId,
        body: comment.body,
        postType: "text",
        url: null,
        imageUrl: null,
        author: "anon",
        parentId: id,
        createdAt: minutesAgo(comment.ageMinutes),
      });
      await insertVotes(commentId, comment.up, comment.down);
      inserted += 1;
    }
  }

  return inserted;
}

let seedPromise: Promise<void> | null = null;

/**
 * Seed the demo content once, if the board is empty.
 *
 * The guard is a row in `app_meta` with a primary-key collision: whichever
 * instance inserts it first does the seeding, and any concurrent instance fails
 * that insert and skips. That is portable across both backends, unlike
 * ON CONFLICT, whose DSQL support is unconfirmed.
 */
export async function ensureSeeded(): Promise<void> {
  seedPromise ??= (async () => {
    await query(
      `create table if not exists app_meta (
         key text primary key,
         value text,
         created_at timestamptz not null default current_timestamp
       )`,
    );

    const existing = await query<{ count: number | string }>(
      `select count(*)::int as count from posts`,
    );
    if (Number(existing[0]?.count ?? 0) > 0) return;

    try {
      await query(`insert into app_meta (key, value) values ('seeded', 'in-progress')`);
    } catch {
      // Another instance claimed the seed. Nothing to do.
      return;
    }

    const inserted = await insertSeedData();
    await query(`update app_meta set value = $1 where key = 'seeded'`, [
      `${inserted} rows`,
    ]);
    console.log(`[seed] inserted ${inserted} demo rows`);
  })();

  try {
    await seedPromise;
  } catch (cause) {
    // Never let seeding failure break the feed.
    seedPromise = null;
    console.error("[seed] failed:", cause);
  }
}
