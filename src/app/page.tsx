/**
 * Home — the feed.
 *
 * The first page is rendered on the server so content is visible immediately
 * and the database round trip happens server-side; the client component takes
 * over for subsequent pages, sorting and search.
 *
 * force-dynamic because the feed reflects live vote counts and the visitor's own
 * vote state, neither of which can be prerendered.
 */

import Feed from "./components/feed";
import { readIdentity } from "@/lib/identity";
import { listPosts } from "@/lib/posts";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default async function Home() {
  await ensureSeeded();

  const identity = await readIdentity();
  const initial = await listPosts(identity, { sort: "hot", limit: 20 });

  return <Feed initialPosts={initial.posts} initialHasMore={initial.hasMore} />;
}
