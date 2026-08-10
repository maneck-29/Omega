/**
 * Image URL shapes, with no AWS SDK dependency.
 *
 * Split out of `media.ts` so the read path can normalise a stored URL without
 * pulling the S3 client into every render. `media.ts` re-exports these, so
 * existing imports keep working.
 */

/** Path prefix produced by `publicUrl`. */
export const MEDIA_ROUTE = "/api/media/";

/**
 * URL that serves a stored object.
 *
 * Omega provisions buckets with all four public-access blocks enabled, so the S3
 * regional endpoint returns 403 to a browser. Rather than weaken those
 * protections — they are why an uploaded file cannot become a public host for
 * anything — objects are served back through this app, which reads them with the
 * server's credentials.
 */
export function publicUrl(key: string): string {
  // Each segment is encoded separately so the slashes stay real path separators.
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${MEDIA_ROUTE}${encoded}`;
}

/**
 * Extracts the object key from a URL this app produced.
 *
 * Returns null for externally hosted images and for inlined `data:` URLs, so
 * replacing one never attempts a delete against a bucket that does not own it.
 *
 * Two shapes are recognised. The current one is the relative `/api/media/<key>`
 * path; the S3 regional endpoint is still accepted because rows written before
 * images were served through the app hold that form, and those objects must
 * remain deletable.
 */
export function keyFromUrl(url: string | null): string | null {
  if (!url || !process.env.BUCKET_NAME) return null;

  const validate = (key: string) =>
    key.startsWith("subreddits/") ? key : null;

  if (url.startsWith(MEDIA_ROUTE)) {
    return validate(decodeURIComponent(url.slice(MEDIA_ROUTE.length)));
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.startsWith(`${process.env.BUCKET_NAME}.`)) return null;
    return validate(decodeURIComponent(parsed.pathname.replace(/^\//, "")));
  } catch {
    return null;
  }
}

/**
 * Rewrites a stored absolute S3 URL to the `/api/media/` path.
 *
 * Returns null when the value needs no change, so a caller writing to the
 * database can skip the write.
 */
export function migratedUrl(url: string | null): string | null {
  if (!url || url.startsWith(MEDIA_ROUTE)) return null;

  const key = keyFromUrl(url);
  return key ? publicUrl(key) : null;
}

/**
 * The URL to render for a stored value.
 *
 * Applied on every read rather than relying on the stored value being correct.
 * Rows written before images were served through the app hold an absolute S3
 * URL, which a browser cannot load because the bucket blocks public access — so
 * normalising at read time fixes those without depending on a migration having
 * run first, on a particular page having triggered seeding, or on a cached page
 * being regenerated.
 *
 * Returns the value unchanged when it is already correct, external, or a `data:`
 * URL.
 */
export function renderableUrl(url: string | null): string | null {
  return url === null ? null : (migratedUrl(url) ?? url);
}
