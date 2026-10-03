import type { D1Database } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import { signJwt } from '../lib/jwt.ts'
import priceCache from './priceCache.ts'

const SECRET = 'test-secret-that-is-long-enough-for-hmac-validation'

function payload(url = 'https://item.jd.com/123.html') {
  return {
    cache_key: 'book::author', title: 'Book', author: 'Author', book_isbn: '9780000000002',
    channel: 'jd', status: 'ok', price_cny: 39.9, url, product_id: '123', source: 'auto',
    fetched_at: '2026-09-24T10:00:00Z', expires_at: '2026-09-25T10:00:00Z',
    updated_at: '2026-09-24T10:00:00Z',
  }
}

describe('PUT /price-cache', () => {
  it('uses an owner-scoped id and server-side LWW guard', async () => {
    let sql = ''
    let params: unknown[] = []
    const database = {
      prepare(value: string) {
        sql = value
        return { bind(...values: unknown[]) { params = values; return { async run() {} } } }
      },
    } as unknown as D1Database
    const token = await signJwt({ sub: 'owner-1', username: 'reader' }, SECRET, 60)
    const response = await priceCache.request('/', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload()),
    }, { DB: database, JWT_SECRET: SECRET } as never)

    expect(response.status).toBe(200)
    expect(params[0]).toBe('owner-1\u001fbook::author\u001fjd')
    expect(sql).toContain('datetime(excluded.updated_at) >= datetime(price_cache.updated_at)')
  })

  it('rejects non-HTTPS quote URLs', async () => {
    const token = await signJwt({ sub: 'owner-1', username: 'reader' }, SECRET, 60)
    const response = await priceCache.request('/', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload('http://example.test/book')),
    }, { DB: {} as D1Database, JWT_SECRET: SECRET } as never)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_url' })
  })

  it.each([
    [{ ...payload(), channel: 'unknown' }, 'invalid_quote'],
    [{ ...payload(), source: 'browser-extension' }, 'invalid_quote'],
    [{ ...payload(), author: 'a'.repeat(501) }, 'invalid_quote'],
    [{ ...payload(), fetched_at: 'not-a-date' }, 'invalid_timestamp'],
    [{ ...payload(), price_cny: -1 }, 'invalid_price'],
  ])('rejects malformed synchronized quote data', async (body, error) => {
    const token = await signJwt({ sub: 'owner-1', username: 'reader' }, SECRET, 60)
    const response = await priceCache.request('/', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, { DB: {} as D1Database, JWT_SECRET: SECRET } as never)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error })
  })
})
