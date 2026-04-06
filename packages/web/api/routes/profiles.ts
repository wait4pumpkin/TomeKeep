// api/routes/profiles.ts
// Per-account reading profiles — CRUD.
// Each account can have multiple named profiles (e.g. household members).
// Profile IDs are client-generated UUIDs so they can be created offline.

import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { dbAll, dbRun, dbFirst } from '../lib/db.ts'

const profiles = new Hono<HonoEnv>()
profiles.use('*', authMiddleware)

interface ProfileRow {
  id: string
  owner_id: string
  name: string
  created_at: string
  updated_at: string
}

// GET /api/profiles
profiles.get('/', async (c) => {
  const { sub } = c.var.user
  const rows = await dbAll<ProfileRow>(
    c.env.DB,
    'SELECT * FROM profiles WHERE owner_id = ? ORDER BY created_at ASC',
    sub,
  )
  return c.json(rows)
})

const MAX_PROFILES_PER_ACCOUNT = 5

// POST /api/profiles  — { id, name }
profiles.post('/', async (c) => {
  const { sub } = c.var.user
  const body = await c.req.json<{ id?: string; name?: string }>()
  if (!body.id || !body.name?.trim()) return c.json({ error: 'id_and_name_required' }, 400)

  // Verify this id doesn't already belong to a different user
  const existing = await dbFirst<ProfileRow>(c.env.DB, 'SELECT * FROM profiles WHERE id = ?', body.id)
  if (existing && existing.owner_id !== sub) return c.json({ error: 'id_conflict' }, 409)

  // Enforce per-account limit (skip check if this is an upsert of an existing own profile)
  if (!existing) {
    const count = await dbFirst<{ n: number }>(
      c.env.DB, 'SELECT COUNT(*) AS n FROM profiles WHERE owner_id = ?', sub,
    )
    if ((count?.n ?? 0) >= MAX_PROFILES_PER_ACCOUNT) {
      return c.json({ error: 'profile_limit_reached' }, 422)
    }
  }

  await dbRun(
    c.env.DB,
    `INSERT INTO profiles (id, owner_id, name)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = datetime('now')`,
    body.id, sub, body.name.trim(),
  )
  const row = await dbFirst<ProfileRow>(c.env.DB, 'SELECT * FROM profiles WHERE id = ?', body.id)
  return c.json(row, 201)
})

// PATCH /api/profiles/:id  — { name }
profiles.patch('/:id', async (c) => {
  const { sub } = c.var.user
  const id = c.req.param('id')
  const body = await c.req.json<{ name?: string }>()
  if (!body.name?.trim()) return c.json({ error: 'name_required' }, 400)

  const existing = await dbFirst<ProfileRow>(c.env.DB, 'SELECT * FROM profiles WHERE id = ?', id)
  if (!existing) return c.json({ error: 'not_found' }, 404)
  if (existing.owner_id !== sub) return c.json({ error: 'forbidden' }, 403)

  await dbRun(
    c.env.DB,
    'UPDATE profiles SET name = ?, updated_at = datetime(\'now\') WHERE id = ?',
    body.name.trim(), id,
  )
  return c.json({ ok: true })
})

// DELETE /api/profiles/:id
profiles.delete('/:id', async (c) => {
  const { sub } = c.var.user
  const id = c.req.param('id')

  const existing = await dbFirst<ProfileRow>(c.env.DB, 'SELECT * FROM profiles WHERE id = ?', id)
  if (!existing) return c.json({ error: 'not_found' }, 404)
  if (existing.owner_id !== sub) return c.json({ error: 'forbidden' }, 403)

  // Cascade deletes reading_states rows via FK
  await dbRun(c.env.DB, 'DELETE FROM profiles WHERE id = ?', id)
  return c.json({ ok: true })
})

export default profiles
