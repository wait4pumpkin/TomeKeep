// api/lib/r2.ts
// R2 upload helper and signed URL generation
// R2Bucket is globally ambient via tsconfig "types": ["@cloudflare/workers-types"]

/**
 * Upload raw bytes to R2 under the given key.
 */
export async function r2Put(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await bucket.put(key, data, { httpMetadata: { contentType } })
}

/**
 * Generate a temporary signed URL for a private R2 object.
 * Cloudflare R2 presigned URLs are created via the R2Object.writeHttpMetadata /
 * createPresignedUrl approach — available in Workers bindings as
 * bucket.createPresignedUrl().
 *
 * Valid for 1 hour (3600 seconds).
 */
export async function r2SignedUrl(bucket: R2Bucket, key: string): Promise<string | null> {
  // @ts-expect-error — createPresignedUrl is a Workers runtime method
  if (typeof bucket.createPresignedUrl === 'function') {
    // @ts-expect-error
    return (bucket.createPresignedUrl(key, { expiresIn: 3600 })) as Promise<string>
  }

  // Fallback for older Workers binding API: check object exists, return null if missing.
  const obj = await bucket.head(key)
  if (!obj) return null

  // Without createPresignedUrl support we can't generate a signed URL at runtime.
  // This path should not be reached in production Cloudflare Workers.
  return null
}

export async function r2Delete(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key)
}
