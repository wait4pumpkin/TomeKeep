// api/routes/books.ts
// Books (inventory) CRUD + incremental sync via ?since=

import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { dbAll, dbFirst, dbRun } from '../lib/db.ts'
import { canonicalizeIsbn } from '@tomekeep/shared'
import type { D1Database } from '@cloudflare/workers-types'

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
  revision: number
}

function parseBook(row: BookRow) {
  return {
    ...row,
    tags: JSON.parse(row.tags as string) as string[],
  }
}

async function findISBNConflict(db: D1Database, owner: string, isbn: string, excluded?: string) {
  // Legacy rows may still contain ISBN-10. Do not rewrite them on a read.
  const rows = await dbAll<{ id: string; isbn: string }>(db,
    'SELECT id, isbn FROM books WHERE owner_id = ? AND deleted_at IS NULL AND isbn IS NOT NULL', owner)
  return rows.find(row => row.id !== excluded && canonicalizeIsbn(row.isbn) === isbn)
}

// GET /api/books?since=<ISO>
books.get('/', async (c) => {
  const { sub } = c.var.user
  const since = c.req.query('since')
  const requestedPageSize = Number(c.req.query('page_size'))
  const pageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0
    ? Math.min(requestedPageSize, 500)
    : null
  const pageUpdatedAt = c.req.query('page_updated_at')
  const pageAfter = c.req.query('page_after')

  if (pageSize) {
    const params: unknown[] = [sub]
    let filter = 'WHERE owner_id = ?'
    if (since) { filter += ' AND updated_at >= ?'; params.push(since) }
    if (pageUpdatedAt && pageAfter) {
      filter += ' AND (updated_at > ? OR (updated_at = ? AND id > ?))'
      params.push(pageUpdatedAt, pageUpdatedAt, pageAfter)
    }
    params.push(pageSize + 1)
    const page = await dbAll<BookRow>(
      c.env.DB,
      `SELECT * FROM books ${filter} ORDER BY updated_at ASC, id ASC LIMIT ?`,
      ...params,
    )
    const hasMore = page.length > pageSize
    const items = page.slice(0, pageSize)
    const last = items.at(-1)
    return c.json({
      items: items.map(parseBook),
      next_cursor: hasMore && last ? { updated_at: last.updated_at, after: last.id } : null,
    })
  }

  let rows: BookRow[]
  if (since) {
    rows = await dbAll<BookRow>(
      c.env.DB,
      'SELECT * FROM books WHERE owner_id = ? AND updated_at >= ? ORDER BY updated_at ASC',
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
books.get('/:id', async (c) => {
  const row = await dbFirst<BookRow>(c.env.DB,
    'SELECT * FROM books WHERE id = ? AND owner_id = ?', c.req.param('id'), c.var.user.sub)
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json(parseBook(row))
})

books.post('/', async (c) => {
  const { sub } = c.var.user
  const body = await c.req.json<{
    id?: string
    title?: string
    author?: string
    isbn?: string
    publisher?: string
    cover_key?: string
    detail_url?: string
    tags?: string[]
    added_at?: string
  }>()

  if (!body.title) return c.json({ error: 'title_required' }, 400)

  const isbn = body.isbn?.trim() ? canonicalizeIsbn(body.isbn) : null
  if (body.isbn?.trim() && !isbn) return c.json({ error: 'invalid_isbn' }, 400)
  if (isbn) {
    const duplicate = await findISBNConflict(c.env.DB, sub, isbn)
    if (duplicate) return c.json({ error: 'duplicate_isbn', id: duplicate.id }, 409)
  }

  // Accept a caller-supplied id (e.g. from desktop migration) so the local
  // and cloud records share the same identifier. Fall back to a new UUID when
  // no id is provided (e.g. from the PWA).
  const id = body.id ?? crypto.randomUUID()
  const tags = JSON.stringify(body.tags ?? [])

  try { await dbRun(
    c.env.DB,
    `INSERT INTO books (id, owner_id, title, author, isbn, publisher, cover_key, detail_url, tags, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    id, sub, body.title, body.author ?? '', isbn,
    body.publisher ?? null, body.cover_key ?? null, body.detail_url ?? null, tags,
    body.added_at ?? null,
  ) } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('duplicate_isbn')) throw error
    const duplicate = isbn ? await findISBNConflict(c.env.DB, sub, isbn) : null
    return c.json({ error: 'duplicate_isbn', id: duplicate?.id }, 409)
  }

  const created = await dbFirst<BookRow>(c.env.DB, 'SELECT * FROM books WHERE id = ?', id)
  return c.json(parseBook(created!), 201)
})

// PUT /api/books/:id
books.put('/:id', async (c) => {
  const { sub } = c.var.user
  const id = c.req.param('id')

  const existing = await dbFirst<{ owner_id: string; cover_key: string | null; isbn: string | null }>(
    c.env.DB, 'SELECT owner_id, cover_key, isbn FROM books WHERE id = ?', id,
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
    added_at: string
    expected_revision: number
  }>>()

  const fields: string[] = []
  const values: unknown[] = []
  if (body.expected_revision !== undefined && (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 1)) {
    return c.json({ error: 'invalid_revision' }, 400)
  }

  const isbn = body.isbn?.trim() ? canonicalizeIsbn(body.isbn) : null
  if (body.isbn?.trim() && !isbn) return c.json({ error: 'invalid_isbn' }, 400)
  const restoringISBN = body.deleted_at === null && body.isbn === undefined && existing.isbn
    ? canonicalizeIsbn(existing.isbn) : null
  if ((body.isbn !== undefined && isbn) || restoringISBN) {
    const duplicate = await findISBNConflict(c.env.DB, sub, isbn ?? restoringISBN!, id)
    if (duplicate) return c.json({ error: 'duplicate_isbn', id: duplicate.id }, 409)
  }

  if (body.title !== undefined) { fields.push('title = ?'); values.push(body.title) }
  if (body.author !== undefined) { fields.push('author = ?'); values.push(body.author) }
  if (body.isbn !== undefined) { fields.push('isbn = ?'); values.push(isbn) }
  else if (restoringISBN) { fields.push('isbn = ?'); values.push(restoringISBN) }
  if (body.publisher !== undefined) { fields.push('publisher = ?'); values.push(body.publisher) }
  if (body.cover_key !== undefined) { fields.push('cover_key = ?'); values.push(body.cover_key) }
  if (body.detail_url !== undefined) { fields.push('detail_url = ?'); values.push(body.detail_url) }
  if (body.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(body.tags)) }
  if (body.deleted_at !== undefined) { fields.push('deleted_at = ?'); values.push(body.deleted_at) }
  if (body.added_at !== undefined) { fields.push('added_at = ?'); values.push(body.added_at) }

  if (fields.length === 0) return c.json({ error: 'no_fields' }, 400)

  fields.push("updated_at = datetime('now')")
  values.push(id)

  let condition = 'id = ?'
  if (body.expected_revision !== undefined) { condition += ' AND revision = ?'; values.push(body.expected_revision) }
  try {
    const result = await c.env.DB.prepare(`UPDATE books SET ${fields.join(', ')} WHERE ${condition}`).bind(...values).run()
    if (body.expected_revision !== undefined && result.meta.changes === 0) {
      return c.json({ error: 'stale_book', id }, 409)
    }
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('duplicate_isbn')) throw error
    const identity = isbn ?? restoringISBN ?? (existing.isbn ? canonicalizeIsbn(existing.isbn) : null)
    const duplicate = identity ? await findISBNConflict(c.env.DB, sub, identity, id) : null
    return c.json({ error: 'duplicate_isbn', id: duplicate?.id }, 409)
  }

  // Preserve replaced objects: an offline conflict journal may still reference
  // the previous image. Orphan collection requires a separate retention policy.

  const updated = await dbFirst<BookRow>(c.env.DB, 'SELECT * FROM books WHERE id = ?', id)
  return c.json(parseBook(updated!))
})

// DELETE /api/books/:id  (soft-delete)
books.delete('/:id', async (c) => {
  const { sub } = c.var.user
  const id = c.req.param('id')

  const existing = await dbFirst<{ owner_id: string; cover_key: string | null }>(
    c.env.DB, 'SELECT owner_id, cover_key FROM books WHERE id = ?', id,
  )
  if (!existing) return c.json({ error: 'not_found' }, 404)
  if (existing.owner_id !== sub) return c.json({ error: 'forbidden' }, 403)

  await dbRun(
    c.env.DB,
    "UPDATE books SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    id,
  )

  // The tombstone retains the cover key. Keep its object for recovery and
  // for another book or conflict snapshot that may reference the same key.

  return c.json({ ok: true })
})

export default books
