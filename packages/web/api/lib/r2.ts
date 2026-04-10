// api/lib/r2.ts
// R2 upload/delete helpers.
// R2Bucket is globally ambient via tsconfig "types": ["@cloudflare/workers-types"]

/** 7-day public cache TTL for cover images (in seconds). */
const COVER_CACHE_TTL = 60 * 60 * 24 * 7 // 604800

/**
 * Upload raw bytes to R2 under the given key.
 * Sets Cache-Control so Cloudflare CDN and browsers cache the object for 7 days.
 */
export async function r2Put(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await bucket.put(key, data, {
    httpMetadata: {
      contentType,
      cacheControl: `public, max-age=${COVER_CACHE_TTL}`,
    },
  })
}

/**
 * Upload raw bytes to R2 under a temporary key (no cache headers).
 * Used during image compression: write original → transform → delete.
 */
export async function r2PutTmp(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await bucket.put(key, data, { httpMetadata: { contentType } })
}

export async function r2Delete(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key)
}
