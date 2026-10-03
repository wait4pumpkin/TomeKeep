import type { D1Database } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import { signJwt } from '../lib/jwt.ts'
import books from './books.ts'

const SECRET = 'test-secret-that-is-long-enough-for-hmac-validation'

describe('native sync pagination', () => {
  it('returns a deterministic continuation cursor without changing the legacy array response', async () => {
    let capturedSQL = ''
    let capturedParams: unknown[] = []
    const rows = ['a', 'b'].map((id, index) => ({
      id,
      owner_id: 'owner-1',
      title: `Book ${id}`,
      author: '',
      isbn: null,
      publisher: null,
      cover_key: null,
      detail_url: null,
      tags: '[]',
      added_at: '2026-01-01 00:00:00',
      updated_at: `2026-01-01 00:00:0${index}`,
      deleted_at: null,
    }))
    const database = {
      prepare(sql: string) {
        capturedSQL = sql
        return {
          bind(...params: unknown[]) {
            capturedParams = params
            return { async all() { return { results: rows } } }
          },
        }
      },
    } as unknown as D1Database
    const token = await signJwt({ sub: 'owner-1', username: 'reader' }, SECRET, 60)
    const response = await books.request('/?page_size=1', {
      headers: { authorization: `Bearer ${token}` },
    }, { DB: database, JWT_SECRET: SECRET } as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [expect.objectContaining({ id: 'a', tags: [] })],
      next_cursor: { updated_at: '2026-01-01 00:00:00', after: 'a' },
    })
    expect(capturedSQL).toContain('ORDER BY updated_at ASC, id ASC LIMIT ?')
    expect(capturedParams.at(-1)).toBe(2)
  })
})
