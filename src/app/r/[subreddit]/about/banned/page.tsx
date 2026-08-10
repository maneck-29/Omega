import { notFound } from "next/navigation";
import BanManager from "@/components/ban-manager";
import { getCurrentUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { getSubredditBySlugOrThrow, listBans } from "@/lib/subreddits";

export const dynamic = "force-dynamic";

export default async function BannedUsersPage({
  params,
}: {
  params: Promise<{ subreddit: string }>;
}) {
  const { subreddit: slug } = await params;
  const user = await getCurrentUser();

  // The layout already rejected non-moderators; this is the data fetch.
  if (!user) notFound();

  // Only the fetch is guarded — constructing JSX inside try/catch would not
  // catch render errors anyway, and hides them from the error boundary.
  let bans;
  try {
    await getSubredditBySlugOrThrow(slug);
    bans = await listBans(slug, user.id);
  } catch (error) {
    if (error instanceof DomainError && error.status === 404) notFound();
    throw error;
  }

  return <BanManager slug={slug} initialBans={bans} />;
}
