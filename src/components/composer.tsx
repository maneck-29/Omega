"use client";

/**
 * Post composer, presented as a bottom sheet. Owned by TM2.
 *
 * A segmented toggle switches between the three post types, which changes which
 * extra field is required. Posts belong to a subreddit, so the sheet loads the
 * available communities and requires one to be picked — the integration contract
 * points at `listSubreddits()` for exactly this.
 *
 * The AI panel drafts a title from a short prompt. The draft lands in the field
 * for editing rather than posting straight away, and the sheet says when Bedrock
 * was unreachable and the text was composed locally instead.
 */

import { useEffect, useRef, useState } from "react";
import type { PostType } from "@/lib/types";
import { POST_CREATED_EVENT } from "./events";

type SubredditOption = { id: string; name: string; slug: string };

const TYPES: Array<{ value: PostType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "link", label: "Link" },
];

const MAX_TITLE = 300;

export default function Composer({
  open,
  onClose,
  /** Preselect the community when posting from inside one. */
  defaultSubredditSlug,
}: {
  open: boolean;
  onClose: () => void;
  defaultSubredditSlug?: string;
}) {
  const [postType, setPostType] = useState<PostType>("text");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [subreddit, setSubreddit] = useState(defaultSubredditSlug ?? "");
  const [subreddits, setSubreddits] = useState<SubredditOption[]>([]);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleRef = useRef<HTMLTextAreaElement>(null);

  // Load the community list once the sheet is first opened.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function run() {
      try {
        const response = await fetch("/api/subreddits?sort=popular");
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;

        const options: SubredditOption[] = (data.subreddits ?? []).map(
          (s: SubredditOption) => ({ id: s.id, name: s.name, slug: s.slug }),
        );
        setSubreddits(options);
        setSubreddit((current) => current || options[0]?.slug || "");
      } catch {
        // Non-fatal: the field stays empty and submission reports the problem.
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Focus on open, and close on Escape.
  useEffect(() => {
    if (!open) return;

    titleRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  function reset() {
    setTitle("");
    setBody("");
    setUrl("");
    setImageUrl("");
    setAiPrompt("");
    setAiNote(null);
    setError(null);
    setPostType("text");
    setAiOpen(false);
  }

  async function generate() {
    if (aiPrompt.trim() === "") return;

    setGenerating(true);
    setError(null);
    setAiNote(null);
    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not generate a take");
      }

      const result = await response.json();
      setTitle(result.text);
      setAiNote(
        result.source === "bedrock"
          ? `Drafted by ${result.model}. Edit before posting.`
          : (result.note ?? "Composed locally."),
      );
      titleRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate");
    } finally {
      setGenerating(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subreddit,
          title,
          body,
          postType,
          url: postType === "link" ? url : null,
          imageUrl: postType === "image" ? imageUrl : null,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not post");
      }

      reset();
      onClose();

      /*
       * The composer lives in the layout's bottom navigation while the feed is a
       * separate client component with its own paging state, so there is no
       * parent to notify. A window event bridges them: the feed reloads its first
       * page in place instead of the whole document reloading.
       */
      window.dispatchEvent(new CustomEvent(POST_CREATED_EVENT));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not post");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const remaining = MAX_TITLE - title.length;
  const canSubmit =
    title.trim() !== "" &&
    remaining >= 0 &&
    subreddit !== "" &&
    !submitting &&
    (postType !== "link" || url.trim() !== "") &&
    (postType !== "image" || imageUrl.trim() !== "");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create a post"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      <button
        type="button"
        aria-label="Close composer"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />

      <form
        onSubmit={submit}
        className="relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-black/[.08] bg-white p-4 shadow-2xl sm:rounded-2xl dark:border-white/[.12] dark:bg-zinc-950"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">New post</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        <div
          role="group"
          aria-label="Post type"
          className="mb-3 flex gap-1 rounded-full bg-black/5 p-1 dark:bg-white/10"
        >
          {TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => setPostType(type.value)}
              aria-pressed={postType === type.value}
              className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                postType === type.value
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-500"
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>

        <select
          value={subreddit}
          onChange={(event) => setSubreddit(event.target.value)}
          aria-label="Community"
          className="mb-2 w-full rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none focus:border-orange-500/60 dark:border-white/[.16]"
        >
          {subreddits.length === 0 && <option value="">No communities yet</option>}
          {subreddits.map((option) => (
            <option key={option.id} value={option.slug}>
              {option.name}
            </option>
          ))}
        </select>

        <textarea
          ref={titleRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          rows={2}
          placeholder="Say the thing everyone is thinking…"
          aria-label="Post title"
          className="w-full resize-none rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-zinc-400 focus:border-orange-500/60 dark:border-white/[.16]"
        />
        <div className="mb-2 flex justify-end">
          <span
            className={`font-mono text-xs ${
              remaining < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-400"
            }`}
          >
            {remaining}
          </span>
        </div>

        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={2}
          placeholder="Optional detail"
          aria-label="Post body"
          maxLength={2000}
          className="mb-2 w-full resize-none rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-orange-500/60 dark:border-white/[.16]"
        />

        {postType === "image" && (
          <input
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            placeholder="https://example.com/image.jpg"
            aria-label="Image URL"
            inputMode="url"
            className="mb-2 w-full rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-orange-500/60 dark:border-white/[.16]"
          />
        )}

        {postType === "link" && (
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/article"
            aria-label="Link URL"
            inputMode="url"
            className="mb-2 w-full rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-orange-500/60 dark:border-white/[.16]"
          />
        )}

        <div className="mb-3 rounded-lg border border-black/[.08] p-3 dark:border-white/[.12]">
          <button
            type="button"
            onClick={() => setAiOpen((value) => !value)}
            aria-expanded={aiOpen}
            className="flex w-full items-center justify-between text-sm font-medium"
          >
            <span className="flex items-center gap-2">
              <span aria-hidden>✨</span> Generate with AI
            </span>
            <span aria-hidden className="text-zinc-400">
              {aiOpen ? "−" : "+"}
            </span>
          </button>

          {aiOpen && (
            <div className="mt-3">
              <div className="flex gap-2">
                <input
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  placeholder="What should the take be about?"
                  aria-label="AI prompt"
                  maxLength={300}
                  className="min-w-0 flex-1 rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-orange-500/60 dark:border-white/[.16]"
                />
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={generating || aiPrompt.trim() === ""}
                  className="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {generating ? "…" : "Draft"}
                </button>
              </div>
              {aiNote && <p className="mt-2 text-xs text-zinc-500">{aiNote}</p>}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-full bg-orange-600 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? "Posting…" : "Post it"}
        </button>
      </form>
    </div>
  );
}
