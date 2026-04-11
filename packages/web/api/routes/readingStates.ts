// api/routes/readingStates.ts
// Reading state upsert and incremental fetch.
// Supports an optional profile_id for per-profile reading progress.
// profile_id = null/undefined → the row is owned by the account (legacy default).

import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { dbAll, dbRun, dbFirst } from '../lib/db.ts'

const readingStates = new Hono<HonoEnv>()
readingStates.use('*', authMiddleware)

interface ReadingStateRow {
  user_id: string
  book_id: string
  profile_id: string | null
  status: string
  completed_at: string | null
  updated_at: string
}

// GET /api/reading-states?since=<ISO>&profile_id=<uuid|null>
// profile_id absent → return ALL rows for this user (used for full initial sync)
// profile_id supplied → return only rows for that profile
readingStates.get('/', async (c) => {
  const { sub } = c.var.user
  const since = c.req.query('since')
  const profileId = c.req.query('profile_id') ?? null   // null means "all"

  const params: unknown[] = [sub]
  let filter = 'WHERE user_id = ?'

  if (profileId !== null) {
    filter += profileId === 'null' ? ' AND profile_id IS NULL' : ' AND profile_id = ?'
    if (profileId !== 'null') params.push(profileId)
  }

  if (since) {
    filter += ' AND updated_at >= ?'
    params.push(since)
  }

  const order = since ? 'ORDER BY updated_at ASC' : 'ORDER BY updated_at DESC'
  const rows = await dbAll<ReadingStateRow>(
    c.env.DB,
    `SELECT * FROM reading_states ${filter} ${order}`,
    ...params,
  )
  return c.json(rows)
})

// PUT /api/reading-states  — { book_id, status, completed_at?, profile_id? }
readingStates.put('/', async (c) => {
  const { sub } = c.var.user
  const body = await c.req.json<{
    book_id?: string
    status?: string
    completed_at?: string | null
    profile_id?: string | null
  }>()

  if (!body.book_id) return c.json({ error: 'book_id_required' }, 400)
  const validStatuses = ['unread', 'reading', 'read']
  if (!body.status || !validStatuses.includes(body.status)) {
    return c.json({ error: 'invalid_status' }, 400)
  }

  // If a profile_id is supplied, verify it belongs to this user
  const profileId = body.profile_id ?? null
  if (profileId) {
    const profile = await dbFirst<{ owner_id: string }>(
      c.env.DB, 'SELECT owner_id FROM profiles WHERE id = ?', profileId,
    )
    if (!profile) return c.json({ error: 'profile_not_found' }, 404)
    if (profile.owner_id !== sub) return c.json({ error: 'forbidden' }, 403)
  }

  const completedAt = body.status === 'read' ? (body.completed_at ?? new Date().toISOString()) : null

  await dbRun(
    c.env.DB,
    `INSERT INTO reading_states (user_id, book_id, profile_id, status, completed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, book_id, profile_id) DO UPDATE SET
       status = excluded.status,
       completed_at = excluded.completed_at,
       updated_at = datetime('now')`,
    sub, body.book_id, profileId, body.status, completedAt,
  )

  return c.json({ ok: true })
})

export default readingStates
