import { requireCurrentUser } from "@/lib/auth";
import { badRequest } from "@/lib/errors";
import {
  deleteObject,
  keyFromUrl,
  uploadSubredditImage,
  type MediaKind,
} from "@/lib/media";
import { assertModerator } from "@/lib/permissions";
import { handler } from "@/lib/route-helpers";
import {
  getSubredditBySlugOrThrow,
  setSubredditImage,
} from "@/lib/subreddits";

type Params = { params: Promise<{ slug: string }> };

const KINDS: MediaKind[] = ["banner", "icon"];

/**
 * POST /api/subreddits/[slug]/images — upload a banner or icon. Moderator only.
 *
 * Multipart body: `file` and `kind` ("banner" | "icon").
 *
 * The upload runs server-side because the Omega S3 integration's credentials are
 * never exposed to the browser. On success the subreddit's URL field is updated
 * and the previous object deleted, so replaced images do not accumulate.
 *
 * Works with or without S3 — `uploadSubredditImage` inlines the image when no
 * bucket is configured, so this route never has to refuse an upload for reasons
 * the moderator cannot do anything about.
 */
export async function POST(request: Request, { params }: Params) {
  return handler(
    async () => {
      const { slug } = await params;
      const user = await requireCurrentUser();

      const subreddit = await getSubredditBySlugOrThrow(slug);
      await assertModerator(user.id, subreddit.id);

      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        throw badRequest(
          "Request must be multipart/form-data",
          "invalid_form_data",
        );
      }

      const kind = form.get("kind");
      if (typeof kind !== "string" || !KINDS.includes(kind as MediaKind)) {
        throw badRequest(
          "Field 'kind' must be 'banner' or 'icon'",
          "invalid_kind",
        );
      }

      const file = form.get("file");
      if (!(file instanceof File)) {
        throw badRequest("Field 'file' is required", "missing_file");
      }

      const { key, url } = await uploadSubredditImage(
        subreddit.id,
        kind as MediaKind,
        file,
      );

      // Capture the outgoing image before the record points elsewhere.
      const previousKey = keyFromUrl(
        kind === "banner" ? subreddit.bannerUrl : subreddit.iconUrl,
      );

      const updated = await setSubredditImage(
        slug,
        user.id,
        kind as MediaKind,
        url,
      );

      // Best-effort: a leaked object is preferable to failing a successful
      // upload, and lifecycle rules can sweep orphans.
      if (previousKey && previousKey !== key) {
        try {
          await deleteObject(previousKey);
        } catch (error) {
          console.error("Failed to delete replaced image", previousKey, error);
        }
      }

      return { key, url, subreddit: updated };
    },
    { status: 201 },
  );
}

/**
 * DELETE /api/subreddits/[slug]/images?kind=banner|icon — clear an image.
 *
 * Moderator only. Removes the stored object when one exists, so clearing an
 * image does not leave it paid for and reachable by URL.
 */
export async function DELETE(request: Request, { params }: Params) {
  return handler(async () => {
    const { slug } = await params;
    const user = await requireCurrentUser();

    const kind = new URL(request.url).searchParams.get("kind");
    if (typeof kind !== "string" || !KINDS.includes(kind as MediaKind)) {
      throw badRequest("Query 'kind' must be 'banner' or 'icon'", "invalid_kind");
    }

    const subreddit = await getSubredditBySlugOrThrow(slug);
    await assertModerator(user.id, subreddit.id);

    const previousKey = keyFromUrl(
      kind === "banner" ? subreddit.bannerUrl : subreddit.iconUrl,
    );

    const updated = await setSubredditImage(slug, user.id, kind as MediaKind, "");

    if (previousKey) {
      try {
        await deleteObject(previousKey);
      } catch (error) {
        console.error("Failed to delete cleared image", previousKey, error);
      }
    }

    return { cleared: kind, subreddit: updated };
  });
}
