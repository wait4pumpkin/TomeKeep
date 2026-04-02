// api/routes/metadata.ts
// Douban proxy (server-side fetch, no CORS) + OpenLibrary lookup
// Reuses @tomekeep/shared parsers

import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { parseDoubanSubjectHtml, extractDoubanSubjectId } from '@tomekeep/shared'
import { parseOpenLibraryBooksApiResponse } from '@tomekeep/shared'

const metadata = new Hono<HonoEnv>()
metadata.use('*', authMiddleware)

// POST /api/metadata/douban
// Body: { url: "https://book.douban.com/subject/12345/" }
// Rate limit: enforced at Cloudflare WAF level; here we do basic validation only.
metadata.post('/douban', async (c) => {
  const body = await c.req.json<{ url?: string }>()
  if (!body.url) return c.json({ error: 'url_required' }, 400)

  const subjectResult = extractDoubanSubjectId(body.url)
  if (!subjectResult.ok) return c.json({ error: 'invalid_url' }, 400)

  const subjectId = subjectResult.value
  const doubanUrl = `https://book.douban.com/subject/${subjectId}/`

  let html: string
  try {
    const res = await fetch(doubanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://book.douban.com/',
      },
    })
    if (res.status === 403 || res.status === 302) {
      return c.json({ error: 'blocked' }, 503)
    }
    if (!res.ok) {
      return c.json({ error: 'fetch_failed', status: res.status }, 502)
    }
    html = await res.text()
  } catch (err) {
    return c.json({ error: 'network_error', detail: String(err) }, 502)
  }

  const result = parseDoubanSubjectHtml(html)
  if (!result.ok) {
    return c.json({ error: result.error }, 422)
  }

  return c.json({ ...result.value, source: 'douban' })
})

// POST /api/metadata/openlib
// Body: { isbn: "9780000000000" }
metadata.post('/openlib', async (c) => {
  const body = await c.req.json<{ isbn?: string }>()
  if (!body.isbn) return c.json({ error: 'isbn_required' }, 400)

  const isbn = body.isbn.replace(/[^0-9X]/gi, '')
  const apiUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`

  let data: unknown
  try {
    const res = await fetch(apiUrl, {
      headers: { 'Accept': 'application/json' },
    })
    if (!res.ok) return c.json({ error: 'fetch_failed', status: res.status }, 502)
    data = await res.json()
  } catch (err) {
    return c.json({ error: 'network_error', detail: String(err) }, 502)
  }

  const result = parseOpenLibraryBooksApiResponse(isbn, data)
  if (!result.ok) return c.json({ error: result.error }, 404)

  return c.json({ ...result.value, source: 'openlib' })
})

export default metadata
