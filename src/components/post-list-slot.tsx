/**
 * Placeholder for TM2's post list.
 *
 * TM2 owns post rendering, sorting (hot/new/top/controversial), and pagination.
 * This component marks the seam: replace the body with TM2's list component,
 * which should accept `subredditId` (or null for the home feed).
 *
 * TM2's queries MUST exclude comments and posts flagged `removedAt` by
 * moderation, or removed content keeps appearing in listings and search.
 */
export default function PostListSlot({
  subredditName,
}: {
  subredditName?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-black/[.15] px-4 py-8 text-center dark:border-white/[.18]">
      <p className="text-sm font-medium">Post list goes here</p>
      <p className="mt-1 text-xs text-zinc-500">
        Owned by TM2 (Posts &amp; Voting)
        {subredditName ? ` — filtered to r/${subredditName}` : " — home feed"}
      </p>
    </div>
  );
}
