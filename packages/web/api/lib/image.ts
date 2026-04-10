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
// Error policy:
//   - In production: any failure (non-2xx response or thrown error that is
//     NOT a "cf unsupported" dev-environment TypeError) is re-thrown so the
//     upload handler returns 422. We never silently store an oversized original.
//   - In local dev (miniflare): cf.image is not supported and throws a
//     TypeError whose message contains "cf" or similar. We detect this and
//     fall back to storing the original so dev still works.

export const TARGET_WIDTH = 400
export const QUALITY = 85
export const MAX_BYTES = 2 * 1024 * 1024 // 2 MB hard limit on upload

/**
 * Returns true when the error looks like miniflare / local-dev rejecting the
 * `cf` fetch option. In production this option is silently supported by the
 * Workers runtime, so any error there is a genuine failure.
 */
function isLocalDevUnsupported(err: unknown): boolean {
  const msg = String(err).toLowerCase()
  // miniflare throws: "TypeError: 'cf' is not a standard property of Request init"
  // or variations depending on the version.
  return msg.includes("'cf'") || msg.includes('"cf"') || msg.includes('not a standard')
}

/**
 * Compress an image to WebP using Cloudflare Image Resizing.
 *
 * @param tmpPublicUrl  Publicly reachable URL of the already-uploaded original
 *                      (e.g. https://covers.cbbnews.top/tmp/<uuid>.jpg).
 *                      Must be served from a Cloudflare-proxied zone for
 *                      Image Resizing to activate.
 * @param originalData  Raw bytes of the original — used as fallback only in
 *                      local dev when cf.image is not supported.
 * @param originalMime  MIME type of the original (e.g. "image/jpeg").
 * @returns             Compressed bytes + final MIME type.
 * @throws              In production if Image Resizing returns a non-2xx
 *                      response or the fetch itself fails.
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
      // Production Image Resizing failure — reject the upload.
      throw new Error(`Image Resizing failed with HTTP ${res.status}`)
    }

    const mimeType = res.headers.get('Content-Type') ?? 'image/webp'
    const data = await res.arrayBuffer()
    return { data, mimeType }
  } catch (err) {
    if (isLocalDevUnsupported(err)) {
      // Local dev (miniflare): cf.image not supported — fall back silently.
      console.warn('[image] cf.image not available in local dev, storing original')
      return { data: originalData, mimeType: originalMime }
    }
    // Production failure — re-throw so the upload handler returns 422.
    throw err
  }
}
