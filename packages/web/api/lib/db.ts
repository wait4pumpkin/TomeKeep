// api/lib/db.ts
// Thin D1 helper wrappers

import type { D1Database } from '@cloudflare/workers-types'

export async function dbFirst<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  const result = await db.prepare(sql).bind(...params).first<T>()
  return result ?? null
}

export async function dbAll<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all<T>()
  return result.results
}

export async function dbRun(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<void> {
  await db.prepare(sql).bind(...params).run()
}
