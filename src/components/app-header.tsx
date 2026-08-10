"use client";

/**
 * App header: logo on the left, feed switcher in the centre.
 *
 * The switcher writes the chosen feed to the URL (`?feed=`) rather than to local
 * state, for three reasons: the feed list lives here but the list that reads it
 * is further down the tree, a chosen feed survives a refresh, and the URL can be
 * shared. `PostList` reads the same parameter.
 *
 * It only renders on pages that actually show a feed — switching feeds means
 * nothing on the community browser or the create form.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** The feed order the ‹ › arrows cycle through. */
const FEEDS = [
  { value: "foryou", label: "For You" },
  { value: "hot", label: "Hot" },
  { value: "new", label: "New" },
  { value: "top", label: "Top" },
  { value: "controversial", label: "Controversial" },
] as const;

export type FeedValue = (typeof FEEDS)[number]["value"];

export const DEFAULT_FEED: FeedValue = "foryou";

/** Narrow an untrusted query value to a known feed. */
export function parseFeed(value: string | null): FeedValue {
  return FEEDS.some((feed) => feed.value === value)
    ? (value as FeedValue)
    : DEFAULT_FEED;
}

/** Omega's mark: a filled circle with the glyph knocked out. */
function OmegaLogo() {
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 text-[17px] font-bold leading-none text-white shadow-sm"
    >
      Ω
    </span>
  );
}

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();

  // Feeds exist on the home page and on a community page.
  const showSwitcher = pathname === "/" || /^\/r\/[^/]+$/.test(pathname ?? "");

  const current = parseFeed(params.get("feed"));
  const index = FEEDS.findIndex((feed) => feed.value === current);

  function goTo(nextIndex: number) {
    // Wrap around at both ends, so the arrows are never dead.
    const wrapped = (nextIndex + FEEDS.length) % FEEDS.length;
    const next = new URLSearchParams(params.toString());
    next.set("feed", FEEDS[wrapped].value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <header className="sticky top-0 z-30 border-b border-black/[.08] bg-white/90 backdrop-blur dark:border-white/[.12] dark:bg-black/80">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2"
          aria-label="Hot Takes home"
        >
          <OmegaLogo />
          <span className="hidden text-base font-bold tracking-tight sm:inline">
            Hot Takes
          </span>
        </Link>

        {showSwitcher && (
          <div
            role="group"
            aria-label="Choose feed"
            className="mx-auto flex items-center gap-1"
          >
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              aria-label="Previous feed"
              className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100"
            >
              ‹
            </button>

            <span
              aria-live="polite"
              className="min-w-28 text-center text-sm font-semibold tracking-tight"
            >
              {FEEDS[index].label}
            </span>

            <button
              type="button"
              onClick={() => goTo(index + 1)}
              aria-label="Next feed"
              className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100"
            >
              ›
            </button>
          </div>
        )}

        {/* Balances the logo so the switcher stays optically centred. */}
        {showSwitcher && <div aria-hidden className="w-8 shrink-0 sm:w-24" />}
      </div>
    </header>
  );
}
