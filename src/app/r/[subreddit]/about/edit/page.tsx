import { notFound } from "next/navigation";
import ImageUploader from "@/components/image-uploader";
import RulesEditor from "@/components/rules-editor";
import SettingsForm from "@/components/settings-form";
import { getCurrentUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { MAX_UPLOAD_BYTES, isMediaConfigured } from "@/lib/media";
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

  const mediaEnabled = isMediaConfigured();

  return (
    <div className="flex flex-col gap-10">
      {mediaEnabled && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Images
          </h2>
          <ImageUploader
            slug={view.slug}
            kind="banner"
            currentUrl={view.bannerUrl}
            maxBytes={MAX_UPLOAD_BYTES}
          />
          <ImageUploader
            slug={view.slug}
            kind="icon"
            currentUrl={view.iconUrl}
            maxBytes={MAX_UPLOAD_BYTES}
          />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Settings
        </h2>
        {!mediaEnabled && (
          <p className="rounded-md border border-black/[.08] px-3 py-2 text-xs text-zinc-500 dark:border-white/[.12]">
            Image uploads are not configured. Connect the Omega S3 integration to
            upload files, or paste image URLs below.
          </p>
        )}
        <SettingsForm
          slug={view.slug}
          initialDescription={view.description}
          initialBannerUrl={view.bannerUrl ?? ""}
          initialIconUrl={view.iconUrl ?? ""}
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
