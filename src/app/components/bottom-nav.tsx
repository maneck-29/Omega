"use client";

/**
 * Fixed bottom navigation, app-style.
 *
 * Five slots with the composer trigger raised in the middle. These are views of
 * the same feed rather than routes, so the bar drives the parent's state instead
 * of navigating — that keeps scroll position and loaded pages intact when
 * switching between Home and For You.
 */

export type NavTab = "home" | "search" | "foryou" | "mine";

interface BottomNavProps {
  active: NavTab;
  onSelect: (tab: NavTab) => void;
  onCompose: () => void;
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
      <path d="M12 3l9 8h-2.5v9h-5.5v-6h-2v6H5.5v-9H3l9-8z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
      <path d="M10.5 3a7.5 7.5 0 015.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
      <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm6.5 11l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
      <path d="M12 4a4 4 0 110 8 4 4 0 010-8zm0 10c4.4 0 8 2.2 8 4.5V21H4v-2.5C4 16.2 7.6 14 12 14z" />
    </svg>
  );
}

const TABS: Array<{ id: NavTab; label: string; icon: () => React.ReactElement }> =
  [
    { id: "home", label: "Home", icon: HomeIcon },
    { id: "search", label: "Search", icon: SearchIcon },
    { id: "foryou", label: "For You", icon: SparkIcon },
    { id: "mine", label: "Mine", icon: PersonIcon },
  ];

export default function BottomNav({
  active,
  onSelect,
  onCompose,
}: BottomNavProps) {
  // The compose button sits between the second and third tab.
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  function renderTab(tab: (typeof TABS)[number]) {
    const Icon = tab.icon;
    const isActive = active === tab.id;
    return (
      <button
        key={tab.id}
        type="button"
        onClick={() => onSelect(tab.id)}
        aria-current={isActive ? "page" : undefined}
        className={`flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors ${
          isActive ? "text-accent" : "text-muted hover:text-foreground"
        }`}
      >
        <Icon />
        <span className="text-[10px] font-medium">{tab.label}</span>
      </button>
    );
  }

  return (
    <nav
      aria-label="Main"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-background/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-lg items-center px-2">
        {left.map(renderTab)}

        <button
          type="button"
          onClick={onCompose}
          aria-label="Create a post"
          className="mx-1 -mt-5 flex h-13 w-13 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 transition-transform active:scale-95"
          style={{ height: "3.25rem", width: "3.25rem" }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
            <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z" />
          </svg>
        </button>

        {right.map(renderTab)}
      </div>
    </nav>
  );
}
