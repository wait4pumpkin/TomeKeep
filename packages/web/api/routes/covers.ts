// api/routes/covers.ts
// Cover image upload (compress → R2) and CDN redirect for serving.

import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { dbFirst } from '../lib/db.ts'
import { r2Put, r2PutTmp, r2Delete } from '../lib/r2.ts'
import { compressToWebP, MAX_BYTES } from '../lib/image.ts'

const covers = new Hono<HonoEnv>()
covers.use('*', authMiddleware)

// POST /api/covers/upload
// Accepts multipart/form-data with field "file".
// Pipeline: write original to tmp R2 key → compress via Image Resizing → store
// final WebP → delete tmp key → return { coverKey }.
covers.post('/upload', async (c) => {
  const { sub } = c.var.user

  const formData = await c.req.formData()
  const file = formData.get('file')

  if (!file || typeof file === 'string') {
    return c.json({ error: 'file_required' }, 400)
  }

  const blob = file as File
  if (blob.size > MAX_BYTES) {
    return c.json({ error: 'file_too_large', maxBytes: MAX_BYTES }, 413)
  }

  const originalMime = blob.type || 'image/jpeg'
  const originalData = await blob.arrayBuffer()

  // 1. Write original to a temporary key so Image Resizing can fetch it.
  const tmpUuid = crypto.randomUUID()
  const ext = originalMime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
  const tmpKey = `tmp/${sub}/${tmpUuid}.${ext}`
  await r2PutTmp(c.env.COVERS, tmpKey, originalData, originalMime)

  // 2. Compress via Cloudflare Image Resizing using the public CDN URL.
  const tmpPublicUrl = `${c.env.COVERS_PUBLIC_URL}/${tmpKey}`
  let compressedData: ArrayBuffer
  let finalMime: string
  try {
    ;({ data: compressedData, mimeType: finalMime } = await compressToWebP(
      tmpPublicUrl,
      originalData,
      originalMime,
    ))
  } finally {
    // Always clean up the temporary object, even if compression failed.
    await r2Delete(c.env.COVERS, tmpKey).catch(() => undefined)
  }

  // 3. Store the final (compressed) image under the permanent key.
  const finalExt = finalMime === 'image/webp' ? 'webp' : finalMime.split('/')[1] ?? 'jpg'
  const uuid = crypto.randomUUID()
  const coverKey = `covers/${sub}/${uuid}.${finalExt}`
  await r2Put(c.env.COVERS, coverKey, compressedData, finalMime)

  return c.json({ coverKey })
})

// GET /api/covers/:key
// Verifies ownership then issues a permanent 302 redirect to the public CDN URL.
// The CDN URL is publicly readable but uses an unguessable UUID — cover images
// are not sensitive data (same approach as Douban / Amazon cover URLs).
covers.get('/:key{.+}', async (c) => {
  const { sub } = c.var.user
  const key = decodeURIComponent(c.req.param('key'))

  // Security: verify the cover belongs to the authenticated user.
  // Key format: covers/<owner_id>/<uuid>.<ext>
  const parts = key.split('/')
  const ownerFromKey = parts.length === 3 && parts[0] === 'covers' ? parts[1] : null

  if (ownerFromKey !== sub) {
    // Key doesn't encode the caller's id — check DB ownership.
    const bookMatch = await dbFirst<{ id: string }>(
      c.env.DB,
      'SELECT id FROM books WHERE cover_key = ? AND owner_id = ? LIMIT 1',
      key, sub,
    )
    const wishMatch = bookMatch ? null : await dbFirst<{ id: string }>(
      c.env.DB,
      'SELECT id FROM wishlist WHERE cover_key = ? AND owner_id = ? LIMIT 1',
      key, sub,
    )
    if (!bookMatch && !wishMatch) {
      return c.json({ error: 'forbidden' }, 403)
    }
  }

  // Redirect to the public CDN URL — Cloudflare CDN and the browser will
  // cache the image for 7 days (set by Cache-Control on the R2 object).
  return c.redirect(`${c.env.COVERS_PUBLIC_URL}/${key}`, 302)
})

export default covers
