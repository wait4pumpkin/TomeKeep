// api/middleware/auth.ts
// JWT verification middleware — populates c.var.user

import { createMiddleware } from 'hono/factory'
import type { HonoEnv } from '../lib/types.ts'
import { verifyJwt } from '../lib/jwt.ts'

export const authMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  // Try httpOnly cookie first (PWA), then Authorization header (Electron)
  let token: string | undefined

  const cookieHeader = c.req.header('cookie') ?? ''
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)tk=([^;]+)/)
  if (cookieMatch) {
    token = cookieMatch[1]
  } else {
    const auth = c.req.header('authorization') ?? ''
    if (auth.startsWith('Bearer ')) token = auth.slice(7)
  }

  if (!token) return c.json({ error: 'unauthorized' }, 401)

  const payload = await verifyJwt(token, c.env.JWT_SECRET)
  if (!payload) return c.json({ error: 'unauthorized' }, 401)

  c.set('user', payload)
  await next()
})
