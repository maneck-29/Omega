"use client";

/**
 * Fixed bottom navigation with a raised composer button. Owned by TM2.
 *
 * App-style chrome, so posting is one tap from anywhere. The tabs are real links
 * (Home, Browse, Create community, Profile) rather than local state, because
 * TM3's pages are separate routes; the centre button is the only control that
 * opens something in place.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Composer from "./composer";

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M12 3l9 8h-2.5v9h-5.5v-6h-2v6H5.5v-9H3l9-8z" />
    </svg>
  );
}

function BrowseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M10.5 3a7.5 7.5 0 015.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M12 4a4 4 0 110 8 4 4 0 010-8zm0 10c4.4 0 8 2.2 8 4.5V21H4v-2.5C4 16.2 7.6 14 12 14z" />
    </svg>
  );
}

const TABS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/subreddits", label: "Browse", icon: BrowseIcon },
  { href: "/me", label: "You", icon: ProfileIcon },
];

export default function BottomNav() {
  const pathname = usePathname();
  const [composerOpen, setComposerOpen] = useState(false);

  // Posting from inside a community should preselect it.
  const match = pathname?.match(/^\/r\/([^/]+)/);
  const currentSlug = match?.[1];

  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  function renderTab(tab: (typeof TABS)[number]) {
    const Icon = tab.icon;
    const active =
      tab.href === "/" ? pathname === "/" : pathname?.startsWith(tab.href);

    return (
      <Link
        key={tab.href}
        href={tab.href}
        aria-current={active ? "page" : undefined}
        className={`flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors ${
          active
            ? "text-orange-600 dark:text-orange-400"
            : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        }`}
      >
        <Icon />
        <span className="text-[10px] font-medium">{tab.label}</span>
      </Link>
    );
  }

  return (
    <>
      <nav
        aria-label="Main"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-black/[.08] bg-white/95 backdrop-blur dark:border-white/[.12] dark:bg-black/90"
      >
        <div className="mx-auto flex max-w-lg items-center px-2">
          {left.map(renderTab)}

          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            aria-label="Create a post"
            className="mx-1 -mt-5 flex shrink-0 items-center justify-center rounded-full bg-orange-600 text-white shadow-lg shadow-orange-600/30 transition-transform active:scale-95"
            style={{ height: "3.25rem", width: "3.25rem" }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
              <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z" />
            </svg>
          </button>

          {right.map(renderTab)}
        </div>
      </nav>

      <Composer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        defaultSubredditSlug={currentSlug}
      />
    </>
  );
}
