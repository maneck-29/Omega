/**
 * TM2's post list, rendered into TM3's page slots.
 *
 * This file was the seam marker TM3 shipped; the body is now the real list. The
 * props are kept as TM3 calls them (`subredditName`) and mapped onto the list's
 * own options, so their pages did not need to change.
 *
 * Removed and deleted posts are filtered in the repository, so every listing,
 * sort and search excludes moderator-removed content without each call site
 * having to remember.
 */

import PostList from "./post-list";

export default function PostListSlot({
  subredditName,
  subredditSlug,
  /** Home feed: restrict to communities the viewer has joined. */
  subscribedOnly = false,
}: {
  subredditName?: string;
  subredditSlug?: string;
  subscribedOnly?: boolean;
}) {
  // TM3's subreddit page passes the display name; the API takes a slug, and the
  // slug is the lowercased name.
  const slug = subredditSlug ?? subredditName?.toLowerCase();

  return <PostList subredditSlug={slug} subscribedOnly={subscribedOnly} />;
}
