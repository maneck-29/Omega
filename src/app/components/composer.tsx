"use client";

/**
 * Post composer, presented as a bottom sheet.
 *
 * A segmented toggle switches between the three post types, which changes which
 * extra field is required. The AI panel calls Bedrock to draft a take from a
 * short prompt; the draft lands in the textarea for editing rather than posting
 * straight away, and the sheet says so when the model was unreachable and the
 * text was composed locally instead.
 */

import { useEffect, useRef, useState } from "react";
import type { Post, PostType } from "@/lib/posts";

interface ComposerProps {
  open: boolean;
  onClose: () => void;
  onCreated: (post: Post) => void;
}

const TYPES: Array<{ value: PostType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "link", label: "Link" },
];

const MAX_BODY = 500;

export default function Composer({ open, onClose, onCreated }: ComposerProps) {
  const [postType, setPostType] = useState<PostType>("text");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [authorName, setAuthorName] = useState("");

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the composer when it opens, and close it on Escape.
  useEffect(() => {
    if (!open) return;

    textareaRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  function reset() {
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
      setBody(result.text);
      setAiNote(
        result.source === "bedrock"
          ? `Drafted by ${result.model}. Edit it before posting.`
          : (result.note ?? "Composed locally."),
      );
      textareaRef.current?.focus();
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
          body,
          postType,
          url: postType === "link" ? url : null,
          imageUrl: postType === "image" ? imageUrl : null,
          authorName: authorName.trim() || null,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not post");
      }

      const { post } = await response.json();
      onCreated(post);
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not post");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const remaining = MAX_BODY - body.length;
  const canSubmit =
    body.trim() !== "" &&
    remaining >= 0 &&
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
        className="relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-hairline bg-background p-4 shadow-2xl sm:rounded-3xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">New hot take</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-black/5 dark:hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        {/* Post type toggle */}
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
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted"
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>

        <textarea
          ref={textareaRef}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          placeholder="Say the thing everyone is thinking…"
          aria-label="Post text"
          className="w-full resize-none rounded-2xl border border-hairline bg-surface p-3 text-[15px] outline-none placeholder:text-muted focus:border-accent/60"
        />

        <div className="mb-2 flex justify-end">
          <span
            className={`font-mono text-xs ${
              remaining < 0 ? "text-red-500" : "text-muted"
            }`}
          >
            {remaining}
          </span>
        </div>

        {postType === "image" && (
          <input
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            placeholder="https://example.com/image.jpg"
            aria-label="Image URL"
            inputMode="url"
            className="mb-2 w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent/60"
          />
        )}

        {postType === "link" && (
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/article"
            aria-label="Link URL"
            inputMode="url"
            className="mb-2 w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent/60"
          />
        )}

        <input
          value={authorName}
          onChange={(event) => setAuthorName(event.target.value)}
          placeholder="Nickname (optional — blank posts as anonymous)"
          aria-label="Nickname"
          maxLength={40}
          className="mb-3 w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent/60"
        />

        {/* AI panel */}
        <div className="mb-3 rounded-2xl border border-hairline p-3">
          <button
            type="button"
            onClick={() => setAiOpen((value) => !value)}
            aria-expanded={aiOpen}
            className="flex w-full items-center justify-between text-sm font-medium"
          >
            <span className="flex items-center gap-2">
              <span aria-hidden>✨</span> Generate with AI
            </span>
            <span aria-hidden className="text-muted">
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
                  className="min-w-0 flex-1 rounded-xl border border-hairline bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent/60"
                />
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={generating || aiPrompt.trim() === ""}
                  className="shrink-0 rounded-xl bg-foreground px-3 py-2 text-sm font-semibold text-background disabled:opacity-40"
                >
                  {generating ? "…" : "Draft"}
                </button>
              </div>
              {aiNote && <p className="mt-2 text-xs text-muted">{aiNote}</p>}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mb-2 text-sm text-red-500">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-full bg-accent py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? "Posting…" : "Post it"}
        </button>
      </form>
    </div>
  );
}
