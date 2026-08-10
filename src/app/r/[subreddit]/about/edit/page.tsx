import { notFound } from "next/navigation";
import RulesEditor from "@/components/rules-editor";
import SettingsForm from "@/components/settings-form";
import { getCurrentUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
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

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Settings
        </h2>
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
