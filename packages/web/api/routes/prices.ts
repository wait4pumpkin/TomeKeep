// api/routes/prices.ts
// Read-only price cache — written by desktop, consumed by PWA

import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { dbAll } from '../lib/db.ts'

const prices = new Hono<HonoEnv>()
prices.use('*', authMiddleware)

interface PriceCacheRow {
  id: string
  owner_id: string
  book_isbn: string
  channel: string
  status: string
  price_cny: number | null
  url: string | null
  product_id: string | null
  source: string | null
  fetched_at: string
}

// GET /api/prices/:isbn
// Returns price cache rows for the given ISBN, sorted by price ascending (nulls last).
prices.get('/:isbn', async (c) => {
  const { sub } = c.var.user
  const isbn = c.req.param('isbn')

  const rows = await dbAll<PriceCacheRow>(
    c.env.DB,
    `SELECT * FROM price_cache
     WHERE owner_id = ? AND book_isbn = ?
     ORDER BY
       CASE WHEN price_cny IS NULL THEN 1 ELSE 0 END,
       price_cny ASC`,
    sub, isbn,
  )

  return c.json(rows)
})

export default prices
