# Integration contract

Work division for the Reddit clone, and the seams between the three
workstreams. TM3 owns this document; changes to shared types or the
integration points below should be reviewed by whoever owns the other side.

| | Owner | Scope |
| --- | --- | --- |
| **TM1** | Authentication & User Management | registration, login, sessions, profiles, karma |
| **TM2** | Posts & Voting | post CRUD, listings and sorting, votes, search, pagination |
| **TM3** | Subreddits & Comments | subreddits, subscriptions, threaded comments, moderation |

## Status

TM3's slice is implemented and verified end to end. Aurora DSQL is wired up
behind the repository interface; behaviour was exercised against the in-memory
implementation, which reproduces the same semantics (see
[database.md](database.md)).

TM2's slice is implemented: post CRUD, the four sorts, polymorphic voting for
posts and comments, search, filtering and pagination. `src/lib/scores.ts` is a
real `ScoreProvider` and `VOTING_AVAILABLE` is `true`, so score-dependent
comment sorts no longer degrade to chronological.

One stub remains:

- `src/lib/auth.ts` — TM1 replaces `getCurrentUser()` and `getUsersByIds()`

## Storage

**Amazon Aurora DSQL** (serverless distributed PostgreSQL) via Drizzle. See
[database.md](database.md) for setup, the migration, and the DSQL-specific
constraints that shaped the schema.

Everything above storage talks to the `Repository` interface in
`src/lib/repository.ts`; no service, route, or page imports a concrete
repository. Two implementations satisfy it:

- `dsql-repository.ts` — used when `PGHOST` is set
- `memory-repository.ts` — local development with no AWS credentials

Two DSQL constraints reach into everyone's code:

- **No foreign keys.** Referential integrity is enforced in the service layer,
  which conveniently means no team's table has to exist before another team can
  write rows that reference it.
- **Optimistic concurrency.** Conflicts surface at commit and the transaction is
  retried, so anything inside `withTransaction()` must be idempotent, and
  counters must be updated relatively rather than read-then-written.

`src/lib/repository.ts` also documents the storage contract — method signatures
name the tables, keys, and constraints an implementation must reproduce:

- `subreddits.slug` — lowercased name, case-insensitive UNIQUE, the lookup key
- `subreddit_subscriptions` — composite PK `(user_id, subreddit_id)`, so a
  double subscribe is impossible at the storage layer
- `subreddits.subscriber_count` — denormalized, updated in the same transaction
  as the subscription insert/delete; avoids `COUNT(*)` per page render
- `comments.parent_comment_id` — adjacency list, nullable for top-level
- `comments.deleted_at` / `removed_at` — author deletion and moderator removal
  are separate columns, never a hard delete

## What TM3 needs

### From TM1

| Need | Why |
| --- | --- |
| `getCurrentUser()` server-side | every subreddit and comment write is gated on identity |
| stable `user.id` | FK target for `created_by`, `author_id`, moderators, bans |
| `username`, `avatarUrl` | comment bylines |
| batched `getUsersByIds()` | avoids N+1 when rendering a thread |

The stub supports switching the active user with a `dev_user` cookie
(`user-1` alice, `user-2` bob, `user-3` carol), which is how permissions and
bans are testable before login exists.

### From TM2

All four are delivered:

| Need | Status |
| --- | --- |
| votes keyed by `(target_type, target_id)` | `votes` table, composite PK `(target_type, target_id, voter_id)` |
| `ScoreProvider` implementation | `src/lib/scores.ts`, backed by `Repository.getScores` |
| `removed_at` / `removed_by` on `posts` | columns exist; set via `POST /api/subreddits/[slug]/moderation/posts`, and excluded from every listing, sort and search by the repository filter |
| post list component accepting `subredditId` | `src/components/post-list.tsx`, rendered through `post-list-slot.tsx` |

`VOTING_AVAILABLE` is now `true`, so vote controls render and `best`, `top` and
`controversial` comment sorts use real scores.

Two notes for whoever provisions the cluster:

- `posts` and `votes` DDL is in `drizzle/0001_posts_votes.sql`, a separate file
  because DSQL allows one DDL statement per transaction
- vote tallies on `posts` are recomputed from the `votes` table inside the vote
  transaction rather than incremented, so the write stays idempotent under OCC
  retries; `Repository.recordVotes` is the bulk path used by fixtures

## What TM3 provides

### To TM1

- `author_id` on every comment, for karma aggregation
- `listModeratedSubreddits(userId)` — "moderator of" on profile pages
- `listCommentsByAuthor(authorId)` — comment history on profiles

### To TM2

| Export | Location | Purpose |
| --- | --- | --- |
| `getSubscribedSubredditIds(userId)` | `lib/subreddits.ts` | home feed = posts from subscribed subreddits |
| `assertCanPost(userId, slug)` | `lib/permissions.ts` | **call before creating a post** |
| `getSubredditBySlugOrThrow(slug)` | `lib/subreddits.ts` | resolve `/r/[subreddit]` route param |
| `listSubreddits()` | `lib/subreddits.ts` | subreddit picker on the create-post form |
| `getCommentCount(postId)` | `lib/comments.ts` | comment count per post |

`GET /api/me/subscriptions` exposes the same subscription data over HTTP for
client components.

## Three seams that break quietly

1. **Voting must be generic.** If TM2's vote table is keyed `post_id` rather
   than `(target_type, target_id)`, comment voting becomes a second parallel
   system. This is the cheapest thing to get right early and the most expensive
   to retrofit.

2. **Ban enforcement is cross-cutting.** TM3 enforces bans on comment writes,
   but TM2 must call `assertCanPost` in the post-creation path. Without that
   call the ban only looks enforced — banned users keep posting.

3. **Removed content must be filtered in TM2's queries.** TM3 sets
   `removed_at`; every listing, sort, search, and pagination query on TM2's side
   has to exclude those rows, or moderator-removed posts keep appearing.

## Routing ownership

App Router means shared directories, so ownership is per-file:

| Route | Owner |
| --- | --- |
| `/` | TM3 shell, TM2 feed component |
| `/r/[subreddit]` | TM3 shell, TM2 post list in the slot |
| `/r/[subreddit]/comments/[postId]` | TM3 shell + thread, TM2 post body |
| `/r/[subreddit]/submit` | TM2 |
| `/subreddits`, `/subreddits/create` | TM3 |
| `/u/[username]`, `/settings` | TM1 |

Shared types live in `src/lib/types.ts`.

## Comment threading

Adjacency list (`parentCommentId`). All comments for a post are fetched in one
query and the tree is assembled in memory — one round-trip, and fine up to
roughly a thousand comments per post. Recursive CTEs or a closure table are the
escalation path if that ceiling is measured, not before.

Two behaviours worth preserving:

- **Soft delete only.** A deleted comment keeps its row and renders as a
  tombstone, so replies beneath it stay reachable. Hard-deleting orphans the
  subtree. Bodies of deleted and removed comments are redacted server-side
  before they reach a client.
- **Depth cap at 8.** Deeper replies render a "continue this thread" link that
  re-roots the view at that comment, so nothing is unreachable.

## API

Subreddits

| Method | Route |
| --- | --- |
| `GET` | `/api/subreddits` — browse, `?q=`, `?sort=popular\|new\|name` |
| `POST` | `/api/subreddits` — create (creator becomes owner-mod + subscriber) |
| `GET` | `/api/subreddits/[slug]` — includes viewer flags |
| `PATCH` | `/api/subreddits/[slug]` — settings, moderator only |
| `GET`/`POST` | `/api/subreddits/[slug]/rules` |
| `PUT`/`DELETE` | `/api/subreddits/[slug]/subscription` — idempotent |

Comments

| Method | Route |
| --- | --- |
| `GET` | `/api/posts/[postId]/comments` — `?sort=`, `?rootId=` |
| `POST` | `/api/posts/[postId]/comments` — create or reply |
| `PATCH` | `/api/comments/[commentId]` — author only |
| `DELETE` | `/api/comments/[commentId]?subreddit=` — author or mod, soft delete |

Posts and voting (TM2)

| Method | Route |
| --- | --- |
| `GET` | `/api/posts` — feed. `?sort=hot\|new\|top\|controversial\|foryou`, `?q=`, `?type=text\|link\|image`, `?window=day\|week\|all`, `?subreddit=`, `?feed=subscribed`, `?author=`, `?limit=`, `?offset=` |
| `POST` | `/api/posts` — create a post |
| `GET`/`PATCH`/`DELETE` | `/api/posts/[postId]` — read, edit, soft-delete (author only) |
| `POST` | `/api/votes` — `{ targetId, value: 1 \| -1, targetType: post \| comment }` |
| `POST` | `/api/ai/generate` — Bedrock-drafted post title |

Moderation

| Method | Route |
| --- | --- |
| `POST` | `/api/subreddits/[slug]/moderation/comments` — remove/approve |
| `POST` | `/api/subreddits/[slug]/moderation/posts` — remove/approve (TM2) |
| `GET`/`POST`/`DELETE` | `/api/subreddits/[slug]/moderation/bans` |
| `GET` | `/api/subreddits/[slug]/moderation/log` — audit trail |
| `PATCH`/`DELETE` | `/api/subreddits/[slug]/rules/[ruleId]` |
| `PUT` | `/api/subreddits/[slug]/rules/reorder` — complete id list |

Moderator pages: `/r/[subreddit]/about/edit` (settings and rules),
`/about/banned`, `/about/log`.

## Fixtures

`src/lib/seed.ts` seeds three subreddits, cross-subscriptions, and a nested
thread that includes a deleted-parent-with-reply case. Seeding is idempotent and
runs on first request.

Post IDs `post-fixture-1` and `post-fixture-2` are stable, so TM2 can attach
real posts to the existing threads.

## Open decisions

1. Provision the DSQL cluster and apply `drizzle/0000_init.sql`; until then
   `PGHOST` is unset and local development uses the in-memory store
2. Whether TM1 ships sessions or JWTs (does not affect the `getCurrentUser()`
   signature)
3. Whether the comment count lives on `posts` (TM2) or stays computed (TM3)
4. Whether TM1's `users` and TM2's `posts` tables join `drizzle/0000_init.sql` or
   get their own migrations — DSQL allows one DDL statement per transaction, so
   separate files are simpler to apply
