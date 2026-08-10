"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * Banner and icon upload. Rendered only when the S3 integration is connected;
 * otherwise the settings form's URL fields remain the way to set an image.
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

  async function upload(file: File) {
    setPending(true);
    setError(null);

    // Mirrors the server check so an oversized file is not sent at all.
    if (file.size > maxBytes) {
      setError(`File must be at most ${Math.floor(maxBytes / 1024 / 1024)} MB`);
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
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Current ${kind}`}
          className={
            kind === "banner"
              ? "h-16 w-full rounded object-cover"
              : "h-12 w-12 rounded-full object-cover"
          }
        />
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
        PNG, JPEG, WebP, or GIF up to {Math.floor(maxBytes / 1024 / 1024)} MB.
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
