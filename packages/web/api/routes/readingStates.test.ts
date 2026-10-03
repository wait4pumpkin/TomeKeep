import type { D1Database } from '@cloudflare/workers-types'
import { beforeEach, describe, expect, it } from 'vitest'
import { signJwt } from '../lib/jwt.ts'
import readingStates from './readingStates.ts'

const SECRET = 'test-secret-that-is-long-enough-for-hmac-validation'

function fakeDatabase(bookExists: boolean) {
  const executed: Array<{ sql: string; params: unknown[] }> = []

  const database = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first() {
              if (sql.includes('SELECT id FROM books')) {
                return bookExists ? { id: 'book-1' } : null
              }
              return null
            },
            async run() {
              executed.push({ sql, params })
              return { success: true }
            },
          }
        },
      }
    },
  } as unknown as D1Database

  return { database, executed }
}

describe('PUT /reading-states', () => {
  let token: string

  beforeEach(async () => {
    token = await signJwt({ sub: 'owner-1', username: 'reader' }, SECRET, 60)
  })

  it('does not disclose or reference a book outside the authenticated owner scope', async () => {
    const { database, executed } = fakeDatabase(false)
    const response = await readingStates.request('/', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ book_id: 'foreign-book', status: 'reading' }),
    }, {
      DB: database,
      JWT_SECRET: SECRET,
    } as never)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'book_not_found' })
    expect(executed).toHaveLength(0)
  })

  it('uses the partial unique index conflict target for account-level state', async () => {
    const { database, executed } = fakeDatabase(true)
    const response = await readingStates.request('/', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ book_id: 'book-1', status: 'read' }),
    }, {
      DB: database,
      JWT_SECRET: SECRET,
    } as never)

    expect(response.status).toBe(200)
    expect(executed).toHaveLength(1)
    expect(executed[0]?.sql).toContain(
      'ON CONFLICT(user_id, book_id) WHERE profile_id IS NULL',
    )
  })
})
