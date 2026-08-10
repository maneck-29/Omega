import { requireCurrentUser } from "@/lib/auth";
import { badRequest, forbidden } from "@/lib/errors";
import {
  deleteObject,
  isMediaConfigured,
  keyFromUrl,
  uploadSubredditImage,
  type MediaKind,
} from "@/lib/media";
import { assertModerator } from "@/lib/permissions";
import { handler } from "@/lib/route-helpers";
import {
  getSubredditBySlugOrThrow,
  updateSubredditSettings,
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
 */
export async function POST(request: Request, { params }: Params) {
  return handler(
    async () => {
      const { slug } = await params;
      const user = await requireCurrentUser();

      if (!isMediaConfigured()) {
        throw forbidden(
          "Image uploads are not configured. Connect the Omega S3 integration, " +
            "or set the banner and icon URLs directly in settings.",
          "media_not_configured",
        );
      }

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

      const updated = await updateSubredditSettings(slug, user.id, {
        ...(kind === "banner" ? { bannerUrl: url } : { iconUrl: url }),
      });

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
