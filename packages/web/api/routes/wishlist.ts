// api/routes/wishlist.ts
// Wishlist CRUD + move-to-inventory atomic operation

import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { dbAll, dbFirst, dbRun } from '../lib/db.ts'

const wishlist = new Hono<HonoEnv>()
wishlist.use('*', authMiddleware)

interface WishlistRow {
  id: string
  owner_id: string
  title: string
  author: string
  isbn: string | null
  publisher: string | null
  cover_key: string | null
  detail_url: string | null
  tags: string
  priority: string
  pending_buy: number
  added_at: string
  updated_at: string
  deleted_at: string | null
}

function parseItem(row: WishlistRow) {
  return {
    ...row,
    tags: JSON.parse(row.tags as string) as string[],
    pending_buy: row.pending_buy === 1,
  }
}

// GET /api/wishlist?since=<ISO>
wishlist.get('/', async (c) => {
  const { sub } = c.var.user
  const since = c.req.query('since')

  let rows: WishlistRow[]
  if (since) {
    rows = await dbAll<WishlistRow>(
      c.env.DB,
      'SELECT * FROM wishlist WHERE owner_id = ? AND updated_at > ? ORDER BY updated_at ASC',
      sub, since,
    )
  } else {
    rows = await dbAll<WishlistRow>(
      c.env.DB,
      'SELECT * FROM wishlist WHERE owner_id = ? ORDER BY added_at DESC',
      sub,
    )
  }
  return c.json(rows.map(parseItem))
})

// POST /api/wishlist
wishlist.post('/', async (c) => {
  const { sub } = c.var.user
  const body = await c.req.json<{
    title?: string
    author?: string
    isbn?: string
    publisher?: string
    cover_key?: string
    detail_url?: string
    tags?: string[]
    priority?: string
    pending_buy?: boolean
  }>()

  if (!body.title) return c.json({ error: 'title_required' }, 400)

  const id = crypto.randomUUID()
  const tags = JSON.stringify(body.tags ?? [])
  const priority = body.priority ?? 'medium'
  const pending_buy = body.pending_buy ? 1 : 0

  await dbRun(
    c.env.DB,
    `INSERT INTO wishlist (id, owner_id, title, author, isbn, publisher, cover_key, detail_url, tags, priority, pending_buy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, sub, body.title, body.author ?? '', body.isbn ?? null,
    body.publisher ?? null, body.cover_key ?? null, body.detail_url ?? null,
    tags, priority, pending_buy,
  )

  const created = await dbFirst<WishlistRow>(c.env.DB, 'SELECT * FROM wishlist WHERE id = ?', id)
  return c.json(parseItem(created!), 201)
})

// PUT /api/wishlist/:id
wishlist.put('/:id', async (c) => {
  const { sub } = c.var.user
  const id = c.req.param('id')

  const existing = await dbFirst<{ owner_id: string }>(
    c.env.DB, 'SELECT owner_id FROM wishlist WHERE id = ?', id,
  )
  if (!existing) return c.json({ error: 'not_found' }, 404)
  if (existing.owner_id !== sub) return c.json({ error: 'forbidden' }, 403)

  const body = await c.req.json<Partial<{
    title: string
    author: string
    isbn: string
    publisher: string
    cover_key: string
    detail_url: string
    tags: string[]
    priority: string
    pending_buy: boolean
    deleted_at: string | null
  }>>()

  const fields: string[] = []
  const values: unknown[] = []

  if (body.title !== undefined) { fields.push('title = ?'); values.push(body.title) }
  if (body.author !== undefined) { fields.push('author = ?'); values.push(body.author) }
  if (body.isbn !== undefined) { fields.push('isbn = ?'); values.push(body.isbn) }
  if (body.publisher !== undefined) { fields.push('publisher = ?'); values.push(body.publisher) }
  if (body.cover_key !== undefined) { fields.push('cover_key = ?'); values.push(body.cover_key) }
  if (body.detail_url !== undefined) { fields.push('detail_url = ?'); values.push(body.detail_url) }
  if (body.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(body.tags)) }
  if (body.priority !== undefined) { fields.push('priority = ?'); values.push(body.priority) }
  if (body.pending_buy !== undefined) { fields.push('pending_buy = ?'); values.push(body.pending_buy ? 1 : 0) }
  if (body.deleted_at !== undefined) { fields.push('deleted_at = ?'); values.push(body.deleted_at) }

  if (fields.length === 0) return c.json({ error: 'no_fields' }, 400)

  fields.push("updated_at = datetime('now')")
  values.push(id)

  await dbRun(c.env.DB, `UPDATE wishlist SET ${fields.join(', ')} WHERE id = ?`, ...values)

  const updated = await dbFirst<WishlistRow>(c.env.DB, 'SELECT * FROM wishlist WHERE id = ?', id)
  return c.json(parseItem(updated!))
})

// DELETE /api/wishlist/:id  (soft-delete)
wishlist.delete('/:id', async (c) => {
  const { sub } = c.var.user
  const id = c.req.param('id')

  const existing = await dbFirst<{ owner_id: string }>(
    c.env.DB, 'SELECT owner_id FROM wishlist WHERE id = ?', id,
  )
  if (!existing) return c.json({ error: 'not_found' }, 404)
  if (existing.owner_id !== sub) return c.json({ error: 'forbidden' }, 403)

  await dbRun(
    c.env.DB,
    "UPDATE wishlist SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    id,
  )
  return c.json({ ok: true })
})

// POST /api/wishlist/:id/move-to-inventory  (atomic)
wishlist.post('/:id/move-to-inventory', async (c) => {
  const { sub } = c.var.user
  const wishId = c.req.param('id')

  const item = await dbFirst<WishlistRow>(
    c.env.DB, 'SELECT * FROM wishlist WHERE id = ? AND owner_id = ?', wishId, sub,
  )
  if (!item) return c.json({ error: 'not_found' }, 404)
  if (item.deleted_at) return c.json({ error: 'already_deleted' }, 409)

  const bookId = crypto.randomUUID()

  // Use a batch to run both statements atomically
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO books (id, owner_id, title, author, isbn, publisher, cover_key, detail_url, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(bookId, sub, item.title, item.author, item.isbn, item.publisher, item.cover_key, item.detail_url, item.tags),
    c.env.DB.prepare(
      "UPDATE wishlist SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    ).bind(wishId),
  ])

  const book = await dbFirst<{ id: string; title: string }>(
    c.env.DB, 'SELECT id, title FROM books WHERE id = ?', bookId,
  )
  return c.json({ bookId: book!.id, title: book!.title }, 201)
})

export default wishlist
