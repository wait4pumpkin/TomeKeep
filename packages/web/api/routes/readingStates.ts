// api/routes/readingStates.ts
// Reading state upsert and incremental fetch

import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { dbAll, dbRun } from '../lib/db.ts'

const readingStates = new Hono<HonoEnv>()
readingStates.use('*', authMiddleware)

interface ReadingStateRow {
  user_id: string
  book_id: string
  status: string
  completed_at: string | null
  updated_at: string
}

// GET /api/reading-states?since=<ISO>
readingStates.get('/', async (c) => {
  const { sub } = c.var.user
  const since = c.req.query('since')

  let rows: ReadingStateRow[]
  if (since) {
    rows = await dbAll<ReadingStateRow>(
      c.env.DB,
      'SELECT * FROM reading_states WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC',
      sub, since,
    )
  } else {
    rows = await dbAll<ReadingStateRow>(
      c.env.DB,
      'SELECT * FROM reading_states WHERE user_id = ? ORDER BY updated_at DESC',
      sub,
    )
  }
  return c.json(rows)
})

// PUT /api/reading-states  (upsert)
readingStates.put('/', async (c) => {
  const { sub } = c.var.user
  const body = await c.req.json<{
    book_id?: string
    status?: string
    completed_at?: string | null
  }>()

  if (!body.book_id) return c.json({ error: 'book_id_required' }, 400)
  const validStatuses = ['unread', 'reading', 'read']
  if (!body.status || !validStatuses.includes(body.status)) {
    return c.json({ error: 'invalid_status' }, 400)
  }

  const completedAt = body.status === 'read' ? (body.completed_at ?? new Date().toISOString()) : null

  await dbRun(
    c.env.DB,
    `INSERT INTO reading_states (user_id, book_id, status, completed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, book_id) DO UPDATE SET
       status = excluded.status,
       completed_at = excluded.completed_at,
       updated_at = datetime('now')`,
    sub, body.book_id, body.status, completedAt,
  )

  return c.json({ ok: true })
})

export default readingStates
