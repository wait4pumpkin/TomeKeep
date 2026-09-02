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

function isAllowedMetadataCoverUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return host === 'covers.openlibrary.org' ||
      host === 'douban.com' || host.endsWith('.douban.com') ||
      host === 'doubanio.com' || host.endsWith('.doubanio.com')
  } catch {
    return false
  }
}

async function persistCover(
  env: HonoEnv['Bindings'],
  ownerId: string,
  originalData: ArrayBuffer,
  originalMime: string,
): Promise<string> {
  // Miniflare's R2 bucket is not reachable through the production CDN, so a
  // local upload cannot use the production Image Resizing round-trip. Store
  // the original directly; production keeps the compressed WebP pipeline.
  if (!env.CF_PAGES) {
    const ext = originalMime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
    const coverKey = `covers/${ownerId}/${crypto.randomUUID()}.${ext}`
    await r2Put(env.COVERS, coverKey, originalData, originalMime)
    return coverKey
  }

  const tmpUuid = crypto.randomUUID()
  const ext = originalMime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
  const tmpKey = `tmp/${ownerId}/${tmpUuid}.${ext}`
  await r2PutTmp(env.COVERS, tmpKey, originalData, originalMime)

  const tmpPublicUrl = `${env.COVERS_PUBLIC_URL}/${tmpKey}`
  let compressedData: ArrayBuffer
  let finalMime: string
  try {
    ;({ data: compressedData, mimeType: finalMime } = await compressToWebP(
      tmpPublicUrl,
      originalData,
      originalMime,
    ))
  } finally {
    await r2Delete(env.COVERS, tmpKey).catch(() => undefined)
  }

  const finalExt = finalMime === 'image/webp' ? 'webp' : finalMime.split('/')[1] ?? 'jpg'
  const coverKey = `covers/${ownerId}/${crypto.randomUUID()}.${finalExt}`
  await r2Put(env.COVERS, coverKey, compressedData, finalMime)
  return coverKey
}

async function fetchAllowedCover(raw: string): Promise<Response | null> {
  let current = raw
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!isAllowedMetadataCoverUrl(current)) return null
    const hostname = new URL(current).hostname.toLowerCase()
    const isDouban = hostname === 'douban.com' || hostname.endsWith('.douban.com') ||
      hostname === 'doubanio.com' || hostname.endsWith('.doubanio.com')
    const res = await fetch(current, {
      redirect: 'manual',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
        ...(isDouban ? { Referer: 'https://book.douban.com/' } : {}),
      },
    })
    if (res.status < 300 || res.status >= 400) return res
    const location = res.headers.get('Location')
    if (!location) return null
    current = new URL(location, current).toString()
  }
  return null
}

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

  const coverKey = await persistCover(c.env, sub, originalData, originalMime)

  return c.json({ coverKey })
})

// POST /api/covers/import
// Imports a cover returned by a trusted metadata provider. The strict host
// allowlist and post-redirect validation prevent this endpoint becoming an
// arbitrary server-side fetch primitive.
covers.post('/import', async (c) => {
  const { sub } = c.var.user
  const body = await c.req.json<{ url?: string }>()
  if (!body.url || !isAllowedMetadataCoverUrl(body.url)) {
    return c.json({ error: 'invalid_cover_url' }, 400)
  }

  const res = await fetchAllowedCover(body.url).catch(() => null)
  if (!res?.ok) {
    return c.json({ error: 'cover_fetch_failed' }, 422)
  }

  const mime = (res.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
  if (!mime.startsWith('image/')) return c.json({ error: 'invalid_cover_type' }, 422)

  const declaredSize = Number(res.headers.get('Content-Length') ?? 0)
  if (declaredSize > MAX_BYTES) {
    return c.json({ error: 'file_too_large', maxBytes: MAX_BYTES }, 413)
  }
  const data = await res.arrayBuffer()
  if (data.byteLength > MAX_BYTES) {
    return c.json({ error: 'file_too_large', maxBytes: MAX_BYTES }, 413)
  }

  const coverKey = await persistCover(c.env, sub, data, mime)
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

  // In local development there is no public CDN in front of Miniflare R2.
  // Stream the object through the authenticated same-origin API instead.
  if (!c.env.CF_PAGES) {
    const object = await c.env.COVERS.get(key)
    if (!object) return c.json({ error: 'not_found' }, 404)
    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set('ETag', object.httpEtag)
    return new Response(object.body, { headers })
  }

  // Redirect to the public CDN URL — Cloudflare CDN and the browser will
  // cache the image for 7 days (set by Cache-Control on the R2 object).
  return c.redirect(`${c.env.COVERS_PUBLIC_URL}/${key}`, 302)
})

export default covers
