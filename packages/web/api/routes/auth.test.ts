import type { D1Database } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import auth from './auth.ts'

const SECRET = 'test-secret-that-is-long-enough-for-hmac-validation'

function registrationDatabase(insertChanges: number) {
  const batched: Array<{ sql: string; params: unknown[] }> = []

  const database = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            sql,
            params,
            async first() {
              if (sql.includes('FROM invite_codes')) {
                return { code: 'INVITE1', used_by: null }
              }
              return null
            },
          }
        },
      }
    },
    async batch(statements: Array<{ sql: string; params: unknown[] }>) {
      batched.push(...statements)
      return [
        { success: true, meta: { changes: insertChanges }, results: [] },
        { success: true, meta: { changes: insertChanges }, results: [] },
      ]
    },
  } as unknown as D1Database

  return { database, batched }
}

async function register(database: D1Database) {
  return auth.request('/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() },
    body: JSON.stringify({
      username: `reader-${crypto.randomUUID().slice(0, 8)}`,
      password: 'long-enough-password',
      name: 'Reader',
      inviteCode: 'INVITE1',
    }),
  }, {
    DB: database,
    JWT_SECRET: SECRET,
  } as never)
}

describe('POST /register', () => {
  it('creates and consumes the invitation in one conditional batch', async () => {
    const { database, batched } = registrationDatabase(1)
    const response = await register(database)

    expect(response.status).toBe(201)
    expect(batched).toHaveLength(2)
    expect(batched[0]?.sql).toContain('WHERE code = ? AND used_by IS NULL')
    expect(batched[1]?.sql).toContain('WHERE code = ? AND used_by IS NULL')
    await expect(response.json()).resolves.toHaveProperty('token')
  })

  it('does not issue a token when another request consumed the invitation', async () => {
    const { database } = registrationDatabase(0)
    const response = await register(database)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invite_code_used' })
  })
})
