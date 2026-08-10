import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { ensureSeeded } from "@/lib/seed";
import { getSubredditView } from "@/lib/subreddits";

/**
 * Shell for the moderation pages.
 *
 * The moderator check happens once here rather than in each page. Individual API
 * routes enforce it again server-side, so this is navigation, not the security
 * boundary.
 */
export default async function AboutLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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

  if (!view.isModerator) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-10">
        <h1 className="text-xl font-semibold tracking-tight">
          Moderation — r/{view.name}
        </h1>
        <p className="rounded-md border border-red-500/30 bg-red-500/[.08] px-3 py-2 text-sm text-red-700 dark:text-red-400">
          You are not a moderator of this community.
        </p>
        <Link
          href={`/r/${view.slug}`}
          className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Back to r/{view.name}
        </Link>
      </div>
    );
  }

  const tabs = [
    { href: `/r/${view.slug}/about/edit`, label: "Settings & rules" },
    { href: `/r/${view.slug}/about/banned`, label: "Banned users" },
    { href: `/r/${view.slug}/about/log`, label: "Mod log" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <Link
          href={`/r/${view.slug}`}
          className="text-xs text-zinc-500 hover:underline"
        >
          ← r/{view.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Moderation</h1>
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-black/[.08] pb-2 text-sm dark:border-white/[.12]">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="rounded px-3 py-1.5 text-zinc-600 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.08]"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
