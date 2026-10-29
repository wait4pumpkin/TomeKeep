import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import type { D1Database } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import { signJwt } from '../lib/jwt.ts'
import books from './books.ts'

const SECRET = 'book-conflict-test-secret-that-is-long-enough'
const ISBN = '9780306406157'

async function fixture(beforeMigration?: (db: DatabaseSync) => void) {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('../../migrations/0001_initial_schema.sql', import.meta.url), 'utf8'))
  for (const id of ['owner-1', 'owner-2']) {
    sql.prepare('INSERT INTO users(id,username,password_hash,name) VALUES(?,?,?,?)').run(id, id, 'test', id)
  }
  beforeMigration?.(sql)
  sql.exec(readFileSync(new URL('../../migrations/0008_book_identity_conflicts.sql', import.meta.url), 'utf8'))
  const database = {
    prepare(query: string) {
      return { bind(...params: unknown[]) {
        return {
          async first() { return sql.prepare(query).get(...params as never[]) ?? null },
          async all() { return { results: sql.prepare(query).all(...params as never[]) } },
          async run() {
            const result = sql.prepare(query).run(...params as never[])
            return { success: true, meta: { changes: Number(result.changes) } }
          },
        }
      } }
    },
  } as unknown as D1Database
  const token = await signJwt({ sub: 'owner-1', username: 'reader' }, SECRET, 60)
  const other = await signJwt({ sub: 'owner-2', username: 'reader2' }, SECRET, 60)
  const request = (path: string, method = 'GET', body?: unknown, auth = token) => books.request(path, {
    method, headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { DB: database, JWT_SECRET: SECRET } as never)
  return { sql, request, other }
}

describe('atomic book identity and conflict revisions', () => {
  it('two devices cannot create two active books with the same ISBN', async () => {
    const { sql, request } = await fixture()
    const results = await Promise.all([
      request('/', 'POST', { id: 'phone1', title: 'Book', isbn: ISBN }),
      request('/', 'POST', { id: 'phone2', title: 'Book', isbn: ISBN }),
    ])
    expect(results.map(r => r.status).sort()).toEqual([201, 409])
    expect(sql.prepare('SELECT count(*) AS n FROM books').get()?.n).toBe(1)
    const conflict = results.find(r => r.status === 409)!
    expect(await conflict.json()).toMatchObject({ error: 'duplicate_isbn' })
    sql.close()
  })

  it('canonicalizes ISBN-10 and recognizes unchanged legacy ISBN-10 rows', async () => {
    const { sql, request } = await fixture(db => {
      db.prepare('INSERT INTO books(id,owner_id,title,isbn) VALUES(?,?,?,?)').run('legacy', 'owner-1', 'Book', '0306406152')
    })
    const response = await request('/', 'POST', { id: 'new', title: 'Book', isbn: ISBN })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'duplicate_isbn', id: 'legacy' })
    expect(sql.prepare('SELECT isbn FROM books WHERE id=?').get('legacy')?.isbn).toBe('0306406152')
    sql.close()
  })

  it('is account-scoped and does not disclose other accounts through GET', async () => {
    const { sql, request, other } = await fixture()
    expect((await request('/', 'POST', { id: 'mine', title: 'Book', isbn: ISBN })).status).toBe(201)
    expect((await request('/', 'POST', { id: 'other', title: 'Book', isbn: ISBN }, other)).status).toBe(201)
    expect((await request('/other')).status).toBe(404)
    expect((await request('/mine', 'GET', undefined, other)).status).toBe(404)
    sql.close()
  })

  it('conditionally updates the revision and preserves legacy PUT behavior', async () => {
    const { sql, request } = await fixture()
    await request('/', 'POST', { id: 'book', title: 'Initial', isbn: ISBN })
    const initial = await (await request('/book')).json() as { revision: number }
    expect(initial.revision).toBe(1)
    expect((await request('/book', 'PUT', { title: 'First edit', expected_revision: 1 })).status).toBe(200)
    const stale = await request('/book', 'PUT', { title: 'Lost edit', expected_revision: 1 })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ error: 'stale_book', id: 'book' })
    expect(sql.prepare('SELECT title,revision FROM books WHERE id=?').get('book')).toMatchObject({ title: 'First edit', revision: 2 })
    expect((await request('/book', 'PUT', { title: 'Legacy edit' })).status).toBe(200)
    expect(sql.prepare('SELECT revision FROM books WHERE id=?').get('book')?.revision).toBe(3)
    sql.close()
  })

  it('does not silently remove old duplicates and blocks duplicate restoration', async () => {
    const { sql, request } = await fixture(db => {
      for (const id of ['old1', 'old2']) db.prepare('INSERT INTO books(id,owner_id,title,isbn) VALUES(?,?,?,?)').run(id, 'owner-1', id, ISBN)
    })
    expect(sql.prepare('SELECT count(*) AS n FROM books').get()?.n).toBe(2)
    sql.prepare("UPDATE books SET deleted_at='2026-01-01' WHERE id='old1'").run()
    const restored = await request('/old1', 'PUT', { deleted_at: null })
    expect(restored.status).toBe(409)
    expect(await restored.json()).toEqual({ error: 'duplicate_isbn', id: 'old2' })
    sql.close()
  })

  it('rejects malformed revision and keeps no-ISBN records independent', async () => {
    const { sql, request } = await fixture()
    for (const id of ['a', 'b']) expect((await request('/', 'POST', { id, title: 'Same title' })).status).toBe(201)
    expect((await request('/a', 'PUT', { title: 'No', expected_revision: -1 })).status).toBe(400)
    sql.close()
  })
})
