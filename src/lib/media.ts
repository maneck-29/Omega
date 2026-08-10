/**
 * Image uploads for subreddit banners and icons, backed by the Omega S3
 * integration.
 *
 * Omega injects `BUCKET_NAME` and `BUCKET_REGION` at build and runtime. These
 * are server-side only — they carry no `NEXT_PUBLIC_` prefix, so browser code
 * never sees them, which is why uploads go through a route handler.
 *
 * `isMediaConfigured()` lets callers degrade to the existing URL fields when the
 * integration is absent, so local development works without AWS.
 */

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { badRequest } from "./errors";
import type { SubredditId } from "./types";

/** Formats browsers render reliably, matched against the sniffed bytes. */
const ALLOWED_TYPES = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

/**
 * 4 MB. Uploads pass through the route handler, and API Gateway caps a request
 * body at 6 MB; staying under it leaves room for multipart overhead. Larger
 * files would need a presigned URL so the browser uploads to S3 directly.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export type MediaKind = "banner" | "icon";

export function isMediaConfigured(): boolean {
  return Boolean(process.env.BUCKET_NAME);
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!process.env.BUCKET_NAME) {
    throw new Error(
      "BUCKET_NAME is not set. Connect the Omega S3 integration, or leave it " +
        "unset to keep using plain image URLs.",
    );
  }
  // Cached: constructing a client per request re-resolves credentials.
  client ??= new S3Client({ region: process.env.BUCKET_REGION });
  return client;
}

/**
 * Verifies the declared MIME type against the file's magic bytes.
 *
 * `file.type` comes from the browser and is trivially spoofed, so trusting it
 * alone would let an attacker store an executable payload under an image
 * content-type.
 */
function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;

  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);

  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png";
  }
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";

  // WEBP: "RIFF" .... "WEBP"
  const ascii = (offset: number, text: string) =>
    [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";

  return null;
}

/**
 * Validates and stores an image, returning the key and public URL.
 *
 * Keys are prefixed per subreddit so a lifecycle rule or bulk delete can target
 * one community, and carry a UUID so re-uploads never collide or serve a stale
 * cached object.
 */
export async function uploadSubredditImage(
  subredditId: SubredditId,
  kind: MediaKind,
  file: File,
): Promise<{ key: string; url: string }> {
  if (file.size === 0) {
    throw badRequest("File is empty", "empty_file");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw badRequest(
      `File must be at most ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
      "file_too_large",
    );
  }

  const declared = file.type.toLowerCase();
  if (!ALLOWED_TYPES.has(declared)) {
    throw badRequest(
      `Unsupported image type "${file.type || "unknown"}". Allowed: PNG, JPEG, WebP, GIF.`,
      "unsupported_type",
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);

  if (sniffed === null) {
    throw badRequest("File is not a recognised image", "not_an_image");
  }
  // JPEG is the one type where the declared and sniffed labels can differ
  // harmlessly across browsers; otherwise a mismatch means a spoofed type.
  if (sniffed !== declared) {
    throw badRequest(
      `File contents (${sniffed}) do not match the declared type (${declared})`,
      "type_mismatch",
    );
  }

  const extension = ALLOWED_TYPES.get(declared)!;
  const key = `subreddits/${subredditId}/${kind}-${crypto.randomUUID()}.${extension}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: key,
      Body: bytes,
      ContentType: sniffed,
      // Long-lived: the UUID in the key makes every object immutable.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return { key, url: publicUrl(key) };
}

/**
 * Public URL for a stored object.
 *
 * Uses the bucket's regional endpoint. If the bucket is private, this becomes a
 * CloudFront domain or a presigned GET instead — hence the single accessor.
 */
export function publicUrl(key: string): string {
  const bucket = process.env.BUCKET_NAME;
  const region = process.env.BUCKET_REGION;
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

/** Best-effort cleanup when an image is replaced or a subreddit is reset. */
export async function deleteObject(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: key,
    }),
  );
}

/**
 * Extracts the object key from a URL this app produced.
 *
 * Returns null for externally hosted images, so replacing one never attempts a
 * delete against a bucket that does not own it.
 */
export function keyFromUrl(url: string | null): string | null {
  if (!url || !process.env.BUCKET_NAME) return null;

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.startsWith(`${process.env.BUCKET_NAME}.`)) return null;
    const key = parsed.pathname.replace(/^\//, "");
    return key.startsWith("subreddits/") ? key : null;
  } catch {
    return null;
  }
}
