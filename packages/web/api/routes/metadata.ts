// api/routes/metadata.ts
// Douban proxy (server-side fetch, no CORS) + OpenLibrary lookup
// Reuses @tomekeep/shared parsers

import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import {
  canonicalizeIsbn,
  extractDoubanSubjectId,
  parseDoubanSearchHtml,
  parseDoubanSubjectHtml,
  parseOpenLibraryBooksApiResponse,
  type BookMetadata,
} from '@tomekeep/shared'

const metadata = new Hono<HonoEnv>()
metadata.use('*', authMiddleware)

const DOUBAN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': 'https://book.douban.com/',
}

async function fetchDoubanHtml(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: DOUBAN_HEADERS })
  if (!res.ok || res.status === 302) return null
  return res.text()
}

async function lookupOpenLibrary(isbn13: string): Promise<BookMetadata | null> {
  const apiUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&jscmd=data&format=json`
  const res = await fetch(apiUrl, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  const result = parseOpenLibraryBooksApiResponse(isbn13, await res.json())
  return result.ok ? result.value : null
}

async function lookupDoubanByIsbn(isbn13: string): Promise<(BookMetadata & { detailUrl: string }) | null> {
  const searchUrl = `https://www.douban.com/search?cat=1001&q=${encodeURIComponent(isbn13)}`
  const searchHtml = await fetchDoubanHtml(searchUrl)
  if (!searchHtml) return null
  const hit = parseDoubanSearchHtml(searchHtml)[0]
  if (!hit) return null
  const detailUrl = `https://book.douban.com/subject/${hit.subjectId}/`
  const subjectHtml = await fetchDoubanHtml(detailUrl)
  if (!subjectHtml) return null
  const result = parseDoubanSubjectHtml(subjectHtml)
  return result.ok ? { ...result.value, isbn13, detailUrl } : null
}

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
    const res = await fetch(doubanUrl, { headers: DOUBAN_HEADERS })
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

  const isbn = canonicalizeIsbn(body.isbn)
  if (!isbn) return c.json({ error: 'invalid_isbn' }, 400)

  try {
    const value = await lookupOpenLibrary(isbn)
    if (!value) return c.json({ error: 'not_found' }, 404)
    return c.json({ ...value, source: 'openlib' })
  } catch (err) {
    return c.json({ error: 'network_error', detail: String(err) }, 502)
  }
})

// POST /api/metadata/isbn
// Body: { isbn }. Best-effort waterfall optimized for Chinese books:
// Douban search + subject page first, then OpenLibrary.
metadata.post('/isbn', async (c) => {
  const body = await c.req.json<{ isbn?: string }>()
  const isbn13 = canonicalizeIsbn(body.isbn ?? '')
  if (!isbn13) return c.json({ error: 'invalid_isbn' }, 400)

  try {
    const douban = await lookupDoubanByIsbn(isbn13).catch(() => null)
    if (douban) return c.json({ ...douban, source: 'douban' })

    const openlib = await lookupOpenLibrary(isbn13).catch(() => null)
    if (openlib) return c.json({ ...openlib, source: 'openlib' })

    return c.json({ error: 'not_found' }, 404)
  } catch (err) {
    return c.json({ error: 'network_error', detail: String(err) }, 502)
  }
})

export default metadata
