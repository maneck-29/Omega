import { getObject, isMediaConfigured } from "@/lib/media";

type Params = { params: Promise<{ key: string[] }> };

/**
 * GET /api/media/<key> — serves an uploaded image.
 *
 * Omega provisions buckets with public access fully blocked, so the S3 endpoint
 * returns 403 to a browser. Reading objects back through the app keeps those
 * protections intact: the bucket stays private and only this route, holding the
 * server's credentials, can read from it.
 *
 * No authentication. These are community banners and icons, already visible to
 * anyone who can load the page that shows them, and a signed-out visitor has to
 * be able to render one.
 *
 * The key is confined to the `subreddits/` prefix, so this cannot be used to read
 * arbitrary objects out of a bucket that may hold other things.
 */
export async function GET(_request: Request, { params }: Params) {
  if (!isMediaConfigured()) {
    return new Response("Media storage is not configured", { status: 404 });
  }

  const { key: segments } = await params;
  const key = segments.join("/");

  /*
   * Reject traversal and anything outside the prefix this app writes. Next
   * normalises `..` in a URL path before routing, so this is defence in depth
   * rather than the only check.
   */
  if (!key.startsWith("subreddits/") || key.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const object = await getObject(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(object.body as BodyInit, {
    headers: {
      "Content-Type": object.contentType,
      // Keys carry a UUID, so an object never changes under the same URL.
      "Cache-Control": "public, max-age=31536000, immutable",
      // The bytes were sniffed as an image on upload, but say so explicitly:
      // a browser must never be talked into treating one as something else.
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(object.body.byteLength),
    },
  });
}
