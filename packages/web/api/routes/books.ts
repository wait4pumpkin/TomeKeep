// api/routes/books.ts
// Books (inventory) CRUD + incremental sync via ?since=

import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { dbAll, dbFirst, dbRun } from '../lib/db.ts'

const books = new Hono<HonoEnv>()
books.use('*', authMiddleware)

interface BookRow {
  id: string
  owner_id: string
  title: string
  author: string
  isbn: string | null
  publisher: string | null
  cover_key: string | null
  detail_url: string | null
  tags: string
  added_at: string
  updated_at: string
  deleted_at: string | null
}

function parseBook(row: BookRow) {
  return {
    ...row,
    tags: JSON.parse(row.tags as string) as string[],
  }
}

// GET /api/books?since=<ISO>
books.get('/', async (c) => {
  const { sub } = c.var.user
  const since = c.req.query('since')

  let rows: BookRow[]
  if (since) {
    rows = await dbAll<BookRow>(
      c.env.DB,
      'SELECT * FROM books WHERE owner_id = ? AND updated_at > ? ORDER BY updated_at ASC',
      sub, since,
    )
  } else {
    rows = await dbAll<BookRow>(
      c.env.DB,
      'SELECT * FROM books WHERE owner_id = ? ORDER BY added_at DESC',
      sub,
    )
  }
  return c.json(rows.map(parseBook))
})

// POST /api/books
books.post('/', async (c) => {
  const { sub } = c.var.user
  const body = await c.req.json<{
    title?: string
    author?: string
    isbn?: string
    publisher?: string
    cover_key?: string
    detail_url?: string
    tags?: string[]
  }>()

  if (!body.title) return c.json({ error: 'title_required' }, 400)

  const id = crypto.randomUUID()
  const tags = JSON.stringify(body.tags ?? [])

  await dbRun(
    c.env.DB,
    `INSERT INTO books (id, owner_id, title, author, isbn, publisher, cover_key, detail_url, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, sub, body.title, body.author ?? '', body.isbn ?? null,
    body.publisher ?? null, body.cover_key ?? null, body.detail_url ?? null, tags,
  )

  const created = await dbFirst<BookRow>(c.env.DB, 'SELECT * FROM books WHERE id = ?', id)
  return c.json(parseBook(created!), 201)
})

// PUT /api/books/:id
books.put('/:id', async (c) => {
  const { sub } = c.var.user
  const id = c.req.param('id')

  const existing = await dbFirst<{ owner_id: string }>(
    c.env.DB, 'SELECT owner_id FROM books WHERE id = ?', id,
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
  if (body.deleted_at !== undefined) { fields.push('deleted_at = ?'); values.push(body.deleted_at) }

  if (fields.length === 0) return c.json({ error: 'no_fields' }, 400)

  fields.push("updated_at = datetime('now')")
  values.push(id)

  await dbRun(c.env.DB, `UPDATE books SET ${fields.join(', ')} WHERE id = ?`, ...values)

  const updated = await dbFirst<BookRow>(c.env.DB, 'SELECT * FROM books WHERE id = ?', id)
  return c.json(parseBook(updated!))
})

// DELETE /api/books/:id  (soft-delete)
books.delete('/:id', async (c) => {
  const { sub } = c.var.user
  const id = c.req.param('id')

  const existing = await dbFirst<{ owner_id: string }>(
    c.env.DB, 'SELECT owner_id FROM books WHERE id = ?', id,
  )
  if (!existing) return c.json({ error: 'not_found' }, 404)
  if (existing.owner_id !== sub) return c.json({ error: 'forbidden' }, 403)

  await dbRun(
    c.env.DB,
    "UPDATE books SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    id,
  )
  return c.json({ ok: true })
})

export default books
