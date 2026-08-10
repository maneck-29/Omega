"use client";

/**
 * Post list. Owned by TM2 (Posts & Voting).
 *
 * This is the component the integration contract asks for: it accepts a
 * `subredditSlug` (or nothing, for the home feed) and is rendered into TM3's
 * page slots.
 *
 * Handles the four sorts, search, type filtering, and infinite scroll.
 * Pagination is offset-based rather than a keyset cursor because `hot`,
 * `controversial` and For You are derived from vote tallies that shift while a
 * visitor scrolls, so a cursor would drift regardless; already-seen ids are
 * filtered on append so a shifting ranking cannot duplicate a row on screen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { PostType, PostView, PostWindow } from "@/lib/types";
import { parseFeed } from "./app-header";
import { POST_CREATED_EVENT } from "./events";
import PostCard from "./post-card";

const PAGE_SIZE = 20;

const TYPES: Array<{ value: PostType | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "text", label: "Text" },
  { value: "image", label: "Images" },
  { value: "link", label: "Links" },
];

const WINDOWS: Array<{ value: PostWindow; label: string }> = [
  { value: "day", label: "Today" },
  { value: "week", label: "This week" },
  { value: "all", label: "All time" },
];

export default function PostList({
  subredditSlug,
  subscribedOnly = false,
  authorId,
}: {
  /** Restrict to one community. Omit for a cross-community feed. */
  subredditSlug?: string;
  /** Home feed: only communities the viewer has joined. */
  subscribedOnly?: boolean;
  /** Restrict to one author, for a profile page. */
  authorId?: string;
}) {
  // The feed lives in the URL, chosen by the header's ‹ › switcher.
  const searchParams = useSearchParams();
  const sort = parseFeed(searchParams.get("feed"));

  const [typeFilter, setTypeFilter] = useState<PostType | "all">("all");
  const [window_, setWindow] = useState<PostWindow>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const [posts, setPosts] = useState<PostView[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[] | null>(null);
  /** Incremented to force a refetch of the first page. */
  const [reloadToken, setReloadToken] = useState(0);

  const sentinelRef = useRef<HTMLDivElement>(null);
  // Stops the observer firing repeatedly for the same page.
  const loadingRef = useRef(false);

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
      params.set("sort", sort);

      if (subredditSlug) params.set("subreddit", subredditSlug);
      if (subscribedOnly) params.set("feed", "subscribed");
      if (authorId) params.set("author", authorId);

      if (sort !== "foryou") {
        if (typeFilter !== "all") params.set("type", typeFilter);
        if (debouncedSearch) params.set("q", debouncedSearch);
        if (sort === "top") params.set("window", window_);
      }

      return `/api/posts?${params.toString()}`;
    },
    [sort, subredditSlug, subscribedOnly, authorId, typeFilter, debouncedSearch, window_],
  );

  // Reload from the top whenever the query changes. All state updates happen
  // after the first await, so the effect does not cascade renders.
  useEffect(() => {
    let cancelled = false;
    loadingRef.current = true;

    async function run() {
      try {
        const response = await fetch(buildUrl(0));
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error ?? "Could not load posts");
        }
        const data = await response.json();
        if (cancelled) return;

        setPosts(data.posts ?? []);
        setHasMore(Boolean(data.hasMore));
        setOffset(data.nextOffset ?? (data.posts?.length ?? 0));
        setInterests(data.interests?.topics ?? null);
        setError(null);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load posts");
        }
      } finally {
        if (!cancelled) setLoading(false);
        loadingRef.current = false;
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [buildUrl, reloadToken]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;

    loadingRef.current = true;
    setLoading(true);

    try {
      const response = await fetch(buildUrl(offset));
      if (!response.ok) throw new Error("Could not load more");
      const data = await response.json();

      setPosts((current) => {
        // A shifting ranking can repeat a row across pages; drop duplicates.
        const seen = new Set(current.map((view) => view.post.id));
        const fresh = (data.posts ?? []).filter(
          (view: PostView) => !seen.has(view.post.id),
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

  // Infinite scroll: fetch the next page as the sentinel nears the viewport.
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

  /*
   * The composer is mounted by the bottom navigation, outside this subtree, so it
   * announces a new post with a window event rather than a prop callback.
   * Bumping `reloadToken` re-runs the fetch effect, which puts the new post in
   * correct rank order without reloading the page.
   */
  useEffect(() => {
    function onPostCreated() {
      setReloadToken((value) => value + 1);
    }

    window.addEventListener(POST_CREATED_EVENT, onPostCreated);
    return () => window.removeEventListener(POST_CREATED_EVENT, onPostCreated);
  }, []);

  function handleDeleted(id: string) {
    setPosts((current) => current.filter((view) => view.post.id !== id));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowSearch((value) => !value)}
          aria-label={showSearch ? "Close search" : "Search posts"}
          aria-expanded={showSearch}
          className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <path d="M10.5 3a7.5 7.5 0 015.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z" />
          </svg>
        </button>
      </div>

      {showSearch && sort !== "foryou" && (
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search titles, bodies and links…"
          aria-label="Search posts"
          autoFocus
          className="w-full rounded-full border border-black/[.12] bg-transparent px-4 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-orange-500/60 dark:border-white/[.16]"
        />
      )}

      {sort !== "foryou" && (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {TYPES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTypeFilter(option.value)}
              aria-pressed={typeFilter === option.value}
              className={`shrink-0 rounded-full border px-3 py-0.5 text-xs transition-colors ${
                typeFilter === option.value
                  ? "border-zinc-500 text-zinc-800 dark:text-zinc-100"
                  : "border-black/[.10] text-zinc-500 dark:border-white/[.14]"
              }`}
            >
              {option.label}
            </button>
          ))}

          {sort === "top" &&
            WINDOWS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setWindow(option.value)}
                aria-pressed={window_ === option.value}
                className={`shrink-0 rounded-full border px-3 py-0.5 text-xs transition-colors ${
                  window_ === option.value
                    ? "border-orange-500 text-orange-600 dark:text-orange-400"
                    : "border-black/[.10] text-zinc-500 dark:border-white/[.14]"
                }`}
              >
                {option.label}
              </button>
            ))}
        </div>
      )}

      {sort === "foryou" && (
        <p className="text-xs text-zinc-500">
          {interests && interests.length > 0
            ? `Tuned to: ${interests.join(", ")}`
            : "Upvote a few posts and this feed starts matching your taste."}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {posts.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-black/[.15] px-4 py-10 text-center dark:border-white/[.18]">
          <p className="text-sm font-medium">Nothing here yet</p>
          <p className="mt-1 text-xs text-zinc-500">
            {debouncedSearch
              ? `No posts match “${debouncedSearch}”.`
              : subscribedOnly
                ? "Join a community, or use the + button to post."
                : "Use the + button to write the first post."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((view) => (
            <PostCard
              key={view.post.id}
              view={view}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}

      <div ref={sentinelRef} aria-hidden className="h-px" />

      {loading && (
        <p className="py-3 text-center text-xs text-zinc-500">Loading…</p>
      )}
      {!hasMore && posts.length > 0 && (
        <p className="py-3 text-center text-xs text-zinc-400">
          That is everything.
        </p>
      )}
    </div>
  );
}
