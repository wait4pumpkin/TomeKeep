import type { D1Database } from '@cloudflare/workers-types'
import { beforeEach, describe, expect, it } from 'vitest'
import { signJwt } from '../lib/jwt.ts'
import profiles from './profiles.ts'

const SECRET = 'test-secret-that-is-long-enough-for-hmac-validation'

function fakeDatabase(activeCount: number) {
  const queries: string[] = []
  const batches: Array<Array<{ sql: string; params: unknown[] }>> = []
  const database = {
    prepare(sql: string) {
      queries.push(sql)
      return {
        bind(...params: unknown[]) {
          return {
            sql,
            params,
            async first() {
              if (sql.includes('SELECT * FROM profiles WHERE id')) {
                return {
                  id: 'p1', owner_id: 'owner-1', name: 'Reader',
                  created_at: '2026-01-01', updated_at: '2026-01-01', deleted_at: null,
                }
              }
              if (sql.includes('COUNT(*)')) return { n: activeCount }
              return null
            },
            async all() { return { results: [] } },
            async run() { return { success: true } },
          }
        },
      }
    },
    async batch(statements: Array<{ sql: string; params: unknown[] }>) {
      batches.push(statements)
      return statements.map(() => ({ success: true }))
    },
  } as unknown as D1Database
  return { database, queries, batches }
}

describe('profile tombstones', () => {
  let token: string
  beforeEach(async () => {
    token = await signJwt({ sub: 'owner-1', username: 'reader' }, SECRET, 60)
  })

  it('only exposes deleted rows when the native client opts in', async () => {
    const first = fakeDatabase(2)
    await profiles.request('/', { headers: { authorization: `Bearer ${token}` } }, {
      DB: first.database, JWT_SECRET: SECRET,
    } as never)
    expect(first.queries.some(sql => sql.includes('deleted_at IS NULL'))).toBe(true)

    const second = fakeDatabase(2)
    await profiles.request('/?include_deleted=1', { headers: { authorization: `Bearer ${token}` } }, {
      DB: second.database, JWT_SECRET: SECRET,
    } as never)
    expect(second.queries.some(sql => sql.includes('deleted_at IS NULL'))).toBe(false)
  })

  it('soft deletes a profile and its reading states atomically', async () => {
    const { database, batches } = fakeDatabase(2)
    const response = await profiles.request('/p1', {
      method: 'DELETE', headers: { authorization: `Bearer ${token}` },
    }, { DB: database, JWT_SECRET: SECRET } as never)

    expect(response.status).toBe(200)
    expect(batches).toHaveLength(1)
    expect(batches[0]?.[0]?.sql).toContain('SET deleted_at = datetime')
    expect(batches[0]?.[1]?.sql).toContain('DELETE FROM reading_states')
  })

  it('refuses to delete the last active profile', async () => {
    const { database, batches } = fakeDatabase(1)
    const response = await profiles.request('/p1', {
      method: 'DELETE', headers: { authorization: `Bearer ${token}` },
    }, { DB: database, JWT_SECRET: SECRET } as never)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'last_profile' })
    expect(batches).toHaveLength(0)
  })
})
