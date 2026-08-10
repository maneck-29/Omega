/**
 * Small presentation helpers shared by the feed components.
 *
 * Deliberately dependency-free: no date library for what amounts to a handful
 * of string cases.
 */

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return new Date(iso).toLocaleDateString();
}

/** Deterministic gradient per author, so avatars stay stable across renders. */
const AVATAR_GRADIENTS = [
  "from-rose-400 to-orange-400",
  "from-sky-400 to-indigo-500",
  "from-emerald-400 to-teal-500",
  "from-fuchsia-400 to-purple-500",
  "from-amber-400 to-pink-500",
  "from-cyan-400 to-blue-500",
];

export function avatarFor(name: string | null): {
  initial: string;
  gradient: string;
} {
  const label = name?.trim() || "anonymous";

  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) % 100000;
  }

  return {
    initial: label.charAt(0).toUpperCase(),
    gradient: AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length],
  };
}

export function displayName(name: string | null): string {
  return name?.trim() ? name.trim() : "anonymous";
}
