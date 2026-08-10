import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

/**
 * Shortcut to the signed-in user's own profile.
 *
 * Exists so the bottom navigation can link somewhere fixed: it is a client
 * component and does not know who is signed in, and resolving that on the client
 * would mean an extra fetch before the link worked.
 */
export const dynamic = "force-dynamic";

export default async function Me() {
  const user = await getCurrentUser();

  // No session yet: the community browser is the most useful landing place.
  if (!user) redirect("/subreddits");

  redirect(`/u/${encodeURIComponent(user.username)}`);
}
