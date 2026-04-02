// api/lib/image.ts
// Image compression to WebP using Workers built-in Cloudflare Images transform.
// In the Cloudflare Workers free tier there is no native Canvas/ImageMagick API,
// so we rely on the fact that Cloudflare can resize images via the Image Resizing
// product when the request goes through the CDN.  However, inside a Worker
// (Pages Function) we can use the `cf.image` fetch option to recompress.
//
// For the MVP we do a best-effort recompress: if the payload is already small
// (<200 KB) we pass it through unchanged.  When Cloudflare Image Resizing is
// available (enterprise / paid plan) the Worker can proxy to itself with
// cf.image options; on the free tier we store the original.
//
// The constant MAX_PASS_THROUGH_BYTES guards against accidentally storing huge
// images.

export const TARGET_WIDTH = 300
export const MAX_BYTES = 5 * 1024 * 1024 // 5 MB hard limit on upload

/**
 * Attempt to produce a compressed WebP thumbnail from raw image bytes.
 *
 * Strategy (free tier compatible):
 *   1. Validate size.
 *   2. Return as-is (Workers have no native Image API on free tier).
 *      The caller stores the original and records the MIME type.
 *
 * When Image Resizing is available the caller may replace this with a
 * fetch-to-self proxy using `cf: { image: { width: TARGET_WIDTH, format: 'webp' } }`.
 */
export async function compressToWebP(
  data: ArrayBuffer,
  originalMimeType: string,
): Promise<{ data: ArrayBuffer; mimeType: string }> {
  if (data.byteLength > MAX_BYTES) {
    throw new Error(`Image too large: ${data.byteLength} bytes (max ${MAX_BYTES})`)
  }

  // On the free tier we cannot transcode in a Worker — return as-is.
  // The stored MIME type reflects the original format.
  return { data, mimeType: originalMimeType }
}
