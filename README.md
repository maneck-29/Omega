# Hot Takes

A Reddit clone built with Next.js 16 (App Router), TypeScript, and Tailwind
CSS v4. Backend and frontend live in the same project — API route handlers
alongside server components.

## Getting started

```bash
npm install
npm run dev
```

The app runs at http://localhost:3000. Development fixtures seed themselves on
the first request.

## Scripts

| Script          | Description                  |
| --------------- | ---------------------------- |
| `npm run dev`   | Start the development server |
| `npm run build` | Production build             |
| `npm start`     | Serve the production build   |
| `npm run lint`  | Run ESLint                   |

## Team

Three workstreams; see [docs/integration-contract.md](docs/integration-contract.md)
for the seams between them.

| | Owner | Scope |
| --- | --- | --- |
| **TM1** | Authentication & User Management | registration, login, sessions, profiles, karma |
| **TM2** | Posts & Voting | post CRUD, listings, sorting, votes, search |
| **TM3** | Subreddits & Comments | subreddits, subscriptions, threaded comments, moderation |

TM3's slice is implemented. TM1's and TM2's are stubbed at the boundary
(`src/lib/auth.ts`, `src/lib/scores.ts`) so the three can proceed independently.

## Storage

No database has been chosen yet. Everything above the storage layer talks to the
`Repository` interface in `src/lib/repository.ts`, backed for now by an
in-memory implementation — state resets on restart and is not shared across
processes.

Adopting a database means implementing that interface once and changing a single
line in `src/lib/db.ts`.

## Development users

Authentication is stubbed. The active user is switchable with a `dev_user`
cookie, so permissions, moderation, and bans are testable before login exists:

```bash
curl -H "Cookie: dev_user=user-2" http://localhost:3000/api/me/subscriptions
```

`user-1` alice, `user-2` bob, `user-3` carol. Defaults to alice.

## Routes

Pages

| Route | Description |
| --- | --- |
| `/` | Home feed shell |
| `/subreddits` | Browse and search communities |
| `/subreddits/create` | Create a community |
| `/r/[subreddit]` | Subreddit page — rules, join, post list slot |
| `/r/[subreddit]/comments/[postId]` | Post page with threaded comments |

API — see [docs/integration-contract.md](docs/integration-contract.md) for the
full table.

## Project layout

```
src/
  app/                     routes (pages + API handlers)
  components/              UI components
  lib/
    types.ts               shared contract types between workstreams
    repository.ts          storage interface — doubles as the schema spec
    memory-repository.ts   in-memory implementation
    db.ts                  single swap point for storage
    auth.ts                STUB — owned by TM1
    scores.ts              STUB — owned by TM2
    subreddits.ts          subreddit + subscription + ban service
    comments.ts            threading, sorting, moderation
    seed.ts                shared development fixtures
docs/
  integration-contract.md  work division and integration seams
```

## Bundler note

`npm run build` and `npm run dev` pass `--webpack`. Next.js 16 defaults to
Turbopack, which requires native SWC bindings that need glibc 2.27+; on hosts
with older glibc (such as Amazon Linux 2, glibc 2.26) Next.js falls back to WASM
bindings and Turbopack refuses to run. Webpack works with the WASM fallback.
Drop the flags to use Turbopack on a supported platform.
