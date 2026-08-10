# Omega integrations

Wire integrations with the Omega CLI rather than by hand-editing `omega.jsonc`:

```bash
omega integration create --name <name> --type <type>
omega integration connect --name <name> --env preview
```

Integration variables reach the build and the server runtime only. Browser code
never sees them — they carry no `NEXT_PUBLIC_` prefix, which is why uploads and
model calls go through route handlers.

Every integration here is **optional**. Each feature checks for its variables and
degrades rather than failing, so `npm run dev` needs no AWS access.

| Integration | Variables | Without it |
| --- | --- | --- |
| Aurora DSQL | `PGHOST`, `PGUSER`, `PGDATABASE` | in-memory store |
| S3 | `BUCKET_NAME`, `BUCKET_REGION` | uploads inlined as `data:` URLs, 256 KB cap |
| Bedrock | `BEDROCK_REGION` | falls back to `AWS_REGION`; features degrade locally |

`GET /api/health` reports what is actually wired: the storage driver, the Bedrock
region and any models on cooldown, and whether S3 is backing uploads. Check it
first — a feature quietly serving fallback output otherwise looks identical to one
that is working.

## Account prerequisite

Provisioning currently fails in account `207099225924`:

```
Unable to assume the OmegaServiceRole in your account
```

`aws iam get-role --role-name OmegaServiceRole` confirms the role does not exist,
so account onboarding is incomplete. That account is no longer used (see the
renamed `DO-NOT-USE-infra-pdx-207099225924` profile); Bedrock has since been
exercised for real against the sandbox account `541943222423`. S3 still has not
run against a real bucket.

A failed attempt also left an orphaned bucket,
`omega-hot-takes-media-207099225924-20260810` — empty, tagged `ManagedBy: Omega`,
with no integration referencing it. Safe to delete once confirmed.

## S3 — subreddit images

```bash
omega integration create --name hot-takes-media --type s3
omega integration connect --name hot-takes-media --env preview
```

Note that S3 bucket names cannot contain underscores, and Omega derives the
bucket name from the integration name: `hot_takes_media` fails with
`InvalidBucketName`. Use hyphens.

`POST /api/subreddits/[slug]/images` (moderator only) takes multipart `file` and
`kind` (`banner` | `icon`), stores the object, updates the subreddit, and deletes
the image it replaced. `DELETE ...?kind=` clears one.

**Uploading works without S3.** When `BUCKET_NAME` is unset the bytes are inlined
into the record as a `data:` URL instead, capped at 256 KB. This exists because
uploading was previously impossible without AWS — the picker was hidden and the
only way to set an image was pasting a URL to one hosted somewhere else. Inlining
is not how this should work at scale: it puts bytes in a column that wants to hold
a reference, it is sent with every render of the page, and there is no object to
lifecycle-expire. It buys one upload flow that always works, and connecting S3
switches the same flow to the bucket and raises the cap to 4 MB.

Because an inlined image is a `data:` URL, it cannot go through the same
validation as a typed-in URL — `validateOptionalUrl` rejects non-http(s) schemes
so that `javascript:` cannot reach an `img src`. Uploads therefore write via
`setSubredditImage()`, which skips URL validation because the value was built
server-side from bytes this server sniffed. `PATCH /api/subreddits/[slug]` still
validates strictly, so a client cannot post a `data:` or `javascript:` URL.

Implementation notes in `src/lib/media.ts`:

- **Magic-byte sniffing.** `file.type` is browser-supplied and trivially
  spoofed, so the declared type is checked against the file's actual signature.
  A mismatch is rejected.
- **SVG is not allowed.** It can carry script, and these images are rendered on
  a page that shows untrusted content.
- **4 MB limit with S3, 256 KB inlined.** Uploads pass through the route handler
  and API Gateway caps a request body at 6 MB. Larger files would need a
  presigned URL so the browser uploads to S3 directly. The inline cap is far
  lower because base64 inflates by a third and the result lives in a row.
- **Keys are `subreddits/<id>/<kind>-<uuid>.<ext>`.** Prefixed per community so
  lifecycle rules or bulk deletes can target one subreddit, and UUID-suffixed so
  a replacement never collides or serves a stale cached object. That also makes
  every object immutable, hence the one-year `Cache-Control`.
- **Objects are served through `GET /api/media/<key>`, not from S3 directly.**
  Omega provisions buckets with all four public-access blocks enabled, so the S3
  regional endpoint returns 403 to a browser. Reading them back through the app
  keeps the bucket private instead of weakening protections that exist to stop an
  upload becoming a public host for arbitrary content. The route confines keys to
  the `subreddits/` prefix and sends `X-Content-Type-Options: nosniff`.
  `keyFromUrl` still recognises the old S3-endpoint form so images uploaded before
  this change stay deletable.
- **Replacement deletion is best-effort.** A leaked object beats failing an
  upload that already succeeded.

## Bedrock — triage, summaries, hot takes

```bash
omega integration create --name hot-takes-ai --type bedrock \
  --type-config use-case=<use-case>,company-name=<name>,company-website=<url>
omega integration connect --name hot-takes-ai --env preview
```

Model access must also be enabled in the Bedrock console. Model ids live in code;
only `BEDROCK_REGION` is injected.

All AI features share one client, model-candidate list and cooldown map in
`src/lib/bedrock.ts`. They previously did not, and the copies had drifted: one
resolved the region from `BEDROCK_REGION ?? AWS_REGION` and fell through several
models, the other required `BEDROCK_REGION` and hardcoded a single model id. The
result was AI triage reporting itself unconfigured in a deployment where hot-take
generation worked. Region resolution and model availability are properties of the
integration, not of a feature.

Three features use it:

| Feature | Entry point | Fallback with no Bedrock |
| --- | --- | --- |
| Comment triage | `POST /api/subreddits/[slug]/moderation/triage` | 403 with an actionable message |
| Thread TL;DR | `POST /api/posts/[postId]/summary` | excerpts the top comments |
| Hot-take drafting | `POST /api/ai/generate` | local template |

`POST /api/subreddits/[slug]/moderation/triage` (moderator only) takes `postId`
and returns the post's comments ranked by likely rule breach, judged against that
subreddit's own rules.

**It never removes anything.** Removal stays an explicit human action through the
existing moderation endpoint. An automated removal on a false positive is silent
censorship with no signal that it happened, so the model orders the queue and a
moderator decides.

Other deliberate constraints:

- **Claude Haiku.** Triage is short, high-volume classification; latency and cost
  matter more than depth.
- **Temperature 0.1** — a classification, not a creative task.
- **25 comments and 600 characters each per request**, so one call cannot fan out
  into an unbounded bill.
- **Verdicts are filtered to submitted ids**, so a hallucinated id cannot reach
  the UI, and `concern` is clamped to 0–1.
- **Scoped to one post**, because comments reference TM2's posts table and there
  is no post-to-subreddit mapping on this side. Once TM2 exposes posts by
  subreddit this can cover a whole community's queue.

## Thread TL;DR

`POST /api/posts/[postId]/summary` condenses a post's comment thread into two or
three sentences, a few bullets naming the distinct positions, and a tone
(`agreement` | `mixed` | `heated`). Open to any reader, including signed-out ones,
because it summarises content they can already read.

Rendered above the thread by `src/components/thread-summary.tsx`, behind a button:
a summary costs a model call and most readers open a thread to read it, so
fetching for everyone would spend money on people who scrolled past.

POST rather than GET despite being read-only — a GET invites prefetchers, link
previews and caches to trigger model calls nobody asked for.

Deliberate constraints in `src/lib/summary.ts`:

- **Tombstones are excluded before the prompt is built**, so deleted and
  moderator-removed bodies are never sent to a model. Same rule that redacts them
  for clients.
- **Cached per thread revision** — key is post id, comment count and newest
  timestamp, so a new reply or an edit invalidates it but a re-render does not pay
  for another call. A cache hit returns in about 40 ms against roughly 1.5 s for a
  live call.
- **Only Bedrock results are cached.** A fallback is cheap to recompute and must
  not be held, or the feature would serve extractive output for the life of the
  process after one transient failure.
- **Scored without a viewer.** `viewerVote` would vary the ranking per reader and
  make one cache entry wrong for everyone else.
- **Minimum 4 comments**, below which the UI does not offer it: a summary of three
  comments is longer than the comments.
- **40 comments, 700 characters each**, most-upvoted first, so one call cannot fan
  out into an unbounded bill.
- **The post title is resolved server-side**, not taken from the request, so a
  caller cannot steer the summary with a title the post does not have.
- **Fallback output is labelled in the UI.** An extractive excerpt otherwise looks
  exactly like a real summary, and a reader who cannot tell will trust the wrong
  thing.
- **The prompt forbids naming or quoting a commenter**, and forbids the model
  adding its own opinion or judging who is right.

## Verified so far

Against a live Bedrock in sandbox account `541943222423` (`us-west-2`, Nova Micro):

- Thread TL;DR returns `source: "bedrock"` with a coherent summary, and correctly
  reports `basedOn: 4` for a 5-comment thread whose fifth is a tombstone
- Adding a dissenting comment invalidated the cache and moved `tone` from
  `agreement` to `mixed` — the summary tracked the thread rather than being stale
- A repeat request served from cache in ~40 ms
- Comment triage returns a ranked queue and flagged the one combative comment
  (`concern: 0.6`) above four benign ones (`0.05`) — this endpoint previously
  reported itself unconfigured in exactly this setup
- Hot-take generation returns `source: "bedrock"` on the same shared client

Uploads, with **no** S3 connected (inline path):

- Valid PNG → 201, stored as a `data:` URL, rendered on `/r/[subreddit]` and in
  the `/subreddits` list
- Banner upload replaces the gradient; `DELETE ?kind=banner` restores it
- 469 KB PNG → 400 `file_too_large`, naming the 256 KB cap and pointing at S3
- Text bytes declared `image/png` → 400 `not_an_image`
- Non-moderator upload and delete → 403
- `kind=bogus` → 400 `invalid_kind`
- `PATCH` with a `data:` or `javascript:` icon URL → 400 `invalid_field`, so the
  upload path's relaxed validation did not widen the client-facing one
- Saving the settings form (description only) leaves both images intact

Degradation with Bedrock unreachable (expired credentials):

- TL;DR returned `source: "fallback"` with excerpted top comments and a note
- Failures were classified transient, so **no** cooldown was set and the next
  call with fresh credentials succeeded immediately

Deployed to preview against **real** integrations in sandbox `541943222423`
(DSQL `us-east-2`, Bedrock `us-east-2`, S3 `us-east-2`):

- `GET /api/health` reports `storage: "dsql"`, `bedrock.configured: true`,
  `media.configured: true` with the provisioned bucket name
- Thread TL;DR returned `source: "bedrock"` on a real thread, `basedOn: 4` from 5
  rows — the tombstone excluded, exactly as locally
- A 3-comment thread returned the "needs at least 4 comments" note rather than a
  summary, so the gate holds in the deployed environment too
- A real S3 upload succeeded end to end: 201, object written under
  `subreddits/<id>/icon-<uuid>.png`, and the URL stored and rendered
- Non-moderator upload → 403 against real DSQL moderator rows

That last upload is what surfaced the private-bucket problem: the object stored
and rendered fine but the S3 URL 403'd in a browser, because Omega blocks public
access. Hence `/api/media/<key>`. `BEDROCK_REGION` is `us-east-2`, where Claude
Haiku is unavailable but Nova Micro — first in the candidate list — is, so the
first attempt succeeds with no wasted calls.
