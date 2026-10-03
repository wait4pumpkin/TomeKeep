import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { dbAll, dbRun } from '../lib/db.ts'

const priceCache = new Hono<HonoEnv>()
priceCache.use('*', authMiddleware)

interface PriceRow {
  id: string
  owner_id: string
  cache_key: string | null
  title: string | null
  author: string | null
  book_isbn: string
  channel: string
  status: string
  price_cny: number | null
  url: string | null
  product_id: string | null
  source: string | null
  message: string | null
  fetched_at: string
  expires_at: string | null
  updated_at: string
}

priceCache.get('/', async (c) => {
  const { sub } = c.var.user
  const requested = Number(c.req.query('page_size') ?? 250)
  const pageSize = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 500) : 250
  const pageUpdatedAt = c.req.query('page_updated_at')
  const pageAfter = c.req.query('page_after')
  const params: unknown[] = [sub]
  let cursor = ''
  if (pageUpdatedAt && pageAfter) {
    cursor = ' AND (updated_at > ? OR (updated_at = ? AND id > ?))'
    params.push(pageUpdatedAt, pageUpdatedAt, pageAfter)
  }
  params.push(pageSize + 1)
  const page = await dbAll<PriceRow>(
    c.env.DB,
    `SELECT * FROM price_cache
     WHERE owner_id = ? AND cache_key IS NOT NULL AND title IS NOT NULL
       AND expires_at IS NOT NULL AND url IS NOT NULL${cursor}
     ORDER BY updated_at ASC, id ASC LIMIT ?`,
    ...params,
  )
  const hasMore = page.length > pageSize
  const items = page.slice(0, pageSize)
  const last = items.at(-1)
  return c.json({
    items,
    next_cursor: hasMore && last ? { updated_at: last.updated_at, after: last.id } : null,
  })
})

priceCache.put('/', async (c) => {
  const { sub } = c.var.user
  const body = await c.req.json<{
    cache_key?: string
    title?: string
    author?: string | null
    book_isbn?: string | null
    channel?: string
    status?: string
    price_cny?: number | null
    url?: string
    product_id?: string | null
    source?: string | null
    message?: string | null
    fetched_at?: string
    expires_at?: string
    updated_at?: string
  }>()
  const channels = new Set(['jd', 'dangdang', 'bookschina'])
  const statuses = new Set(['ok', 'needs_login', 'blocked', 'not_found', 'error'])
  if (!body.cache_key || body.cache_key.length > 512 || body.title === undefined || body.title.length > 500) {
    return c.json({ error: 'invalid_cache_entry' }, 400)
  }
  if (!body.channel || !channels.has(body.channel) || !body.status || !statuses.has(body.status)) {
    return c.json({ error: 'invalid_quote' }, 400)
  }
  if ((body.author?.length ?? 0) > 500 || (body.book_isbn?.length ?? 0) > 32 ||
      (body.product_id?.length ?? 0) > 128 || (body.message?.length ?? 0) > 1_000 ||
      (body.url?.length ?? 0) > 2_048 ||
      (body.source != null && !['manual', 'auto'].includes(body.source))) {
    return c.json({ error: 'invalid_quote' }, 400)
  }
  if (!body.url || !body.fetched_at || !body.expires_at || !body.updated_at) {
    return c.json({ error: 'timestamps_and_url_required' }, 400)
  }
  if (![body.fetched_at, body.expires_at, body.updated_at].every(value => Number.isFinite(Date.parse(value)))) {
    return c.json({ error: 'invalid_timestamp' }, 400)
  }
  let quoteURL: URL
  try { quoteURL = new URL(body.url) } catch { return c.json({ error: 'invalid_url' }, 400) }
  if (quoteURL.protocol !== 'https:') return c.json({ error: 'invalid_url' }, 400)
  if (body.price_cny != null && (!Number.isFinite(body.price_cny) || body.price_cny <= 0)) {
    return c.json({ error: 'invalid_price' }, 400)
  }

  const id = `${sub}\u001f${body.cache_key}\u001f${body.channel}`
  await dbRun(
    c.env.DB,
    `INSERT INTO price_cache (
       id, owner_id, cache_key, title, author, book_isbn, channel, status,
       price_cny, url, product_id, source, message, fetched_at, expires_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?), datetime(?), datetime(?))
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, author = excluded.author, book_isbn = excluded.book_isbn,
       status = excluded.status, price_cny = excluded.price_cny, url = excluded.url,
       product_id = excluded.product_id, source = excluded.source, message = excluded.message,
       fetched_at = excluded.fetched_at, expires_at = excluded.expires_at,
       updated_at = excluded.updated_at
     WHERE datetime(excluded.updated_at) >= datetime(price_cache.updated_at)`,
    id, sub, body.cache_key, body.title, body.author ?? null, body.book_isbn ?? '',
    body.channel, body.status, body.price_cny ?? null, body.url,
    body.product_id ?? null, body.source ?? null, body.message ?? null,
    body.fetched_at, body.expires_at, body.updated_at,
  )
  return c.json({ ok: true })
})

export default priceCache
