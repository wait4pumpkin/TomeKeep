// api/routes/auth.ts
// Authentication routes: register, login, logout, me, invite, admin-setup

import { Hono, type Context } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { hashPassword, verifyPassword } from '../lib/password.ts'
import { signJwt } from '../lib/jwt.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { dbFirst, dbRun, dbAll } from '../lib/db.ts'

const auth = new Hono<HonoEnv>()

// ---------------------------------------------------------------------------
// In-memory sliding-window rate limiter
// Cloudflare Workers are single-threaded per isolate, so a Map is safe here.
// Note: state resets on Worker restart/cold start — this is intentional and
// acceptable. For persistent rate limiting, use Cloudflare Rate Limiting rules
// at the WAF layer (recommended for production deployments).
// ---------------------------------------------------------------------------
interface RateWindow { count: number; windowStart: number }
const rateLimitStore = new Map<string, RateWindow>()

/**
 * Returns true if the request should be blocked.
 * @param key      Identifier (e.g. IP + route)
 * @param limit    Max requests allowed per window
 * @param windowMs Window size in milliseconds
 */
function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = rateLimitStore.get(key)
  if (!entry || now - entry.windowStart >= windowMs) {
    rateLimitStore.set(key, { count: 1, windowStart: now })
    return false
  }
  entry.count++
  if (entry.count > limit) return true
  return false
}

/** Get the best available client IP from Cloudflare headers */
function getClientIp(c: Context<HonoEnv>): string {
  return (
    c.req.header('CF-Connecting-IP') ??
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

/** Build a Set-Cookie string for the JWT token.
 *  Omits the `Secure` flag on local dev (no CF_PAGES env var) so that
 *  http://localhost cookies are accepted by the browser. */
function loginCookie(token: string, isProduction: boolean, maxAge = 60 * 60 * 24 * 90): string {
  const base = `tk=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`
  return isProduction ? `${base}; Secure` : base
}

// POST /api/auth/register
auth.post('/register', async (c) => {
  // Rate limit: max 5 registration attempts per IP per 15 minutes
  const ip = getClientIp(c)
  if (isRateLimited(`register:${ip}`, 5, 15 * 60 * 1000)) {
    return c.json({ error: 'too_many_requests' }, 429)
  }

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
  const isProd = Boolean(c.env.CF_PAGES)
  c.header('Set-Cookie', loginCookie(token, isProd))
  return c.json({ token }, 201)
})

// POST /api/auth/login
auth.post('/login', async (c) => {
  // Rate limit: max 10 login attempts per IP per 15 minutes
  const ip = getClientIp(c)
  if (isRateLimited(`login:${ip}`, 10, 15 * 60 * 1000)) {
    return c.json({ error: 'too_many_requests' }, 429)
  }

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
  const isProd = Boolean(c.env.CF_PAGES)
  c.header('Set-Cookie', loginCookie(token, isProd))
  return c.json({ token })
})

// POST /api/auth/logout
auth.post('/logout', (c) => {
  const isProd = Boolean(c.env.CF_PAGES)
  c.header('Set-Cookie', loginCookie('', isProd, 0))
  return c.json({ ok: true })
})

// GET /api/auth/me  (requires auth)
auth.get('/me', authMiddleware, async (c) => {
  const { sub } = c.var.user
  const user = await dbFirst<{ id: string; username: string; name: string; language: string; ui_prefs: string; is_admin: number }>(
    c.env.DB,
    'SELECT id, username, name, language, ui_prefs, is_admin FROM users WHERE id = ?',
    sub,
  )
  if (!user) return c.json({ error: 'not_found' }, 404)
  return c.json({
    ...user,
    ui_prefs: JSON.parse(user.ui_prefs as string),
    is_admin: user.is_admin === 1,
  })
})

// POST /api/auth/invite  (requires auth + admin)
auth.post('/invite', authMiddleware, async (c) => {
  const { sub } = c.var.user

  // Only admins may generate invite codes
  const caller = await dbFirst<{ is_admin: number }>(
    c.env.DB,
    'SELECT is_admin FROM users WHERE id = ?',
    sub,
  )
  if (!caller || caller.is_admin !== 1) {
    return c.json({ error: 'forbidden' }, 403)
  }

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

// DELETE /api/auth/invites/:code  (requires auth + admin)
// Deletes an invite code. Only unused codes may be deleted.
auth.delete('/invites/:code', authMiddleware, async (c) => {
  const { sub } = c.var.user

  const caller = await dbFirst<{ is_admin: number }>(
    c.env.DB,
    'SELECT is_admin FROM users WHERE id = ?',
    sub,
  )
  if (!caller || caller.is_admin !== 1) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const code = c.req.param('code')
  const invite = await dbFirst<{ code: string; used_by: string | null }>(
    c.env.DB,
    'SELECT code, used_by FROM invite_codes WHERE code = ?',
    code,
  )
  if (!invite) return c.json({ error: 'not_found' }, 404)
  if (invite.used_by) return c.json({ error: 'already_used' }, 409)

  await dbRun(c.env.DB, 'DELETE FROM invite_codes WHERE code = ?', code)
  return c.json({ ok: true })
})

// GET /api/auth/invites  (requires auth + admin)
// Returns a paginated list of all invite codes with used_by username.
auth.get('/invites', authMiddleware, async (c) => {
  const { sub } = c.var.user

  const caller = await dbFirst<{ is_admin: number }>(
    c.env.DB,
    'SELECT is_admin FROM users WHERE id = ?',
    sub,
  )
  if (!caller || caller.is_admin !== 1) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const page = Math.max(1, Number(c.req.query('page') ?? '1'))
  const pageSize = 10
  const offset = (page - 1) * pageSize

  const total = await dbFirst<{ count: number }>(
    c.env.DB,
    'SELECT COUNT(*) as count FROM invite_codes',
  )

  const rows = await dbAll<{
    code: string
    created_at: string
    used_by_username: string | null
    used_at: string | null
  }>(
    c.env.DB,
    `SELECT ic.code, ic.created_at, u.username AS used_by_username, ic.used_at
     FROM invite_codes ic
     LEFT JOIN users u ON u.id = ic.used_by
     ORDER BY ic.created_at DESC
     LIMIT ? OFFSET ?`,
    pageSize, offset,
  )

  return c.json({
    items: rows,
    total: total?.count ?? 0,
    page,
    pageSize,
  })
})

// POST /api/auth/admin-setup
// One-time endpoint: creates the first and only admin account.
// Requires ADMIN_SETUP_TOKEN header to match the env secret.
// Permanently disabled once any admin exists in the database.
auth.post('/admin-setup', async (c) => {
  const setupToken = c.env.ADMIN_SETUP_TOKEN
  if (!setupToken) {
    return c.json({ error: 'not_configured' }, 403)
  }

  const authHeader = c.req.header('Authorization')
  const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!providedToken || providedToken !== setupToken) {
    return c.json({ error: 'invalid_token' }, 403)
  }

  // Check if any admin already exists — permanently disabled once one does
  const existing = await dbFirst<{ count: number }>(
    c.env.DB,
    'SELECT COUNT(*) as count FROM users WHERE is_admin = 1',
  )
  if (existing && existing.count > 0) {
    return c.json({ error: 'admin_already_exists' }, 409)
  }

  const body = await c.req.json<{ username?: string; password?: string; name?: string }>()
  const { username, password, name } = body

  if (!username || !password || !name) {
    return c.json({ error: 'missing_fields' }, 400)
  }
  if (username.length < 2 || username.length > 32) {
    return c.json({ error: 'invalid_username' }, 400)
  }
  if (password.length < 8) {
    return c.json({ error: 'password_too_short' }, 400)
  }

  const taken = await dbFirst(c.env.DB, 'SELECT id FROM users WHERE username = ?', username)
  if (taken) return c.json({ error: 'username_taken' }, 409)

  const id = crypto.randomUUID()
  const passwordHash = await hashPassword(password)

  await dbRun(
    c.env.DB,
    'INSERT INTO users (id, username, password_hash, name, is_admin) VALUES (?, ?, ?, ?, 1)',
    id, username, passwordHash, name,
  )

  const token = await signJwt({ sub: id, username }, c.env.JWT_SECRET)
  const isProd = Boolean(c.env.CF_PAGES)
  c.header('Set-Cookie', loginCookie(token, isProd))
  return c.json({ token }, 201)
})

export default auth
