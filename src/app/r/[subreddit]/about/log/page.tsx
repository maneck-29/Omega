import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { listModLog } from "@/lib/subreddits";
import type { ModActionType } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Human-readable labels for the audit trail. */
const ACTION_LABELS: Record<ModActionType, string> = {
  remove_post: "removed a post",
  approve_post: "approved a post",
  remove_comment: "removed a comment",
  approve_comment: "approved a comment",
  ban_user: "banned a user",
  unban_user: "unbanned a user",
};

export default async function ModLogPage({
  params,
}: {
  params: Promise<{ subreddit: string }>;
}) {
  const { subreddit: slug } = await params;
  const user = await getCurrentUser();

  if (!user) notFound();

  let entries;
  try {
    entries = await listModLog(slug, user.id, 100);
  } catch (error) {
    if (error instanceof DomainError && error.status === 404) notFound();
    throw error;
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Mod log
      </h2>

      {entries.length === 0 ? (
        <p className="text-sm text-zinc-500">No moderation actions yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-black/[.06] rounded-lg border border-black/[.08] dark:divide-white/[.08] dark:border-white/[.12]">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  <span className="font-medium">{entry.moderatorId}</span>{" "}
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </span>
                </p>
                <time
                  dateTime={entry.createdAt}
                  className="font-mono text-xs text-zinc-500"
                >
                  {entry.createdAt.replace("T", " ").slice(0, 19)}
                </time>
              </div>
              <p className="font-mono text-xs text-zinc-500">
                {entry.targetType}: {entry.targetId}
              </p>
              {entry.reason && (
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Reason: {entry.reason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
