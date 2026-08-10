import { notFound } from "next/navigation";
import ImageUploader from "@/components/image-uploader";
import RulesEditor from "@/components/rules-editor";
import SettingsForm from "@/components/settings-form";
import { getCurrentUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { renderableUrl } from "@/lib/media-url";
import {
  MAX_INLINE_BYTES,
  MAX_UPLOAD_BYTES,
  isMediaConfigured,
  maxUploadBytes,
} from "@/lib/media";
import { getSubredditView } from "@/lib/subreddits";

export const dynamic = "force-dynamic";

export default async function EditSubredditPage({
  params,
}: {
  params: Promise<{ subreddit: string }>;
}) {
  const { subreddit: slug } = await params;
  const user = await getCurrentUser();

  let view;
  try {
    view = await getSubredditView(slug, user?.id ?? null);
  } catch (error) {
    if (error instanceof DomainError && error.status === 404) notFound();
    throw error;
  }

  /*
   * Uploads work either way — S3 when the integration is connected, inlined into
   * the record when it is not — so the picker is always shown. Only the size
   * limit and the note below change.
   */
  const usingS3 = isMediaConfigured();
  const limit = maxUploadBytes();

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Images
        </h2>
        <ImageUploader
          slug={view.slug}
          kind="banner"
          currentUrl={renderableUrl(view.bannerUrl)}
          maxBytes={limit}
        />
        <ImageUploader
          slug={view.slug}
          kind="icon"
          currentUrl={renderableUrl(view.iconUrl)}
          maxBytes={limit}
        />
        {!usingS3 && (
          <p className="rounded-md border border-black/[.08] px-3 py-2 text-xs text-zinc-500 dark:border-white/[.12]">
            Images are stored inline because the S3 integration is not connected,
            so uploads are limited to{" "}
            {Math.floor(MAX_INLINE_BYTES / 1024)} KB. Connect it to store files
            in a bucket and raise the limit to{" "}
            {Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Settings
        </h2>
        <SettingsForm
          slug={view.slug}
          initialDescription={view.description}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Rules
        </h2>
        <RulesEditor slug={view.slug} initialRules={view.rules} />
      </section>
    </div>
  );
}
