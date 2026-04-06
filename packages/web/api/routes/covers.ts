// api/routes/covers.ts
// Cover image upload (compress → R2) and authenticated serve (signed URL redirect)

import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { dbFirst } from '../lib/db.ts'
import { r2Put, r2SignedUrl } from '../lib/r2.ts'
import { compressToWebP, MAX_BYTES } from '../lib/image.ts'

const covers = new Hono<HonoEnv>()
covers.use('*', authMiddleware)

// POST /api/covers/upload
// Accepts multipart/form-data with field "file"
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

  const originalMimeType = blob.type || 'image/jpeg'
  const rawBuffer = await blob.arrayBuffer()

  let data: ArrayBuffer
  let mimeType: string
  try {
    ;({ data, mimeType } = await compressToWebP(rawBuffer, originalMimeType))
  } catch (err) {
    return c.json({ error: 'image_processing_failed', detail: String(err) }, 422)
  }

  const ext = mimeType === 'image/webp' ? 'webp' : mimeType.split('/')[1] ?? 'jpg'
  const uuid = crypto.randomUUID()
  const coverKey = `covers/${sub}/${uuid}.${ext}`

  await r2Put(c.env.COVERS, coverKey, data, mimeType)

  return c.json({ coverKey })
})

// GET /api/covers/:key
// key is URL-encoded, e.g. covers%2F<uid>%2F<uuid>.webp
covers.get('/:key{.+}', async (c) => {
  const { sub } = c.var.user
  const key = decodeURIComponent(c.req.param('key'))

  // Security: verify the cover belongs to the authenticated user
  // Key format: covers/<owner_id>/<uuid>.<ext>
  const parts = key.split('/')
  if (parts.length !== 3 || parts[0] !== 'covers' || parts[1] !== sub) {
    // Could be on a book/wishlist record — check both tables
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

  // Try signed URL redirect first (production Cloudflare R2).
  // Falls back to direct streaming when createPresignedUrl is unavailable
  // (miniflare local dev environment).
  const signedUrl = await r2SignedUrl(c.env.COVERS, key)
  if (signedUrl) return c.redirect(signedUrl, 302)

  // Fallback: stream the object directly from R2
  const obj = await c.env.COVERS.get(key)
  if (!obj) return c.json({ error: 'not_found' }, 404)

  const contentType = obj.httpMetadata?.contentType ?? 'image/jpeg'
  return new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  })
})

export default covers
