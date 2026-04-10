#!/usr/bin/env tsx
/**
 * scripts/migrate-local-to-cloud.ts
 *
 * One-shot migration: upload local TomeKeep desktop data to the cloud API.
 *
 * Usage:
 *   export API_URL=https://books.cbbnews.top
 *   export AUTH_TOKEN=<JWT from login or admin-setup response>
 *   pnpm tsx scripts/migrate-local-to-cloud.ts
 *
 * What it does:
 *   1. Reads ~/Library/Application Support/TomeKeep/db.json
 *   2. Uploads cover images from the local covers/ directory to POST /api/covers/upload
 *      (skips covers already referenced by a cloud book/wishlist record)
 *   3. POSTs all books to /api/books (preserving original ids and added_at timestamps)
 *   4. POSTs all wishlist items to /api/wishlist (same)
 *   5. PUTs all reading states to /api/reading-states
 *
 * Idempotency:
 *   - Books and wishlist items: if a record with the same id already exists in the cloud,
 *     the POST will return 409 or succeed (depending on the server). Re-running is safe —
 *     existing records are not modified.
 *   - Reading states use upsert (ON CONFLICT DO UPDATE), so re-running updates them.
 *   - Cover uploads: checks existing cloud books/wishlist for cover_key presence to skip
 *     already-uploaded covers.
 *
 * Environment variables:
 *   API_URL       Base URL of the TomeKeep web API (no trailing slash)
 *   AUTH_TOKEN    Bearer JWT token from login
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Types (mirrors packages/desktop/electron/db.ts)
// ---------------------------------------------------------------------------

interface Book {
  id: string
  title: string
  author: string
  isbn?: string
  publisher?: string
  status?: 'unread' | 'reading' | 'read'
  rating?: number
  coverUrl?: string
  coverKey?: string
  tags?: string[]
  detailUrl?: string
  addedAt: string
  updatedAt?: string
  syncStatus?: string
}

interface WishlistItem {
  id: string
  title: string
  author: string
  isbn?: string
  publisher?: string
  coverUrl?: string
  coverKey?: string
  detailUrl?: string
  tags?: string[]
  priority: 'high' | 'medium' | 'low'
  pendingBuy?: boolean
  addedAt: string
  updatedAt?: string
  syncStatus?: string
}

interface ReadingState {
  userId: string
  bookId: string
  status: 'unread' | 'reading' | 'read'
  completedAt?: string
  updatedAt?: string
  syncStatus?: string
}

interface UserProfile {
  id: string
  name: string
  createdAt: string
  language?: 'zh' | 'en'
}

interface DatabaseSchema {
  books: Book[]
  wishlist: WishlistItem[]
  readingStates: ReadingState[]
  users: UserProfile[]
  activeUserId: string | null
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_URL = process.env['API_URL']?.replace(/\/$/, '')
const AUTH_TOKEN = process.env['AUTH_TOKEN']

if (!API_URL) {
  console.error('ERROR: API_URL environment variable is required.')
  console.error('  Example: export API_URL=https://books.cbbnews.top')
  process.exit(1)
}
if (!AUTH_TOKEN) {
  console.error('ERROR: AUTH_TOKEN environment variable is required.')
  console.error('  Get your token by calling POST /api/auth/login')
  process.exit(1)
}

const DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'TomeKeep')
const DB_PATH = path.join(DATA_DIR, 'db.json')
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
  try {
    data = await res.json()
  } catch {
    data = null
  }
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
    console.error(`    Cover upload failed (${res.status}):`, err)
    return null
  }
  const { coverKey } = (await res.json()) as { coverKey: string }
  return coverKey
}

// ---------------------------------------------------------------------------
// Progress helpers
// ---------------------------------------------------------------------------

function progress(current: number, total: number, label: string) {
  const pct = Math.round((current / total) * 100)
  process.stdout.write(`\r  [${pct.toString().padStart(3)}%] ${current}/${total} ${label}    `)
}

function done() {
  process.stdout.write('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('TomeKeep Local → Cloud Migration')
  console.log(`API: ${API_URL}`)
  console.log('')

  // -- 1. Read local db.json --------------------------------------------------
  if (!fs.existsSync(DB_PATH)) {
    console.error(`ERROR: db.json not found at ${DB_PATH}`)
    process.exit(1)
  }
  const db: DatabaseSchema = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'))
  const books = db.books ?? []
  const wishlist = db.wishlist ?? []
  const readingStates = db.readingStates ?? []

  console.log(`Local data:`)
  console.log(`  Books:          ${books.length}`)
  console.log(`  Wishlist:       ${wishlist.length}`)
  console.log(`  Reading states: ${readingStates.length}`)
  console.log('')

  // -- 2. Upload covers -------------------------------------------------------
  console.log('Step 1/4: Uploading cover images...')

  // Build a map: localCoverId → R2 coverKey
  // Local cover filenames are like: <bookId>.jpg, <bookId>.png, etc.
  const coverKeyMap = new Map<string, string>()

  if (fs.existsSync(COVERS_DIR)) {
    const coverFiles = fs.readdirSync(COVERS_DIR).filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))

    // Pre-populate coverKeyMap from existing coverKey fields in db.json
    // (set by a previous partial migration run).
    for (const book of books) {
      if (book.coverKey) coverKeyMap.set(book.id, book.coverKey)
    }
    for (const item of wishlist) {
      if (item.coverKey) coverKeyMap.set(item.id, item.coverKey)
    }

    // Upload any cover file that exists on disk and doesn't already have a
    // coverKey.  We intentionally do NOT filter by coverUrl startsWith('app://')
    // — books whose cover was fetched from a remote URL still have a local file
    // saved by Electron, and we want to migrate those too.
    const toUpload = coverFiles.filter(f => {
      const id = path.parse(f).name
      return !coverKeyMap.has(id)
    })

    let uploaded = 0
    let skipped = 0
    let failed = 0

    for (let i = 0; i < toUpload.length; i++) {
      const filename = toUpload[i]!
      const id = path.parse(filename).name
      const localPath = path.join(COVERS_DIR, filename)

      progress(i + 1, toUpload.length, `${filename}`)

      const coverKey = await uploadCover(localPath)
      if (coverKey) {
        coverKeyMap.set(id, coverKey)
        uploaded++
      } else {
        failed++
      }
    }

    const alreadyHaveKey = books.filter(b => b.coverKey).length + wishlist.filter(w => w.coverKey).length
    skipped = alreadyHaveKey

    done()
    console.log(`  Uploaded: ${uploaded}, Skipped (already had key): ${skipped}, Failed: ${failed}`)
  } else {
    console.log('  No covers directory found, skipping.')
  }

  // -- 3. Upload books --------------------------------------------------------
  console.log('')
  console.log('Step 2/4: Uploading books...')

  let booksCreated = 0
  let booksSkipped = 0
  let booksFailed = 0

  for (let i = 0; i < books.length; i++) {
    const book = books[i]!
    progress(i + 1, books.length, book.title.slice(0, 40))

    const coverKey = coverKeyMap.get(book.id) ?? book.coverKey ?? undefined

    const res = await apiFetch('POST', '/api/books', {
      id: book.id,
      title: book.title,
      author: book.author,
      isbn: book.isbn ?? undefined,
      publisher: book.publisher ?? undefined,
      cover_key: coverKey,
      detail_url: book.detailUrl ?? undefined,
      tags: book.tags ?? [],
      added_at: book.addedAt,
    })

    if (res.ok) {
      booksCreated++
    } else if (res.status === 409) {
      // Already exists — patch cover_key if we now have one and the book
      // was previously migrated without a cover (common on first run).
      const coverKey = coverKeyMap.get(book.id)
      if (coverKey) {
        const patchRes = await apiFetch('PUT', `/api/books/${book.id}`, { cover_key: coverKey })
        if (patchRes.ok) {
          booksSkipped++ // patched counts as "already existed"
        } else {
          console.error(`\n    FAILED patching cover for book "${book.title}" (${patchRes.status}):`, patchRes.data)
          booksSkipped++
        }
      } else {
        booksSkipped++
      }
    } else {
      booksFailed++
      console.error(`\n    FAILED book "${book.title}" (${res.status}):`, res.data)
    }
  }

  done()
  console.log(`  Created: ${booksCreated}, Already existed: ${booksSkipped}, Failed: ${booksFailed}`)

  // -- 4. Upload wishlist -----------------------------------------------------
  console.log('')
  console.log('Step 3/4: Uploading wishlist...')

  let wishCreated = 0
  let wishSkipped = 0
  let wishFailed = 0

  for (let i = 0; i < wishlist.length; i++) {
    const item = wishlist[i]!
    progress(i + 1, wishlist.length, item.title.slice(0, 40))

    const coverKey = coverKeyMap.get(item.id) ?? item.coverKey ?? undefined

    const res = await apiFetch('POST', '/api/wishlist', {
      id: item.id,
      title: item.title,
      author: item.author,
      isbn: item.isbn ?? undefined,
      publisher: item.publisher ?? undefined,
      cover_key: coverKey,
      detail_url: item.detailUrl ?? undefined,
      tags: item.tags ?? [],
      priority: item.priority ?? 'medium',
      pending_buy: item.pendingBuy ?? false,
      added_at: item.addedAt,
    })

    if (res.ok) {
      wishCreated++
    } else if (res.status === 409) {
      // Already exists — patch cover_key if we now have one.
      const coverKey = coverKeyMap.get(item.id)
      if (coverKey) {
        const patchRes = await apiFetch('PUT', `/api/wishlist/${item.id}`, { cover_key: coverKey })
        if (patchRes.ok) {
          wishSkipped++
        } else {
          console.error(`\n    FAILED patching cover for wishlist "${item.title}" (${patchRes.status}):`, patchRes.data)
          wishSkipped++
        }
      } else {
        wishSkipped++
      }
    } else {
      wishFailed++
      console.error(`\n    FAILED wishlist "${item.title}" (${res.status}):`, res.data)
    }
  }

  done()
  console.log(`  Created: ${wishCreated}, Already existed: ${wishSkipped}, Failed: ${wishFailed}`)

  // -- 5. Upload reading states -----------------------------------------------
  console.log('')
  console.log('Step 4/4: Uploading reading states...')

  let statesUpserted = 0
  let statesFailed = 0

  // Only upload states for books that exist (were just created or already existed).
  // Skip states for books not in the cloud to avoid 404s.
  const validBookIds = new Set(books.map(b => b.id))

  const validStates = readingStates.filter(s => validBookIds.has(s.bookId))

  for (let i = 0; i < validStates.length; i++) {
    const state = validStates[i]!
    progress(i + 1, validStates.length, `book ${state.bookId.slice(0, 8)}…`)

    const res = await apiFetch('PUT', '/api/reading-states', {
      book_id: state.bookId,
      status: state.status,
      completed_at: state.completedAt ?? undefined,
      // profile_id omitted → account-level state (legacy default)
    })

    if (res.ok) {
      statesUpserted++
    } else {
      statesFailed++
      // 404 means the book wasn't created — not a real error
      if (res.status !== 404) {
        console.error(`\n    FAILED reading state for book ${state.bookId} (${res.status}):`, res.data)
      } else {
        statesFailed-- // don't count 404s as failures
      }
    }
  }

  done()
  const skippedStates = readingStates.length - validStates.length
  console.log(`  Upserted: ${statesUpserted}, Failed: ${statesFailed}, Skipped (book not found): ${skippedStates}`)

  // -- Summary ----------------------------------------------------------------
  console.log('')
  console.log('Migration complete!')
  console.log(`  Books:          ${booksCreated} created, ${booksSkipped} already existed, ${booksFailed} failed`)
  console.log(`  Wishlist:       ${wishCreated} created, ${wishSkipped} already existed, ${wishFailed} failed`)
  console.log(`  Reading states: ${statesUpserted} upserted, ${statesFailed} failed`)
  console.log('')

  const totalFailed = booksFailed + wishFailed + statesFailed
  if (totalFailed > 0) {
    console.warn(`WARNING: ${totalFailed} items failed. Check the errors above and re-run if needed.`)
    process.exit(1)
  } else {
    console.log('All data migrated successfully.')
  }
}

main().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
