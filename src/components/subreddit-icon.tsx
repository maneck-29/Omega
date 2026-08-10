/**
 * A community's icon, with a generated fallback.
 *
 * Every community has an icon whether or not anyone uploaded one: a missing
 * image falls back to the initial on a gradient derived from the slug, so the
 * layout never shifts and lists stay visually aligned. The same approach TM2
 * uses for user avatars, keyed on slug so a community's colour is stable.
 *
 * A server component on purpose — it is rendered in lists and needs no
 * interactivity. A broken remote URL degrades to a browser's broken-image glyph
 * rather than the fallback, which would need client state to detect; that is an
 * acceptable trade for keeping feeds out of the client bundle.
 */

const GRADIENTS = [
  "from-rose-400 to-orange-400",
  "from-sky-400 to-indigo-500",
  "from-emerald-400 to-teal-500",
  "from-fuchsia-400 to-purple-500",
  "from-amber-400 to-pink-500",
  "from-cyan-400 to-blue-500",
];

function gradientFor(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i += 1) {
    hash = (hash * 31 + slug.charCodeAt(i)) % 100000;
  }
  return GRADIENTS[hash % GRADIENTS.length];
}

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-12 w-12 text-base",
  lg: "h-16 w-16 text-2xl",
} as const;

export default function SubredditIcon({
  slug,
  name,
  iconUrl,
  size = "sm",
  className = "",
}: {
  slug: string;
  name: string;
  iconUrl: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const dimensions = SIZES[size];

  if (iconUrl) {
    return (
      // Plain <img>: Omega does not support Next.js image optimisation, so
      // next/image would add a /_next/image round trip that 404s there.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl}
        alt={`${name} icon`}
        loading="lazy"
        className={`${dimensions} shrink-0 rounded-full bg-black/5 object-cover dark:bg-white/10 ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`${dimensions} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${gradientFor(slug)} font-bold text-white ${className}`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
