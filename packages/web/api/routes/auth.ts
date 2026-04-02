// api/routes/auth.ts
// Authentication routes: register, login, logout, me, invite

import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { hashPassword, verifyPassword } from '../lib/password.ts'
import { signJwt } from '../lib/jwt.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { dbFirst, dbRun } from '../lib/db.ts'

const auth = new Hono<HonoEnv>()

// POST /api/auth/register
auth.post('/register', async (c) => {
  const body = await c.req.json<{ username?: string; password?: string; name?: string; inviteCode?: string }>()
  const { username, password, name, inviteCode } = body

  if (!username || !password || !name || !inviteCode) {
    return c.json({ error: 'missing_fields' }, 400)
  }
  if (username.length < 2 || username.length > 32) {
    return c.json({ error: 'invalid_username' }, 400)
  }
  if (password.length < 8) {
    return c.json({ error: 'password_too_short' }, 400)
  }

  // Validate invite code
  const invite = await dbFirst<{ code: string; used_by: string | null }>(
    c.env.DB,
    'SELECT code, used_by FROM invite_codes WHERE code = ?',
    inviteCode,
  )
  if (!invite) return c.json({ error: 'invalid_invite_code' }, 400)
  if (invite.used_by) return c.json({ error: 'invite_code_used' }, 400)

  // Check username uniqueness
  const existing = await dbFirst(c.env.DB, 'SELECT id FROM users WHERE username = ?', username)
  if (existing) return c.json({ error: 'username_taken' }, 409)

  const id = crypto.randomUUID()
  const passwordHash = await hashPassword(password)

  await dbRun(
    c.env.DB,
    'INSERT INTO users (id, username, password_hash, name) VALUES (?, ?, ?, ?)',
    id, username, passwordHash, name,
  )

  // Mark invite code as used
  await dbRun(
    c.env.DB,
    "UPDATE invite_codes SET used_by = ?, used_at = datetime('now') WHERE code = ?",
    id, inviteCode,
  )

  const token = await signJwt({ sub: id, username }, c.env.JWT_SECRET)
  return c.json({ token }, 201)
})

// POST /api/auth/login
auth.post('/login', async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>()
  const { username, password } = body

  if (!username || !password) return c.json({ error: 'missing_fields' }, 400)

  const user = await dbFirst<{ id: string; username: string; password_hash: string }>(
    c.env.DB,
    'SELECT id, username, password_hash FROM users WHERE username = ?',
    username,
  )
  if (!user) return c.json({ error: 'invalid_credentials' }, 401)

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) return c.json({ error: 'invalid_credentials' }, 401)

  const token = await signJwt({ sub: user.id, username: user.username }, c.env.JWT_SECRET)

  // Set httpOnly cookie for PWA; also return token in body for Electron Bearer usage
  c.header('Set-Cookie', `tk=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`)
  return c.json({ token })
})

// POST /api/auth/logout
auth.post('/logout', (c) => {
  c.header('Set-Cookie', 'tk=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0')
  return c.json({ ok: true })
})

// GET /api/auth/me  (requires auth)
auth.get('/me', authMiddleware, async (c) => {
  const { sub } = c.var.user
  const user = await dbFirst<{ id: string; username: string; name: string; language: string; ui_prefs: string }>(
    c.env.DB,
    'SELECT id, username, name, language, ui_prefs FROM users WHERE id = ?',
    sub,
  )
  if (!user) return c.json({ error: 'not_found' }, 404)
  return c.json({ ...user, ui_prefs: JSON.parse(user.ui_prefs as string) })
})

// POST /api/auth/invite  (requires auth)
auth.post('/invite', authMiddleware, async (c) => {
  const { sub } = c.var.user
  // Generate a short random alphanumeric code
  const arr = crypto.getRandomValues(new Uint8Array(6))
  const code = Array.from(arr, b => b.toString(36).padStart(2, '0')).join('').toUpperCase().slice(0, 8)

  await dbRun(
    c.env.DB,
    'INSERT INTO invite_codes (code, created_by) VALUES (?, ?)',
    code, sub,
  )
  return c.json({ code })
})

export default auth
