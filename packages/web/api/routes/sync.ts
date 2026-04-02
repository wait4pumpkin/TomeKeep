// api/routes/sync.ts
// Returns the latest updated_at timestamp per table for the authenticated user.
// Clients use this to decide whether to pull incremental changes.

import { Hono } from 'hono'
import type { HonoEnv } from '../lib/types.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { dbFirst } from '../lib/db.ts'

const sync = new Hono<HonoEnv>()
sync.use('*', authMiddleware)

interface MaxRow { max_updated: string | null }

// GET /api/sync/status
sync.get('/status', async (c) => {
  const { sub } = c.var.user

  const [books, wishlist, readingStates] = await Promise.all([
    dbFirst<MaxRow>(
      c.env.DB,
      'SELECT MAX(updated_at) AS max_updated FROM books WHERE owner_id = ?',
      sub,
    ),
    dbFirst<MaxRow>(
      c.env.DB,
      'SELECT MAX(updated_at) AS max_updated FROM wishlist WHERE owner_id = ?',
      sub,
    ),
    dbFirst<MaxRow>(
      c.env.DB,
      'SELECT MAX(updated_at) AS max_updated FROM reading_states WHERE user_id = ?',
      sub,
    ),
  ])

  return c.json({
    books: books?.max_updated ?? null,
    wishlist: wishlist?.max_updated ?? null,
    readingStates: readingStates?.max_updated ?? null,
  })
})

export default sync
