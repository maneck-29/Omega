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
| S3 | `BUCKET_NAME`, `BUCKET_REGION` | banner/icon URL fields |
| Bedrock | `BEDROCK_REGION` | AI triage hidden, endpoint returns 403 |

## Account prerequisite

Provisioning currently fails in account `207099225924`:

```
Unable to assume the OmegaServiceRole in your account
```

`aws iam get-role --role-name OmegaServiceRole` confirms the role does not exist,
so account onboarding is incomplete. Integration code is written against the
documented contract but **has not run against real resources**.

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
the image it replaced.

Implementation notes in `src/lib/media.ts`:

- **Magic-byte sniffing.** `file.type` is browser-supplied and trivially
  spoofed, so the declared type is checked against the file's actual signature.
  A mismatch is rejected.
- **SVG is not allowed.** It can carry script, and these images are rendered on
  a page that shows untrusted content.
- **4 MB limit.** Uploads pass through the route handler and API Gateway caps a
  request body at 6 MB. Larger files would need a presigned URL so the browser
  uploads to S3 directly.
- **Keys are `subreddits/<id>/<kind>-<uuid>.<ext>`.** Prefixed per community so
  lifecycle rules or bulk deletes can target one subreddit, and UUID-suffixed so
  a replacement never collides or serves a stale cached object. That also makes
  every object immutable, hence the one-year `Cache-Control`.
- **Replacement deletion is best-effort.** A leaked object beats failing an
  upload that already succeeded.

## Bedrock — moderation triage

```bash
omega integration create --name hot-takes-ai --type bedrock \
  --type-config use-case=<use-case>,company-name=<name>,company-website=<url>
omega integration connect --name hot-takes-ai --env preview
```

Model access must also be enabled in the Bedrock console. The model id lives in
code (`src/lib/moderation-ai.ts`); only `BEDROCK_REGION` is injected.

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

## Verified so far

Against the in-memory store, with no integrations connected:

- Pages render; the edit page hides the uploader and explains the URL fallback
- Both endpoints return 403 with an actionable message, not a 500

With fake bucket variables, to exercise validation ahead of the network call:

- Text bytes declared as `image/png` → 400 `not_an_image`
- `image/svg+xml` → 400 `unsupported_type`
- 5 MB file → 400 `file_too_large`
- `kind=avatar` → 400 `invalid_kind`
- Non-moderator → 403 `not_moderator`
- Valid PNG → clears validation and reaches S3, failing only on the fake bucket

Not yet verified: a real upload, and any Bedrock call. Both need provisioning.
