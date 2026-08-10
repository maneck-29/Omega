"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SubredditRule } from "@/lib/types";

/**
 * Rules CRUD with reordering.
 *
 * Reordering sends the complete id list; the API rejects a partial one rather
 * than leaving positions inconsistent.
 */
export default function RulesEditor({
  slug,
  initialRules,
}: {
  slug: string;
  initialRules: SubredditRule[];
}) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(
    input: RequestInfo,
    init: RequestInit,
  ): Promise<Record<string, unknown> | null> {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(input, init);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed (${response.status})`);
      }
      router.refresh();
      return payload;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
      return null;
    } finally {
      setPending(false);
    }
  }

  async function addRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = await call(`/api/subreddits/${slug}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description }),
    });

    if (payload?.rule) {
      setRules((current) => [...current, payload.rule as SubredditRule]);
      setTitle("");
      setDescription("");
    }
  }

  async function saveEdit(ruleId: string) {
    const payload = await call(`/api/subreddits/${slug}/rules/${ruleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle, description: editDescription }),
    });

    if (payload?.rule) {
      const updated = payload.rule as SubredditRule;
      setRules((current) =>
        current.map((rule) => (rule.id === ruleId ? updated : rule)),
      );
      setEditingId(null);
    }
  }

  async function deleteRule(ruleId: string) {
    const payload = await call(`/api/subreddits/${slug}/rules/${ruleId}`, {
      method: "DELETE",
    });
    if (payload?.deleted) {
      setRules((current) => current.filter((rule) => rule.id !== ruleId));
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;

    const reordered = [...rules];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    // Optimistic: the list reorders immediately, then the server confirms.
    setRules(reordered);

    const payload = await call(`/api/subreddits/${slug}/rules/reorder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ruleIds: reordered.map((rule) => rule.id) }),
    });

    if (payload?.rules) {
      setRules(payload.rules as SubredditRule[]);
    } else {
      setRules(rules); // Roll back to the pre-move order.
    }
  }

  const inputClass =
    "w-full rounded-md border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-black/40 dark:border-white/[.16] dark:focus:border-white/40";
  const iconButtonClass =
    "rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-black/[.06] disabled:opacity-30 dark:hover:bg-white/[.10]";

  return (
    <div className="flex flex-col gap-4">
      {rules.length === 0 ? (
        <p className="text-sm text-zinc-500">No rules yet.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-black/[.06] rounded-lg border border-black/[.08] dark:divide-white/[.08] dark:border-white/[.12]">
          {rules.map((rule, index) => (
            <li key={rule.id} className="px-4 py-3">
              {editingId === rule.id ? (
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    maxLength={100}
                    className={inputClass}
                  />
                  <textarea
                    value={editDescription}
                    onChange={(event) => setEditDescription(event.target.value)}
                    rows={2}
                    maxLength={500}
                    className={`${inputClass} resize-y`}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveEdit(rule.id)}
                      disabled={pending || editTitle.trim() === ""}
                      className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-40"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-full px-3 py-1 text-xs font-medium text-zinc-500 hover:bg-black/[.04] dark:hover:bg-white/[.08]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {index + 1}. {rule.title}
                    </p>
                    {rule.description && (
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {rule.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={pending || index === 0}
                      aria-label="Move rule up"
                      className={iconButtonClass}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={pending || index === rules.length - 1}
                      aria-label="Move rule down"
                      className={iconButtonClass}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(rule.id);
                        setEditTitle(rule.title);
                        setEditDescription(rule.description);
                      }}
                      className={iconButtonClass}
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteRule(rule.id)}
                      disabled={pending}
                      className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-red-500/[.10] hover:text-red-600 disabled:opacity-30 dark:hover:text-red-400"
                    >
                      delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <form
        onSubmit={addRule}
        className="flex flex-col gap-2 rounded-lg border border-black/[.08] p-4 dark:border-white/[.12]"
      >
        <p className="text-sm font-medium">Add a rule</p>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Rule title"
          aria-label="Rule title"
          maxLength={100}
          className={inputClass}
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Description (optional)"
          aria-label="Rule description"
          rows={2}
          maxLength={500}
          className={`${inputClass} resize-y`}
        />
        <button
          type="submit"
          disabled={pending || title.trim() === ""}
          className="self-start rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Add rule"}
        </button>
      </form>
    </div>
  );
}
