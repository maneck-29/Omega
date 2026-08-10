"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

function describeLimit(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.floor(bytes / 1024 / 1024)} MB`
    : `${Math.floor(bytes / 1024)} KB`;
}

/**
 * Banner and icon upload.
 *
 * Always rendered: the server stores the bytes in S3 when the integration is
 * connected and inlines them into the record when it is not, so picking a file
 * works either way. `maxBytes` differs between those two, which is why the limit
 * comes from the server rather than being hardcoded here.
 */
export default function ImageUploader({
  slug,
  kind,
  currentUrl,
  maxBytes,
}: {
  slug: string;
  kind: "banner" | "icon";
  currentUrl: string | null;
  maxBytes: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState(currentUrl);

  async function clear() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/subreddits/${slug}/images?kind=${kind}`,
        { method: "DELETE" },
      );

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? `Could not remove (${response.status})`);
      }

      setUrl(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove");
    } finally {
      setPending(false);
    }
  }

  async function upload(file: File) {
    setPending(true);
    setError(null);

    // Mirrors the server check so an oversized file is not sent at all.
    if (file.size > maxBytes) {
      setError(`File must be at most ${describeLimit(maxBytes)}`);
      setPending(false);
      return;
    }

    try {
      const body = new FormData();
      body.set("file", file);
      body.set("kind", kind);

      const response = await fetch(`/api/subreddits/${slug}/images`, {
        method: "POST",
        body,
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? `Upload failed (${response.status})`);
      }

      setUrl(payload.url as string);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium capitalize">{kind}</span>

      {url && (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Current ${kind}`}
            className={
              kind === "banner"
                ? "h-16 flex-1 rounded object-cover"
                : "h-12 w-12 rounded-full object-cover"
            }
          />
          <button
            type="button"
            onClick={() => void clear()}
            disabled={pending}
            className="shrink-0 rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-40 dark:text-red-400"
          >
            Remove
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label={`Upload ${kind}`}
        disabled={pending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
        className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-foreground file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-background disabled:opacity-40"
      />

      <p className="text-xs text-zinc-500">
        PNG, JPEG, WebP, or GIF up to {describeLimit(maxBytes)}.
        {pending && " Uploading…"}
      </p>

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
