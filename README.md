# Hot Takes

An anonymous opinion board. Post a take, vote on other people's, argue in the
replies. No login required.

Next.js 16 (App Router) with TypeScript and Tailwind CSS v4, deployed on AWS
Omega.

## Getting started

```bash
npm install
npm run dev
```

The app runs at http://localhost:3000 and seeds itself with demo content on
first load.

## This slice: Posts & Voting

| Feature | Notes |
| ------- | ----- |
| Create / edit / delete posts | Text, link and image types. Soft delete. |
| Sorting | `hot`, `new`, `top`, `controversial` |
| Voting | Posts **and** comments, one vote per visitor, toggle and flip |
| Search & filtering | Body/URL search, filter by post type, time window for `top` |
| Pagination | Offset-based with infinite scroll |
| Comments | Threaded replies, independently votable |
| AI post generation | Amazon Bedrock drafts a take from a prompt |
| For You | Feed ranked by interests inferred from your upvotes |

## Storage

The app talks to PostgreSQL through a single adapter, `src/lib/db.ts`:

- **On Omega** it uses the `postgres` driver, which reads the libpq variables
  (`PGHOST`, `PGUSER`, `PGDATABASE`, `PGPORT`, `PGSSLMODE`) that the Aurora DSQL
  integration injects. Selected automatically whenever `PGHOST` is set.
- **Locally** it falls back to [PGlite](https://pglite.dev) — PostgreSQL compiled
  to WASM — persisted to `.pglite/`. No Docker and no cluster needed to develop.

Both run the *same* SQL, so there is no second code path to drift. The SQL is
kept DSQL-compatible throughout: no `FOREIGN KEY`, no array columns,
application-generated UUID primary keys, `CREATE INDEX ASYNC`, and one DDL
statement per transaction.

Delete `.pglite/` to reset local data; the demo content re-seeds on next load.

## Identity

There are no accounts yet. Each visitor gets a random UUID in an httpOnly
cookie (`ht_owner`) on their first write, which acts as both author identity
(so you can edit and delete your own posts) and vote identity (so one browser is
one vote).

`src/lib/identity.ts` resolves a `voterKey` as `userId ?? ownerToken`. When the
accounts slice lands it only has to populate `userId` — signed-in users are then
deduplicated by account, anonymous visitors keep working, and no data migration
is needed because `posts` and `votes` already carry both columns.

The owner token is a bearer credential, so it is never serialised to the
browser. Ownership is resolved server-side and exposed only as `is_owner`.

## Ranking

| Sort | Ordering |
| ---- | -------- |
| `hot` | `log10(max(abs(score),1)) + sign(score) * age_seconds / 45000` — lets a fresh post outrank a stale high-scorer |
| `new` | `created_at desc` |
| `top` | `score desc`, optionally within a 24h or 7d window |
| `controversial` | `(up+down) ^ (min(up,down)/max(up,down))` — high volume *and* an even split; zero when either side is empty |

Vote tallies are recomputed from the `votes` table in a single
`UPDATE ... FROM` statement rather than incremented in place, so they cannot
drift under concurrent voting.

## AI

`src/lib/ai.ts` calls Bedrock's Converse API, trying the cheapest suitable
models first (`nova-micro`, then `nova-lite`, then `claude-haiku`). Override with
`BEDROCK_MODEL_ID`.

Both AI features degrade gracefully: if Bedrock is unreachable, generation falls
back to a local template and interest inference falls back to term frequency,
each reporting `source: "fallback"` so the UI can say so. The app stays fully
usable with no Bedrock integration wired at all.

## API

| Method | Route | Description |
| ------ | ----- | ----------- |
| `GET` | `/api/health` | Service health and uptime |
| `GET` | `/api/posts` | Feed. Params: `sort`, `q`, `type`, `window`, `parentId`, `mine`, `limit`, `offset` |
| `POST` | `/api/posts` | Create a post or reply |
| `GET` | `/api/posts/:id` | Read one post |
| `PATCH` | `/api/posts/:id` | Edit a post you own |
| `DELETE` | `/api/posts/:id` | Soft-delete a post you own |
| `POST` | `/api/votes` | Vote. Body: `{ targetId, value: 1 \| -1, targetType }` |
| `POST` | `/api/ai/generate` | Draft a take. Body: `{ prompt, tone? }` |

`sort=foryou` on `/api/posts` returns the personalised feed.

## Project layout

```
src/
  app/
    api/health/route.ts        Health endpoint
    api/posts/route.ts         Feed listing + create
    api/posts/[id]/route.ts    Read, edit, delete
    api/votes/route.ts         Voting
    api/ai/generate/route.ts   Bedrock post generation
    components/
      feed.tsx                 Sort tabs, search, infinite scroll
      post-card.tsx            A post, with voting and owner controls
      comment-thread.tsx       Lazy-loaded replies
      composer.tsx             Bottom-sheet composer with type toggle + AI
      bottom-nav.tsx           Fixed bottom navigation
      vote-control.tsx         Optimistic up/down control
      format.ts                Time-ago and avatar helpers
    layout.tsx                 Root layout
    page.tsx                   Feed (server-rendered first page)
  lib/
    db.ts                      Query adapter: DSQL on Omega, PGlite locally
    identity.ts                Anonymous owner token
    posts.ts                   Post CRUD, ranking, search, pagination
    votes.ts                   Polymorphic voting engine
    ai.ts                      Bedrock generation + For You ranking
    seed.ts                    Demo content
    http.ts                    Shared route-handler helpers
```

## Bundler note

`npm run build` and `npm run dev` pass `--webpack`. Next.js 16 defaults to
Turbopack, which requires native SWC bindings that need glibc 2.27+; on hosts
with older glibc (such as Amazon Linux 2, glibc 2.26) Next.js falls back to WASM
bindings and Turbopack refuses to run. Webpack works with the WASM fallback.
Drop the flags to use Turbopack on a supported platform.
