"use client";

import { useRouter } from "next/navigation";
import PostCard from "./post-card";
import type { PostView } from "@/lib/types";

/**
 * Renders a single post at the top of its comment thread.
 *
 * A thin client wrapper because `PostCard` takes an `onDeleted` callback, which a
 * server component cannot supply. Deleting from the thread page has nowhere to
 * navigate back to within the page, so it returns to the subreddit.
 */
export default function PostDetail({
  view,
  subredditSlug,
}: {
  view: PostView;
  subredditSlug: string;
}) {
  const router = useRouter();

  return (
    <PostCard
      view={view}
      onDeleted={() => {
        router.push(`/r/${subredditSlug}`);
      }}
    />
  );
}
