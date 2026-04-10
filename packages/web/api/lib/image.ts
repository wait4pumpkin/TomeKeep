// api/lib/image.ts
// Cover image compression via Cloudflare Image Resizing.
//
// Strategy:
//   1. Client uploads the original image (max 2 MB).
//   2. We write the original to a temporary R2 key so it has a public URL.
//   3. We fetch that URL through the Cloudflare CDN with cf.image options,
//      which triggers Image Resizing: resize to TARGET_WIDTH px wide, convert
//      to WebP at QUALITY. This works on all Cloudflare plans (free tier
//      includes 5,000 unique transformations/month).
//   4. We return the compressed WebP bytes for the caller to write to the
//      final R2 key (and delete the temporary key).
//
// If Image Resizing is unavailable (e.g. local dev / miniflare), we fall back
// to storing the original so dev still works.

export const TARGET_WIDTH = 400
export const QUALITY = 85
export const MAX_BYTES = 2 * 1024 * 1024 // 2 MB hard limit on upload

/**
 * Compress an image to WebP using Cloudflare Image Resizing.
 *
 * @param tmpPublicUrl  Publicly reachable URL of the already-uploaded original
 *                      (e.g. https://covers.cbbnews.top/tmp/<uuid>.jpg).
 *                      Must be served from a Cloudflare-proxied zone for
 *                      Image Resizing to activate.
 * @param originalData  Raw bytes of the original — used as fallback when
 *                      Image Resizing is not available (local dev).
 * @param originalMime  MIME type of the original (e.g. "image/jpeg").
 * @returns             Compressed bytes + final MIME type.
 */
export async function compressToWebP(
  tmpPublicUrl: string,
  originalData: ArrayBuffer,
  originalMime: string,
): Promise<{ data: ArrayBuffer; mimeType: string }> {
  try {
    const res = await fetch(tmpPublicUrl, {
      cf: {
        image: {
          width: TARGET_WIDTH,
          format: 'webp',
          quality: QUALITY,
          fit: 'scale-down', // never upscale small covers
        },
      },
    })

    if (!res.ok) {
      // Image Resizing returned an error — fall back to original
      console.warn(`[image] resize fetch failed (${res.status}), storing original`)
      return { data: originalData, mimeType: originalMime }
    }

    const mimeType = res.headers.get('Content-Type') ?? 'image/webp'
    const data = await res.arrayBuffer()
    return { data, mimeType }
  } catch (err) {
    // cf.image not available in local dev (miniflare) — fall back silently
    console.warn('[image] Image Resizing unavailable, storing original:', err)
    return { data: originalData, mimeType: originalMime }
  }
}
