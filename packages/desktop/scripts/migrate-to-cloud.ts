#!/usr/bin/env node
// scripts/migrate-to-cloud.ts
// One-shot migration: push local db.json content to the cloud API.
//
// Usage (from packages/desktop/):
//   TOMEKEEP_API_URL=https://tomekeep.pages.dev/api \
//   TOMEKEEP_USERNAME=<user> TOMEKEEP_PASSWORD=<pass> \
//   npx tsx scripts/migrate-to-cloud.ts
//
// What it does:
//   1. Login to the API and obtain a JWT token
//   2. Upload cover images to R2 (POST /api/covers/upload)
//   3. Batch-push books to /api/books (100 per batch, sequential)
//   4. Batch-push wishlist items to /api/wishlist
//   5. Batch-push reading states to /api/reading-states
//   6. Print a report and mark db.json as migrated
//
// Safe to re-run — the API uses UPSERT / idempotency guards.

import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = process.env['TOMEKEEP_API_URL'] ?? 'https://tomekeep.pages.dev/api'
const USERNAME = process.env['TOMEKEEP_USERNAME']
const PASSWORD = process.env['TOMEKEEP_PASSWORD']
const DB_PATH = process.env['TOMEKEEP_DB_PATH'] ??
  path.join(os.homedir(), 'Library', 'Application Support', 'TomeKeep', 'db.json')
const COVERS_DIR = process.env['TOMEKEEP_COVERS_DIR'] ??
  path.join(os.homedir(), 'Library', 'Application Support', 'TomeKeep', 'covers')
const BATCH_SIZE = 100

// ---------------------------------------------------------------------------
// Minimal type definitions (mirror db.ts without importing Electron)
// ---------------------------------------------------------------------------

interface Book {
  id: string
  title: string
  author: string
  isbn?: string
  publisher?: string
  coverUrl?: string
  coverKey?: string
  detailUrl?: string
  tags?: string[]
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
  priority: string
  pendingBuy?: boolean
  addedAt: string
  updatedAt?: string
  syncStatus?: string
}

interface ReadingState {
  userId: string
  bookId: string
  status: string
  completedAt?: string
}

interface DatabaseSchema {
  books: Book[]
  wishlist: WishlistItem[]
  readingStates: ReadingState[]
  migrated?: boolean
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiPost<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json() as T & { error?: string }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `http_${res.status}`)
  return data
}

async function apiPut<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json() as T & { error?: string }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `http_${res.status}`)
  return data
}

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = await res.json() as { token?: string; error?: string }
  if (!res.ok || !data.token) throw new Error(data.error ?? 'login_failed')
  return data.token
}

// ---------------------------------------------------------------------------
// Cover upload
// ---------------------------------------------------------------------------

async function uploadCover(bookId: string, token: string): Promise<string | null> {
  const extensions = ['jpg', 'jpeg', 'png', 'webp']
  let filePath: string | null = null
  for (const ext of extensions) {
    const candidate = path.join(COVERS_DIR, `${bookId}.${ext}`)
    if (fs.existsSync(candidate)) { filePath = candidate; break }
  }
  if (!filePath) return null

  try {
    const buf = fs.readFileSync(filePath)
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const mimeType = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg'

    const blob = new Blob([buf], { type: mimeType })
    const form = new FormData()
    form.append('file', blob, `${bookId}.${ext}`)

    const res = await fetch(`${API_BASE}/covers/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    if (!res.ok) return null
    const data = await res.json() as { coverKey?: string }
    return data.coverKey ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!USERNAME || !PASSWORD) {
    console.error('Error: set TOMEKEEP_USERNAME and TOMEKEEP_PASSWORD environment variables')
    process.exit(1)
  }

  // Read db.json
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Error: db.json not found at ${DB_PATH}`)
    process.exit(1)
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) as DatabaseSchema

  if (db.migrated) {
    console.log('Already marked as migrated. Use --force to re-run (not yet implemented).')
    process.exit(0)
  }

  console.log(`\nTomeKeep → Cloud Migration`)
  console.log(`API: ${API_BASE}`)
  console.log(`Books: ${db.books.length}, Wishlist: ${db.wishlist.length}, ReadingStates: ${db.readingStates.length}`)
  console.log(`Covers dir: ${COVERS_DIR}\n`)

  // Login
  console.log('Logging in...')
  const token = await login(USERNAME, PASSWORD)
  console.log('  OK\n')

  const report = {
    books: { total: db.books.length, pushed: 0, errors: 0, coversUploaded: 0 },
    wishlist: { total: db.wishlist.length, pushed: 0, errors: 0, coversUploaded: 0 },
    readingStates: { total: db.readingStates.length, pushed: 0, errors: 0 },
  }

  // ---------------------------------------------------------------------------
  // Books
  // ---------------------------------------------------------------------------
  console.log(`Migrating ${db.books.length} books...`)
  for (let i = 0; i < db.books.length; i += BATCH_SIZE) {
    const batch = db.books.slice(i, i + BATCH_SIZE)
    for (const book of batch) {
      // Upload cover first
      let coverKey = book.coverKey
      if (!coverKey) {
        const key = await uploadCover(book.id, token)
        if (key) { coverKey = key; report.books.coversUploaded++ }
      }

      const payload = {
        title: book.title,
        author: book.author,
        isbn: book.isbn,
        publisher: book.publisher,
        cover_key: coverKey ?? null,
        detail_url: book.detailUrl ?? null,
        tags: book.tags ?? [],
      }

      try {
        // Try PUT (upsert-like) — API returns 404 for unknown id, then POST
        try {
          await apiPut(`/books/${book.id}`, payload, token)
        } catch (e) {
          if (e instanceof Error && e.message === 'not_found') {
            await apiPost('/books', { ...payload, id: book.id }, token)
          } else {
            throw e
          }
        }
        report.books.pushed++
      } catch (err) {
        console.error(`  ERROR book ${book.id} "${book.title}":`, err instanceof Error ? err.message : err)
        report.books.errors++
      }
    }
    console.log(`  ${Math.min(i + BATCH_SIZE, db.books.length)} / ${db.books.length}`)
  }

  // ---------------------------------------------------------------------------
  // Wishlist
  // ---------------------------------------------------------------------------
  console.log(`\nMigrating ${db.wishlist.length} wishlist items...`)
  for (let i = 0; i < db.wishlist.length; i += BATCH_SIZE) {
    const batch = db.wishlist.slice(i, i + BATCH_SIZE)
    for (const item of batch) {
      let coverKey = item.coverKey
      if (!coverKey) {
        const key = await uploadCover(item.id, token)
        if (key) { coverKey = key; report.wishlist.coversUploaded++ }
      }

      const payload = {
        title: item.title,
        author: item.author,
        isbn: item.isbn,
        publisher: item.publisher,
        cover_key: coverKey ?? null,
        detail_url: item.detailUrl ?? null,
        tags: item.tags ?? [],
        priority: item.priority,
        pending_buy: item.pendingBuy ?? false,
      }

      try {
        try {
          await apiPut(`/wishlist/${item.id}`, payload, token)
        } catch (e) {
          if (e instanceof Error && e.message === 'not_found') {
            await apiPost('/wishlist', { ...payload, id: item.id }, token)
          } else {
            throw e
          }
        }
        report.wishlist.pushed++
      } catch (err) {
        console.error(`  ERROR wishlist ${item.id} "${item.title}":`, err instanceof Error ? err.message : err)
        report.wishlist.errors++
      }
    }
    console.log(`  ${Math.min(i + BATCH_SIZE, db.wishlist.length)} / ${db.wishlist.length}`)
  }

  // ---------------------------------------------------------------------------
  // Reading states
  // ---------------------------------------------------------------------------
  console.log(`\nMigrating ${db.readingStates.length} reading states...`)
  for (const state of db.readingStates) {
    try {
      await apiPut('/reading-states', {
        book_id: state.bookId,
        status: state.status,
        completed_at: state.completedAt ?? null,
      }, token)
      report.readingStates.pushed++
    } catch (err) {
      console.error(`  ERROR reading state ${state.bookId}:`, err instanceof Error ? err.message : err)
      report.readingStates.errors++
    }
  }
  console.log(`  ${report.readingStates.pushed} / ${db.readingStates.length}`)

  // ---------------------------------------------------------------------------
  // Mark migrated in db.json
  // ---------------------------------------------------------------------------
  db.migrated = true
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8')

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------
  console.log('\n--- Migration Report ---')
  console.log(`Books:         ${report.books.pushed}/${report.books.total} pushed, ${report.books.errors} errors, ${report.books.coversUploaded} covers uploaded`)
  console.log(`Wishlist:      ${report.wishlist.pushed}/${report.wishlist.total} pushed, ${report.wishlist.errors} errors, ${report.wishlist.coversUploaded} covers uploaded`)
  console.log(`ReadingStates: ${report.readingStates.pushed}/${report.readingStates.total} pushed, ${report.readingStates.errors} errors`)
  console.log('\ndb.json marked as migrated.')
  console.log('Done.')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
