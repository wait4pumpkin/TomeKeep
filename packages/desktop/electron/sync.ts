// electron/sync.ts
// Desktop sync engine — Bearer-token API client + LWW merge into lowdb.
//
// Responsibilities:
//   - Store/retrieve JWT token via Electron safeStorage
//   - API request wrapper (Bearer auth)
//   - Incremental pull (LWW merge into lowdb)
//   - Push individual items to the cloud
//   - Replay pending queue for offline writes
//   - IPC handlers: sync:login, sync:logout, sync:status, sync:pull, sync:push-pending

import { ipcMain, safeStorage, app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getDb } from './db.ts'
import type { Book, WishlistItem, ReadingState } from './db.ts'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// The base URL is baked in at build time via VITE_API_BASE_URL (Vite define),
// but in the main process we read the raw env var.  Fall back to the deployed
// Cloudflare Pages URL so packaged builds work without any extra config.
function getApiBase(): string {
  return process.env['TOMEKEEP_API_URL'] ?? 'https://tomekeep.pages.dev/api'
}

// ---------------------------------------------------------------------------
// Token persistence — Electron safeStorage (OS keychain on macOS)
// ---------------------------------------------------------------------------

const TOKEN_FILE = path.join(app.getPath('userData'), '.sync-token')

export function getToken(): string | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null
    const encrypted = fs.readFileSync(TOKEN_FILE)
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}

function setToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) return
  const encrypted = safeStorage.encryptString(token)
  fs.writeFileSync(TOKEN_FILE, encrypted)
}

function clearToken(): void {
  try { fs.unlinkSync(TOKEN_FILE) } catch { /* already gone */ }
}

// ---------------------------------------------------------------------------
// API request helper
// ---------------------------------------------------------------------------

interface ApiError { error: string }

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  formData?: FormData,
): Promise<T> {
  const token = getToken()
  if (!token) throw new Error('not_authenticated')

  const url = `${getApiBase()}${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `http_${res.status}` })) as ApiError
    throw new Error(err.error ?? `http_${res.status}`)
  }

  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Type shapes returned by the API (snake_case)
// ---------------------------------------------------------------------------

interface ApiBook {
  id: string
  title: string
  author: string
  isbn: string | null
  publisher: string | null
  cover_key: string | null
  detail_url: string | null
  tags: string[]
  added_at: string
  updated_at: string
  deleted_at: string | null
}

interface ApiWishlistItem {
  id: string
  title: string
  author: string
  isbn: string | null
  publisher: string | null
  cover_key: string | null
  detail_url: string | null
  tags: string[]
  priority: string
  pending_buy: boolean
  added_at: string
  updated_at: string
  deleted_at: string | null
}

interface ApiReadingState {
  user_id: string
  book_id: string
  profile_id: string | null
  status: string
  completed_at: string | null
  updated_at: string
}

interface ApiProfile {
  id: string
  owner_id: string
  name: string
  created_at: string
  updated_at: string
}

interface SyncStatus {
  books: string | null
  wishlist: string | null
  readingStates: string | null
}

// ---------------------------------------------------------------------------
// camelCase ↔ snake_case translators
// ---------------------------------------------------------------------------

function bookToApi(book: Book): Partial<ApiBook> {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    isbn: book.isbn ?? null,
    publisher: book.publisher ?? null,
    cover_key: book.coverKey ?? null,
    detail_url: book.detailUrl ?? null,
    tags: book.tags ?? [],
    added_at: book.addedAt,
  }
}

function apiToBook(row: ApiBook): Partial<Book> & { id: string } {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    isbn: row.isbn ?? undefined,
    publisher: row.publisher ?? undefined,
    coverKey: row.cover_key ?? undefined,
    detailUrl: row.detail_url ?? undefined,
    tags: row.tags,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
    syncStatus: 'synced' as const,
  }
}

function wishlistItemToApi(item: WishlistItem): Partial<ApiWishlistItem> {
  return {
    id: item.id,
    title: item.title,
    author: item.author,
    isbn: item.isbn ?? null,
    publisher: item.publisher ?? null,
    cover_key: item.coverKey ?? null,
    detail_url: item.detailUrl ?? null,
    tags: item.tags ?? [],
    priority: item.priority,
    pending_buy: item.pendingBuy ?? false,
    added_at: item.addedAt,
  }
}

function apiToWishlistItem(row: ApiWishlistItem): Partial<WishlistItem> & { id: string } {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    isbn: row.isbn ?? undefined,
    publisher: row.publisher ?? undefined,
    coverKey: row.cover_key ?? undefined,
    detailUrl: row.detail_url ?? undefined,
    tags: row.tags,
    priority: row.priority as WishlistItem['priority'],
    pendingBuy: row.pending_buy,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
    syncStatus: 'synced' as const,
  }
}

function readingStateToApi(state: ReadingState): Partial<ApiReadingState> {
  return {
    book_id: state.bookId,
    profile_id: state.userId,
    status: state.status,
    completed_at: state.completedAt ?? null,
  }
}

// Map an API row back to a local ReadingState.
// profile_id on the server equals the local user's id (they share the same UUID).
// Rows with profile_id === null were written before multi-profile support and are
// skipped here — they are handled separately as a legacy baseline if needed.
function apiToReadingState(row: ApiReadingState): (Partial<ReadingState> & { userId: string; bookId: string }) | null {
  if (!row.profile_id) return null   // null-profile rows have no local user to route to
  return {
    userId: row.profile_id,           // profile_id IS the local user id
    bookId: row.book_id,
    status: row.status as ReadingState['status'],
    completedAt: row.completed_at ?? undefined,
    updatedAt: row.updated_at,
    syncStatus: 'synced' as const,
  }
}

// ---------------------------------------------------------------------------
// Pull — incremental fetch + LWW merge into lowdb
// ---------------------------------------------------------------------------

export async function pullAll(): Promise<{ updated: boolean; error?: string }> {
  const token = getToken()
  if (!token) return { updated: false }

  try {
    // Phase 0: ensure all local users exist as profiles in the cloud
    await syncProfiles()
    const db = getDb()
    const cursors = db.data.syncCursors ?? { books: '', wishlist: '', readingStates: '' }

    const status = await apiRequest<SyncStatus>('GET', '/sync/status')

    let updated = false

    // --- Books ---
    if (!cursors.books || (status.books && status.books > cursors.books)) {
      const since = cursors.books ? `?since=${encodeURIComponent(cursors.books)}` : ''
      const rows = await apiRequest<ApiBook[]>('GET', `/books${since}`)
      for (const row of rows) {
        if (row.deleted_at) {
          // Soft-delete: remove locally if present
          const idx = db.data.books.findIndex(b => b.id === row.id)
          if (idx !== -1) { db.data.books.splice(idx, 1); updated = true }
        } else {
          const idx = db.data.books.findIndex(b => b.id === row.id)
          const incoming = apiToBook(row)
          if (idx === -1) {
            // New book from cloud — fill in required local fields
            const newBook: Book = {
              id: incoming.id,
              title: incoming.title ?? '',
              author: incoming.author ?? '',
              isbn: incoming.isbn,
              publisher: incoming.publisher,
              coverKey: incoming.coverKey,
              detailUrl: incoming.detailUrl,
              tags: incoming.tags,
              addedAt: incoming.addedAt ?? new Date().toISOString(),
              updatedAt: incoming.updatedAt,
              syncStatus: 'synced',
            }
            db.data.books.push(newBook)
            updated = true
          } else {
            const local = db.data.books[idx]!
            // LWW: server wins if its updated_at is newer
            const localTs = local.updatedAt ?? local.addedAt
            if (row.updated_at > (localTs ?? '')) {
              db.data.books[idx] = { ...local, ...incoming }
              updated = true
            }
          }
        }
      }
      if (status.books) cursors.books = status.books
    }

    // --- Wishlist ---
    if (!cursors.wishlist || (status.wishlist && status.wishlist > cursors.wishlist)) {
      const since = cursors.wishlist ? `?since=${encodeURIComponent(cursors.wishlist)}` : ''
      const rows = await apiRequest<ApiWishlistItem[]>('GET', `/wishlist${since}`)
      for (const row of rows) {
        if (row.deleted_at) {
          const idx = db.data.wishlist.findIndex(w => w.id === row.id)
          if (idx !== -1) { db.data.wishlist.splice(idx, 1); updated = true }
        } else {
          const idx = db.data.wishlist.findIndex(w => w.id === row.id)
          const incoming = apiToWishlistItem(row)
          if (idx === -1) {
            const newItem: WishlistItem = {
              id: incoming.id,
              title: incoming.title ?? '',
              author: incoming.author ?? '',
              isbn: incoming.isbn,
              publisher: incoming.publisher,
              coverKey: incoming.coverKey,
              detailUrl: incoming.detailUrl,
              tags: incoming.tags,
              priority: incoming.priority ?? 'medium',
              pendingBuy: incoming.pendingBuy,
              addedAt: incoming.addedAt ?? new Date().toISOString(),
              updatedAt: incoming.updatedAt,
              syncStatus: 'synced',
            }
            db.data.wishlist.push(newItem)
            updated = true
          } else {
            const local = db.data.wishlist[idx]!
            const localTs = local.updatedAt ?? local.addedAt
            if (row.updated_at > (localTs ?? '')) {
              db.data.wishlist[idx] = { ...local, ...incoming }
              updated = true
            }
          }
        }
      }
      if (status.wishlist) cursors.wishlist = status.wishlist
    }

    // --- Reading states ---
    // Fetch all reading states for this account (no profile_id filter).
    // Route each row to the local user whose id matches row.profile_id.
    // Rows with profile_id = null are legacy (pre-profile) and skipped — they
    // have no unambiguous local owner.
    if (!cursors.readingStates || (status.readingStates && status.readingStates > cursors.readingStates)) {
      const since = cursors.readingStates ? `?since=${encodeURIComponent(cursors.readingStates)}` : ''
      const rows = await apiRequest<ApiReadingState[]>('GET', `/reading-states${since}`)
      // Build a set of local user ids for fast lookup
      const localUserIds = new Set(db.data.users.map(u => u.id))
      for (const row of rows) {
        const incoming = apiToReadingState(row)
        // Skip rows that don't map to any known local user
        if (!incoming || !localUserIds.has(incoming.userId)) continue
        const idx = db.data.readingStates.findIndex(
          rs => rs.userId === incoming.userId && rs.bookId === incoming.bookId,
        )
        if (idx === -1) {
          db.data.readingStates.push(incoming as ReadingState)
          updated = true
        } else {
          const local = db.data.readingStates[idx]!
          const localTs = local.updatedAt ?? ''
          if (row.updated_at > localTs) {
            db.data.readingStates[idx] = { ...local, ...incoming }
            updated = true
          }
        }
      }
      if (status.readingStates) cursors.readingStates = status.readingStates
    }

    db.data.syncCursors = cursors
    db.data.lastSyncAt = new Date().toISOString()
    await db.write()

    return { updated }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sync] pullAll error:', msg)
    return { updated: false, error: msg }
  }
}

// ---------------------------------------------------------------------------
// Push helpers
// ---------------------------------------------------------------------------

export async function pushBook(book: Book): Promise<void> {
  const db = getDb()
  try {
    const payload = bookToApi(book)
    // Try PUT first; if 404 → POST (new record on server)
    try {
      await apiRequest('PUT', `/books/${book.id}`, payload)
    } catch (e) {
      if (e instanceof Error && e.message === 'not_found') {
        await apiRequest('POST', '/books', payload)
      } else {
        throw e
      }
    }
    // Mark synced
    const idx = db.data.books.findIndex(b => b.id === book.id)
    if (idx !== -1) { db.data.books[idx]!.syncStatus = 'synced' }
    await db.write()
  } catch (err) {
    console.error('[sync] pushBook failed for', book.id, err)
    // Leave syncStatus as 'pending' so the queue replays it later
  }
}

export async function pushWishlistItem(item: WishlistItem): Promise<void> {
  const db = getDb()
  try {
    const payload = wishlistItemToApi(item)
    try {
      await apiRequest('PUT', `/wishlist/${item.id}`, payload)
    } catch (e) {
      if (e instanceof Error && e.message === 'not_found') {
        await apiRequest('POST', '/wishlist', payload)
      } else {
        throw e
      }
    }
    const idx = db.data.wishlist.findIndex(w => w.id === item.id)
    if (idx !== -1) { db.data.wishlist[idx]!.syncStatus = 'synced' }
    await db.write()
  } catch (err) {
    console.error('[sync] pushWishlistItem failed for', item.id, err)
  }
}

export async function pushReadingState(state: ReadingState): Promise<void> {
  const db = getDb()
  try {
    const payload = readingStateToApi(state)
    await apiRequest('PUT', '/reading-states', payload)
    const idx = db.data.readingStates.findIndex(
      rs => rs.userId === state.userId && rs.bookId === state.bookId,
    )
    if (idx !== -1) { db.data.readingStates[idx]!.syncStatus = 'synced' }
    await db.write()
  } catch (err) {
    console.error('[sync] pushReadingState failed for', state.bookId, err)
  }
}

export async function pushDeletedBook(id: string): Promise<void> {
  try {
    await apiRequest('DELETE', `/books/${id}`)
  } catch (err) {
    console.error('[sync] pushDeletedBook failed for', id, err)
  }
}

export async function pushDeletedWishlistItem(id: string): Promise<void> {
  try {
    await apiRequest('DELETE', `/wishlist/${id}`)
  } catch (err) {
    console.error('[sync] pushDeletedWishlistItem failed for', id, err)
  }
}

// ---------------------------------------------------------------------------
// Profile push helpers — keep cloud profiles in sync with local users
// ---------------------------------------------------------------------------

export async function pushProfile(user: import('./db.ts').UserProfile): Promise<void> {
  try {
    await apiRequest<ApiProfile>('POST', '/profiles', { id: user.id, name: user.name })
  } catch (err) {
    // profile_limit_reached (422) is non-fatal — log and continue
    const msg = err instanceof Error ? err.message : String(err)
    if (msg !== 'not_authenticated') {
      console.error('[sync] pushProfile failed for', user.id, msg)
    }
  }
}

export async function pushDeletedProfile(id: string): Promise<void> {
  try {
    await apiRequest('DELETE', `/profiles/${id}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // not_found is fine — already gone on the server
    if (msg !== 'not_found' && msg !== 'not_authenticated') {
      console.error('[sync] pushDeletedProfile failed for', id, msg)
    }
  }
}

/** Upsert all local users to the cloud profiles table. Idempotent — safe to call repeatedly. */
async function syncProfiles(): Promise<void> {
  if (!getToken()) return
  const db = getDb()
  for (const user of db.data.users) {
    await pushProfile(user)
  }
}

// Upload a local cover file to R2 via the API. Returns the cover_key or null.
export async function uploadCoverToCloud(bookId: string): Promise<string | null> {
  const coversDir = path.join(app.getPath('userData'), 'covers')
  // Try common extensions
  const extensions = ['jpg', 'jpeg', 'png', 'webp']
  let filePath: string | null = null
  for (const ext of extensions) {
    const candidate = path.join(coversDir, `${bookId}.${ext}`)
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

    const token = getToken()
    if (!token) return null

    const res = await fetch(`${getApiBase()}/covers/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    if (!res.ok) return null
    const data = await res.json() as { coverKey?: string }
    return data.coverKey ?? null
  } catch (err) {
    console.error('[sync] uploadCoverToCloud failed for', bookId, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Pending queue replay
// ---------------------------------------------------------------------------

export async function pushPendingQueue(): Promise<void> {
  if (!getToken()) return
  const db = getDb()

  const pendingBooks = db.data.books.filter(b => b.syncStatus === 'pending')
  const pendingWishlist = db.data.wishlist.filter(w => w.syncStatus === 'pending')
  const pendingStates = db.data.readingStates.filter(rs => rs.syncStatus === 'pending')

  await Promise.all([
    ...pendingBooks.map(b => pushBook(b)),
    ...pendingWishlist.map(w => pushWishlistItem(w)),
    ...pendingStates.map(rs => pushReadingState(rs)),
  ])
}

// ---------------------------------------------------------------------------
// One-shot migration: push all local data that hasn't been synced yet
// ---------------------------------------------------------------------------

export interface MigrateProgress {
  phase: 'covers' | 'books' | 'wishlist' | 'readingStates' | 'done'
  current: number
  total: number
}

export interface MigrateResult {
  ok: boolean
  error?: string
  books: number
  wishlist: number
  readingStates: number
  covers: number
  skipped: number
}

async function migrateAll(
  onProgress: (p: MigrateProgress) => void,
): Promise<MigrateResult> {
  // Fail fast if not logged in — avoids silently skipping every item.
  if (!getToken()) throw new Error('not_authenticated')

  const db = getDb()
  // Re-read from disk to make sure in-memory data is up to date before migrating.
  await db.read()

  const result: MigrateResult = { ok: true, books: 0, wishlist: 0, readingStates: 0, covers: 0, skipped: 0 }

  const books = db.data.books
  const wishlist = db.data.wishlist
  const readingStates = db.data.readingStates

  // Phase 0: push all local users as cloud profiles (upsert, idempotent)
  await syncProfiles()

  // Phase 1: upload missing covers for books
  onProgress({ phase: 'covers', current: 0, total: books.length + wishlist.length })
  let coversDone = 0
  for (const book of books) {
    if (!book.coverKey) {
      const coverKey = await uploadCoverToCloud(book.id)
      if (coverKey) {
        const idx = db.data.books.findIndex(b => b.id === book.id)
        if (idx !== -1) {
          db.data.books[idx]!.coverKey = coverKey
          result.covers++
        }
      }
    }
    coversDone++
    onProgress({ phase: 'covers', current: coversDone, total: books.length + wishlist.length })
  }
  for (const item of wishlist) {
    if (!item.coverKey) {
      const coverKey = await uploadCoverToCloud(item.id)
      if (coverKey) {
        const idx = db.data.wishlist.findIndex(w => w.id === item.id)
        if (idx !== -1) {
          db.data.wishlist[idx]!.coverKey = coverKey
          result.covers++
        }
      }
    }
    coversDone++
    onProgress({ phase: 'covers', current: coversDone, total: books.length + wishlist.length })
  }
  await db.write()

  // Phase 2: push books
  onProgress({ phase: 'books', current: 0, total: books.length })
  for (let i = 0; i < books.length; i++) {
    const book = db.data.books[i]!
    try {
      const payload = bookToApi(book)
      try {
        await apiRequest('PUT', `/books/${book.id}`, payload)
      } catch (e) {
        if (e instanceof Error && e.message === 'not_found') {
          await apiRequest('POST', '/books', payload)
        } else throw e
      }
      db.data.books[i]!.syncStatus = 'synced'
      result.books++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[migrate] book failed', book.id, msg)
      // Auth or network failures are fatal — abort rather than loop 300+ times.
      if (msg === 'not_authenticated' || msg === 'http_401') throw new Error(msg)
      result.skipped++
    }
    onProgress({ phase: 'books', current: i + 1, total: books.length })
  }
  await db.write()

  // Phase 3: push wishlist
  onProgress({ phase: 'wishlist', current: 0, total: wishlist.length })
  for (let i = 0; i < wishlist.length; i++) {
    const item = db.data.wishlist[i]!
    try {
      const payload = wishlistItemToApi(item)
      try {
        await apiRequest('PUT', `/wishlist/${item.id}`, payload)
      } catch (e) {
        if (e instanceof Error && e.message === 'not_found') {
          await apiRequest('POST', '/wishlist', payload)
        } else throw e
      }
      db.data.wishlist[i]!.syncStatus = 'synced'
      result.wishlist++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[migrate] wishlist failed', item.id, msg)
      if (msg === 'not_authenticated' || msg === 'http_401') throw new Error(msg)
      result.skipped++
    }
    onProgress({ phase: 'wishlist', current: i + 1, total: wishlist.length })
  }
  await db.write()

  // Phase 4: push reading states
  onProgress({ phase: 'readingStates', current: 0, total: readingStates.length })
  for (let i = 0; i < readingStates.length; i++) {
    const state = db.data.readingStates[i]!
    try {
      await apiRequest('PUT', '/reading-states', readingStateToApi(state))
      db.data.readingStates[i]!.syncStatus = 'synced'
      result.readingStates++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[migrate] readingState failed', state.bookId, msg)
      if (msg === 'not_authenticated' || msg === 'http_401') throw new Error(msg)
      result.skipped++
    }
    onProgress({ phase: 'readingStates', current: i + 1, total: readingStates.length })
  }
  await db.write()

  onProgress({ phase: 'done', current: 0, total: 0 })
  return result
}

// ---------------------------------------------------------------------------
// IPC setup
// ---------------------------------------------------------------------------

export function setupSync(): void {
  // sync:login — { username, password } → { ok, error? }
  ipcMain.handle('sync:login', async (_, { username, password }: { username: string; password: string }) => {
    try {
      const res = await fetch(`${getApiBase()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `http_${res.status}` })) as ApiError
        return { ok: false, error: data.error ?? `http_${res.status}` }
      }
      const data = await res.json() as { token?: string; error?: string }
      if (!data.token) return { ok: false, error: 'no_token' }
      setToken(data.token)
      // Kick off initial pull in background
      void pullAll()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // sync:logout
  ipcMain.handle('sync:logout', () => {
    clearToken()
    return { ok: true }
  })

  // sync:status — { loggedIn, lastSyncAt }
  ipcMain.handle('sync:status', () => {
    const token = getToken()
    const db = getDb()
    return {
      loggedIn: !!token,
      lastSyncAt: db.data.lastSyncAt ?? null,
    }
  })

  // sync:pull — trigger a full incremental pull
  ipcMain.handle('sync:pull', async () => {
    return pullAll()
  })

  // sync:push-pending — replay pending queue
  ipcMain.handle('sync:push-pending', async () => {
    await pushPendingQueue()
    return { ok: true }
  })

  // sync:migrate — one-shot migration of all local data to the cloud.
  // Progress events are pushed to the renderer via 'sync:migrate-progress'.
  ipcMain.handle('sync:migrate', async (event) => {
    try {
      const result = await migrateAll((progress) => {
        event.sender.send('sync:migrate-progress', progress)
      })
      return { ok: true as const, books: result.books, wishlist: result.wishlist, readingStates: result.readingStates, covers: result.covers, skipped: result.skipped }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, error: msg, books: 0, wishlist: 0, readingStates: 0, covers: 0, skipped: 0 }
    }
  })
}
