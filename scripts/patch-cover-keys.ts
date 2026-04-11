#!/usr/bin/env tsx
/**
 * scripts/patch-cover-keys.ts
 *
 * Patch missing cover_key values for books and wishlist items that already
 * exist in the cloud but have no cover_key set in D1.
 *
 * This script is a companion to migrate-local-to-cloud.ts for the case where
 * the migration was interrupted after covers were uploaded to R2 but before
 * the cover_key values were written back to D1.
 *
 * What it does:
 *   1. Reads local db.json and the covers/ directory
 *   2. Fetches the current cloud books/wishlist to find records with no cover_key
 *   3. For each such record that has a local cover file, uploads the cover to
 *      POST /api/covers/upload and PATCHes the record via PUT /api/books/:id
 *      or PUT /api/wishlist/:id
 *
 * Usage:
 *   export API_URL=https://books.cbbnews.top
 *   export AUTH_TOKEN=<JWT from login>
 *   pnpm tsx scripts/patch-cover-keys.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_URL = process.env['API_URL']?.replace(/\/$/, '')
const AUTH_TOKEN = process.env['AUTH_TOKEN']

if (!API_URL) {
  console.error('ERROR: API_URL environment variable is required.')
  process.exit(1)
}
if (!AUTH_TOKEN) {
  console.error('ERROR: AUTH_TOKEN environment variable is required.')
  process.exit(1)
}

const DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'TomeKeep')
const COVERS_DIR = path.join(DATA_DIR, 'covers')

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function apiFetch(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${API_URL}${urlPath}`, {
    method,
    headers: {
      'Authorization': `Bearer ${AUTH_TOKEN}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data: unknown
  try { data = await res.json() } catch { data = null }
  return { ok: res.ok, status: res.status, data }
}

async function uploadCover(localPath: string): Promise<string | null> {
  const fileBytes = fs.readFileSync(localPath)
  const ext = path.extname(localPath).toLowerCase()
  const mimeType =
    ext === '.png' ? 'image/png'
    : ext === '.webp' ? 'image/webp'
    : ext === '.gif' ? 'image/gif'
    : 'image/jpeg'

  const form = new FormData()
  form.append('file', new Blob([fileBytes], { type: mimeType }), path.basename(localPath))

  const res = await fetch(`${API_URL}/api/covers/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
    body: form,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error(`  Cover upload failed (${res.status}):`, err)
    return null
  }
  const { coverKey } = (await res.json()) as { coverKey: string }
  return coverKey
}

// ---------------------------------------------------------------------------
// Find local cover file for a given record id
// ---------------------------------------------------------------------------

function findLocalCover(id: string): string | null {
  if (!fs.existsSync(COVERS_DIR)) return null
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.gif']) {
    const p = path.join(COVERS_DIR, `${id}${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('TomeKeep Patch Cover Keys')
  console.log(`API: ${API_URL}`)
  console.log('')

  // -- 1. Fetch cloud books without cover_key ---------------------------------
  console.log('Fetching cloud books...')
  const booksRes = await apiFetch('GET', '/api/books')
  if (!booksRes.ok) {
    console.error('Failed to fetch books:', booksRes.status, booksRes.data)
    process.exit(1)
  }
  const allBooks = (booksRes.data as { id: string; cover_key: string | null }[])
  const booksNoCover = allBooks.filter(b => !b.cover_key)
  console.log(`  Total: ${allBooks.length}, missing cover_key: ${booksNoCover.length}`)

  console.log('Fetching cloud wishlist...')
  const wishRes = await apiFetch('GET', '/api/wishlist')
  if (!wishRes.ok) {
    console.error('Failed to fetch wishlist:', wishRes.status, wishRes.data)
    process.exit(1)
  }
  const allWish = (wishRes.data as { id: string; cover_key: string | null }[])
  const wishNoCover = allWish.filter(w => !w.cover_key)
  console.log(`  Total: ${allWish.length}, missing cover_key: ${wishNoCover.length}`)
  console.log('')

  // -- 2. Patch books ---------------------------------------------------------
  let bookPatched = 0
  let bookNoLocal = 0
  let bookFailed = 0

  const totalBooks = booksNoCover.length
  console.log(`Patching ${totalBooks} books...`)

  for (let i = 0; i < booksNoCover.length; i++) {
    const book = booksNoCover[i]!
    const localPath = findLocalCover(book.id)
    process.stdout.write(`\r  [${String(i + 1).padStart(3)}/${totalBooks}] ${book.id.slice(0, 8)}…  `)

    if (!localPath) {
      bookNoLocal++
      continue
    }

    const coverKey = await uploadCover(localPath)
    if (!coverKey) {
      bookFailed++
      continue
    }

    const patchRes = await apiFetch('PUT', `/api/books/${book.id}`, { cover_key: coverKey })
    if (patchRes.ok) {
      bookPatched++
    } else {
      bookFailed++
      console.error(`\n  FAILED patch book ${book.id} (${patchRes.status}):`, patchRes.data)
    }
  }
  process.stdout.write('\n')
  console.log(`  Patched: ${bookPatched}, No local cover: ${bookNoLocal}, Failed: ${bookFailed}`)
  console.log('')

  // -- 3. Patch wishlist ------------------------------------------------------
  let wishPatched = 0
  let wishNoLocal = 0
  let wishFailed = 0

  const totalWish = wishNoCover.length
  console.log(`Patching ${totalWish} wishlist items...`)

  for (let i = 0; i < wishNoCover.length; i++) {
    const item = wishNoCover[i]!
    const localPath = findLocalCover(item.id)
    process.stdout.write(`\r  [${String(i + 1).padStart(3)}/${totalWish}] ${item.id.slice(0, 8)}…  `)

    if (!localPath) {
      wishNoLocal++
      continue
    }

    const coverKey = await uploadCover(localPath)
    if (!coverKey) {
      wishFailed++
      continue
    }

    const patchRes = await apiFetch('PUT', `/api/wishlist/${item.id}`, { cover_key: coverKey })
    if (patchRes.ok) {
      wishPatched++
    } else {
      wishFailed++
      console.error(`\n  FAILED patch wishlist ${item.id} (${patchRes.status}):`, patchRes.data)
    }
  }
  process.stdout.write('\n')
  console.log(`  Patched: ${wishPatched}, No local cover: ${wishNoLocal}, Failed: ${wishFailed}`)
  console.log('')

  // -- Summary ----------------------------------------------------------------
  const totalFailed = bookFailed + wishFailed
  console.log('Done.')
  console.log(`  Books:    ${bookPatched} patched, ${bookNoLocal} no local cover, ${bookFailed} failed`)
  console.log(`  Wishlist: ${wishPatched} patched, ${wishNoLocal} no local cover, ${wishFailed} failed`)

  if (totalFailed > 0) {
    console.warn(`WARNING: ${totalFailed} items failed.`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
