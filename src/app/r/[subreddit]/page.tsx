import Link from "next/link";
import { notFound } from "next/navigation";
import PostListSlot from "@/components/post-list-slot";
import SubredditIcon from "@/components/subreddit-icon";
import SubscribeButton from "@/components/subscribe-button";
import { getCurrentUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { renderableUrl } from "@/lib/media-url";
import { ensureSeeded } from "@/lib/seed";
import { getSubredditView } from "@/lib/subreddits";
import { FIXTURE_POSTS } from "@/lib/seed";

export const dynamic = "force-dynamic";

/**
 * Subreddit page.
 *
 * TM3 owns the shell — banner, description, rules sidebar, join button. The post
 * list is TM2's component, rendered into the slot below.
 */
export default async function SubredditPage({
  params,
}: {
  params: Promise<{ subreddit: string }>;
}) {
  await ensureSeeded();

  const { subreddit: slug } = await params;
  const user = await getCurrentUser();

  let view;
  try {
    view = await getSubredditView(slug, user?.id ?? null);
  } catch (error) {
    if (error instanceof DomainError && error.status === 404) notFound();
    throw error;
  }

  // Until TM2's posts exist, link the seeded fixture thread so the comment tree
  // is reachable from the UI.
  const fixturePostId =
    view.slug === "typescript"
      ? FIXTURE_POSTS.typescript
      : view.slug === "webdev"
        ? FIXTURE_POSTS.webdev
        : null;

  // Normalised on render: a row written before images were served through the
  // app holds an absolute S3 URL, which the browser cannot load.
  const bannerSrc = renderableUrl(view.bannerUrl);

  return (
    <div className="flex flex-1 flex-col">
      {/*
        The uploaded banner, falling back to a gradient so the page keeps its
        shape for communities that never set one. A plain <img> because Omega
        does not support Next.js image optimisation.
      */}
      {bannerSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bannerSrc}
          alt={`${view.name} banner`}
          className="h-24 w-full bg-black/5 object-cover dark:bg-white/10 sm:h-32"
        />
      ) : (
        <div className="h-24 w-full bg-gradient-to-r from-indigo-500 to-sky-400 sm:h-32" />
      )}

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-8 px-6 py-6">
        <main className="flex flex-1 flex-col gap-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              {/* Pulled up over the banner, the way Reddit sits an icon on it. */}
              <SubredditIcon
                slug={view.slug}
                name={view.name}
                iconUrl={view.iconUrl}
                size="lg"
                className="-mt-10 ring-4 ring-white dark:ring-black"
              />
              <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {view.name}
                </h1>
                <p className="max-w-prose text-sm text-zinc-600 dark:text-zinc-400">
                  {view.description || "No description yet."}
                </p>
              </div>
            </div>
            {user && (
              <SubscribeButton
                slug={view.slug}
                initialSubscribed={view.isSubscribed}
                initialCount={view.subscriberCount}
                disabled={view.isBanned}
              />
            )}
          </header>

          {view.isBanned && (
            <p className="rounded-md border border-red-500/30 bg-red-500/[.08] px-3 py-2 text-sm text-red-700 dark:text-red-400">
              You are banned from this community and cannot post or comment.
            </p>
          )}

          <PostListSlot subredditName={view.name} />

          {fixturePostId && (
            <Link
              href={`/r/${view.slug}/comments/${fixturePostId}`}
              className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              View example comment thread →
            </Link>
          )}
        </main>

        <aside className="hidden w-64 shrink-0 flex-col gap-6 md:flex">
          <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.12]">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Rules
            </h2>
            {view.rules.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-500">No rules set.</p>
            ) : (
              <ol className="mt-2 flex flex-col gap-3">
                {view.rules.map((rule, index) => (
                  <li key={rule.id} className="text-sm">
                    <span className="font-medium">
                      {index + 1}. {rule.title}
                    </span>
                    {rule.description && (
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {rule.description}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {view.isModerator && (
            <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.12]">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Moderation
              </h2>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                <li>
                  <Link
                    href={`/r/${view.slug}/about/edit`}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Settings &amp; rules
                  </Link>
                </li>
                <li>
                  <Link
                    href={`/r/${view.slug}/about/banned`}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Banned users
                  </Link>
                </li>
                <li>
                  <Link
                    href={`/r/${view.slug}/about/log`}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Mod log
                  </Link>
                </li>
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
