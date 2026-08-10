"use client";

/**
 * The feed: ranking tabs, search, type filters, infinite scroll, and the
 * composer trigger.
 *
 * Owns all feed state so the bottom navigation can switch between views without
 * a route change, which preserves already-loaded pages and scroll position.
 *
 * Pagination is offset-based. `hot`, `controversial` and For You are computed
 * from vote counts that move while you scroll, so a keyset cursor would drift
 * anyway; offset keeps it simple and the server returns `hasMore` directly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Post, PostType, SortMode } from "@/lib/posts";
import BottomNav, { type NavTab } from "./bottom-nav";
import Composer from "./composer";
import PostCard from "./post-card";

const PAGE_SIZE = 20;

const SORT_TABS: Array<{ value: SortMode; label: string }> = [
  { value: "hot", label: "Hot" },
  { value: "new", label: "New" },
  { value: "top", label: "Top" },
  { value: "controversial", label: "Controversial" },
];

const TYPE_FILTERS: Array<{ value: PostType | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "text", label: "Text" },
  { value: "image", label: "Images" },
  { value: "link", label: "Links" },
];

interface FeedProps {
  initialPosts: Post[];
  initialHasMore: boolean;
}

export default function Feed({ initialPosts, initialHasMore }: FeedProps) {
  const [tab, setTab] = useState<NavTab>("home");
  const [sort, setSort] = useState<SortMode>("hot");
  const [typeFilter, setTypeFilter] = useState<PostType | "all">("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [offset, setOffset] = useState(initialPosts.length);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[] | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);
  // Guards against the observer firing repeatedly for the same page.
  const loadingRef = useRef(false);
  // Skips the initial refetch, since the first page is server-rendered.
  const hydratedRef = useRef(false);

  // Debounce typing so each keystroke does not hit the API.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const buildUrl = useCallback(
    (nextOffset: number) => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(nextOffset));

      if (tab === "foryou") {
        params.set("sort", "foryou");
      } else {
        params.set("sort", sort);
        if (typeFilter !== "all") params.set("type", typeFilter);
        if (debouncedSearch) params.set("q", debouncedSearch);
        if (tab === "mine") params.set("mine", "1");
      }

      return `/api/posts?${params.toString()}`;
    },
    [tab, sort, typeFilter, debouncedSearch],
  );

  /** Reload from the top whenever the query changes. */
  const reload = useCallback(async () => {
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(buildUrl(0));
      if (!response.ok) throw new Error("Could not load the feed");
      const data = await response.json();

      setPosts(data.posts ?? []);
      setHasMore(Boolean(data.hasMore));
      setOffset(data.nextOffset ?? (data.posts?.length ?? 0));
      setInterests(data.interests?.topics ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the feed");
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [buildUrl]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;

    loadingRef.current = true;
    setLoading(true);

    try {
      const response = await fetch(buildUrl(offset));
      if (!response.ok) throw new Error("Could not load more");
      const data = await response.json();

      setPosts((current) => {
        // Offset pagination can repeat a row when ranking shifts mid-scroll.
        const seen = new Set(current.map((post) => post.id));
        const fresh = (data.posts ?? []).filter(
          (post: Post) => !seen.has(post.id),
        );
        return [...current, ...fresh];
      });
      setHasMore(Boolean(data.hasMore));
      setOffset(data.nextOffset ?? offset + PAGE_SIZE);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more");
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [buildUrl, hasMore, offset]);

  // Refetch when the query changes, skipping the server-rendered first render.
  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    void reload();
  }, [reload]);

  // Infinite scroll: load the next page as the sentinel approaches the viewport.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "400px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  function handleCreated(post: Post) {
    // Show it immediately rather than waiting for the next ranking pass.
    setPosts((current) => [post, ...current]);
  }

  function handleDeleted(id: string) {
    setPosts((current) => current.filter((post) => post.id !== id));
  }

  function handleTab(next: NavTab) {
    setTab(next);
    if (next === "home") {
      setSearch("");
      setSort("hot");
    }
  }

  const showSearch = tab === "search";
  const showSortTabs = tab !== "foryou";

  const heading =
    tab === "foryou" ? "For You" : tab === "mine" ? "Your activity" : "Hot Takes";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col pb-24">
      <header className="sticky top-0 z-30 border-b border-hairline bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold tracking-tight">{heading}</h1>
          <button
            type="button"
            onClick={() => handleTab(showSearch ? "home" : "search")}
            aria-label={showSearch ? "Close search" : "Search posts"}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-black/5 dark:hover:bg-white/10"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path d="M10.5 3a7.5 7.5 0 015.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z" />
            </svg>
          </button>
        </div>

        {showSearch && (
          <div className="px-4 pb-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search hot takes…"
              aria-label="Search hot takes"
              autoFocus
              className="w-full rounded-full border border-hairline bg-surface px-4 py-2 text-sm outline-none placeholder:text-muted focus:border-accent/60"
            />
          </div>
        )}

        {showSortTabs && (
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-2">
            {SORT_TABS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSort(option.value)}
                aria-pressed={sort === option.value}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  sort === option.value
                    ? "bg-accent text-white"
                    : "bg-black/5 text-muted dark:bg-white/10"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {showSortTabs && (
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-2">
            {TYPE_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTypeFilter(option.value)}
                aria-pressed={typeFilter === option.value}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${
                  typeFilter === option.value
                    ? "border-foreground/40 text-foreground"
                    : "border-hairline text-muted"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {tab === "foryou" && (
          <p className="px-4 pb-3 text-xs text-muted">
            {interests && interests.length > 0
              ? `Tuned to: ${interests.join(", ")}`
              : "Upvote a few takes and this feed starts matching your taste."}
          </p>
        )}
      </header>

      {error && (
        <p role="alert" className="px-4 py-3 text-sm text-red-500">
          {error}
        </p>
      )}

      {posts.length === 0 && !loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <p className="text-sm font-medium">Nothing here yet</p>
          <p className="text-xs text-muted">
            {tab === "mine"
              ? "Posts and replies you write will show up here."
              : debouncedSearch
                ? `No takes match “${debouncedSearch}”.`
                : "Tap the + button to post the first hot take."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onDeleted={handleDeleted} />
          ))}
        </div>
      )}

      <div ref={sentinelRef} aria-hidden className="h-px" />

      {loading && (
        <p className="py-4 text-center text-xs text-muted">Loading…</p>
      )}
      {!hasMore && posts.length > 0 && (
        <p className="py-6 text-center text-xs text-muted">
          That is every take. For now.
        </p>
      )}

      <BottomNav
        active={tab}
        onSelect={handleTab}
        onCompose={() => setComposerOpen(true)}
      />

      <Composer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
