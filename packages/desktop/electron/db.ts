import { app, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { JSONFilePreset } from 'lowdb/node'

// Debounce timers for reading-state pushes.
// Key: "<userId>:<bookId>". Ensures that rapid status cycling (e.g. unread →
// reading → read in quick succession) only pushes the *latest* state to the
// cloud, preventing a slower "reading" push from overwriting a later "read"
// push due to network reordering.
const readingStatePushTimers = new Map<string, ReturnType<typeof setTimeout>>()

export interface Book {
  id: string
  title: string
  author: string
  isbn?: string
  publisher?: string
  /** @deprecated Use ReadingState per-user records instead. Kept for migration only. */
  status?: 'unread' | 'reading' | 'read'
  rating?: number
  coverUrl?: string
  /** R2 cover key returned by POST /api/covers/upload. Used for cloud cover serving. */
  coverKey?: string
  tags?: string[]
  /** Optional book detail page URL (e.g. Douban subject). Used for cover fetching and external links. */
  detailUrl?: string
  addedAt: string
  /** ISO timestamp of the last local write. Used for LWW sync conflict resolution. */
  updatedAt?: string
  /** Sync status: 'synced' = pushed to cloud; 'pending' = not yet pushed. */
  syncStatus?: 'synced' | 'pending'
}

export interface WishlistItem {
  id: string
  title: string
  author: string
  isbn?: string
  publisher?: string
  coverUrl?: string
  /** R2 cover key returned by POST /api/covers/upload. Used for cloud cover serving. */
  coverKey?: string
  /** Douban subject page URL or other external book detail page. Used for cover fetching and external links. */
  detailUrl?: string
  tags?: string[]
  priority: 'high' | 'medium' | 'low'
  pendingBuy?: boolean
  addedAt: string
  /** ISO timestamp of the last local write. Used for LWW sync conflict resolution. */
  updatedAt?: string
  /** Sync status: 'synced' = pushed to cloud; 'pending' = not yet pushed. */
  syncStatus?: 'synced' | 'pending'
}

export interface UIPreferences {
  /** Last visited page: 'library' | 'wishlist' | 'settings'. */
  activePage?: 'library' | 'wishlist' | 'settings'
  // Inventory page
  inventorySortKey?: string
  inventorySortDir?: 'asc' | 'desc'
  inventoryViewMode?: 'detail' | 'compact'
  inventoryCompactCols?: number
  // Wishlist page
  wishlistSortKey?: string
  wishlistSortDir?: 'asc' | 'desc'
  wishlistViewMode?: 'detail' | 'compact'
  wishlistCompactCols?: number
}

export interface UserProfile {
  id: string
  name: string
  createdAt: string
  /** UI language preference. Defaults to 'zh' when absent. */
  language?: 'zh' | 'en'
  /** Per-user UI state that should survive restarts. */
  uiPrefs?: UIPreferences
}

export interface ReadingState {
  userId: string
  bookId: string
  status: 'unread' | 'reading' | 'read'
  /** ISO datetime string set when status first transitions to 'read'. Cleared when status moves away from 'read'. */
  completedAt?: string
  /** ISO timestamp of the last local write. Used for LWW sync conflict resolution. */
  updatedAt?: string
  /** Sync status: 'synced' = pushed to cloud; 'pending' = not yet pushed. */
  syncStatus?: 'synced' | 'pending'
}

export type PriceChannel = 'jd' | 'bookschina' | 'dangdang'

export type PriceQuoteStatus = 'ok' | 'needs_login' | 'blocked' | 'not_found' | 'error'

export interface PriceQuote {
  channel: PriceChannel
  currency: 'CNY'
  url: string
  fetchedAt: string
  status: PriceQuoteStatus
  priceCny?: number
  /** Product page ID as extracted from the URL (JD sku, Dangdang id, BooksChina id). */
  productId?: string
  /** 'manual' = captured by user via popup window; 'auto' = captured by automated headless flow. */
  source?: 'manual' | 'auto'
  message?: string
}

export interface PriceQuery {
  title: string
  author?: string
  isbn?: string
}

export interface PriceCacheEntry {
  key: string
  query: PriceQuery
  quotes: PriceQuote[]
  updatedAt: string
  expiresAt: string
}

export interface DatabaseSchema {
  books: Book[]
  wishlist: WishlistItem[]
  priceCache: Record<string, PriceCacheEntry>
  users: UserProfile[]
  readingStates: ReadingState[]
  activeUserId: string | null
  /** Incremental sync cursors (latest updated_at seen per table). */
  syncCursors?: { books: string; wishlist: string; readingStates: string }
  /** ISO timestamp of the last successful pull from the cloud. */
  lastSyncAt?: string
}

const defaultData: DatabaseSchema = {
  books: [],
  wishlist: [],
  priceCache: {},
  users: [],
  readingStates: [],
  activeUserId: null,
}

let dbInstance: Awaited<ReturnType<typeof JSONFilePreset<DatabaseSchema>>> | null = null

export function getDb() {
  if (!dbInstance) throw new Error('Database not initialized')
  return dbInstance
}

// ---------------------------------------------------------------------------
// Local cover file helpers
// ---------------------------------------------------------------------------

/** Returns the local cover file path for a given record id, or null if not found. */
function findLocalCoverPath(id: string): string | null {
  const coversDir = path.join(app.getPath('userData'), 'covers')
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
    const p = path.join(coversDir, `${id}.${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

/** Deletes the local cover file for a given record id. No-op if the file doesn't exist. */
function deleteLocalCover(id: string): void {
  const p = findLocalCoverPath(id)
  if (p) {
    try { fs.unlinkSync(p) } catch { /* already gone */ }
  }
}

export async function setupDatabase() {
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'db.json')

  console.log('Database path:', dbPath)

  const db = await JSONFilePreset<DatabaseSchema>(dbPath, defaultData)
  db.data.books ??= []
  db.data.wishlist ??= []
  db.data.priceCache ??= {}
  db.data.users ??= []
  db.data.readingStates ??= []
  if (db.data.activeUserId === undefined) db.data.activeUserId = null
  dbInstance = db

  // ---------------------------------------------------------------------------
  // One-time migration: lift Book.status → ReadingState rows for the default user
  // Only runs when there are books with non-default status and no users yet.
  // ---------------------------------------------------------------------------
  if (db.data.users.length === 0) {
    const defaultUser: UserProfile = {
      id: crypto.randomUUID(),
      name: '匿名',
      createdAt: new Date().toISOString(),
    }
    db.data.users.push(defaultUser)
    db.data.activeUserId = defaultUser.id
    // Migrate any existing Book.status values
    for (const book of db.data.books) {
      if (book.status && book.status !== 'unread') {
        db.data.readingStates.push({
          userId: defaultUser.id,
          bookId: book.id,
          status: book.status,
        })
      }
    }
    await db.write()
  }

  // Guard: ensure activeUserId points to a real user
  if (
    db.data.activeUserId !== null &&
    !db.data.users.find(u => u.id === db.data.activeUserId)
  ) {
    db.data.activeUserId = db.data.users[0]?.id ?? null
    await db.write()
  }

  // ---------------------------------------------------------------------------
  // Migration: normalise author strings — ensure a space follows nationality
  // bracket prefixes such as [美]、（英）、(日) etc.
  // Idempotent: already-normalised strings are left unchanged.
  // ---------------------------------------------------------------------------
  {
    // Inline copy of the same logic as src/lib/author.ts so we don't import
    // renderer-side code from the main process.
    const NATIONALITY_RE = /^([\[【(（][\u4e00-\u9fff]{1,6}[\]】)）])(\s*)([\s\S]+)$/u
    function normalizeSegment(s: string): string {
      const trimmed = s.replace(/\s+/g, ' ').trim()
      return trimmed.replace(NATIONALITY_RE, (_, prefix, _ws, name) => `${prefix} ${name.trim()}`)
    }
    function normalizeAuthorStr(raw: string): string {
      if (!raw) return raw
      const parts = raw.split(/,\s*|\/|、/g).map(normalizeSegment).filter(Boolean)
      return parts.length === 0 ? raw : parts.join(', ')
    }

    let dirty = false
    for (const book of db.data.books) {
      const fixed = normalizeAuthorStr(book.author)
      if (fixed !== book.author) { book.author = fixed; dirty = true }
    }
    for (const item of db.data.wishlist) {
      const fixed = normalizeAuthorStr(item.author)
      if (fixed !== item.author) { item.author = fixed; dirty = true }
    }
    if (dirty) await db.write()
  }

  // ---------------------------------------------------------------------------
  // Migration: rename legacy doubanUrl → detailUrl for books and wishlist items.
  // Early versions of the app stored the detail page URL under the key doubanUrl.
  // The field was later renamed to detailUrl. Records written before the rename
  // still carry doubanUrl and have no detailUrl, so the cover-fetch and external-
  // link features silently fail for those records. This migration is idempotent:
  // it only copies when doubanUrl is present and detailUrl is absent.
  // ---------------------------------------------------------------------------
  {
    let dirty = false
    for (const record of [...db.data.books, ...db.data.wishlist]) {
      const r = record as unknown as Record<string, unknown>
      if (r['doubanUrl'] && !r['detailUrl']) {
        r['detailUrl'] = r['doubanUrl']
        delete r['doubanUrl']
        // Mark as pending so the next sync pushes detail_url to the cloud.
        // Without this the cloud D1 record keeps detail_url = NULL because
        // the field was never sent (it was stored under the wrong key).
        record.syncStatus = 'pending'
        dirty = true
      }
    }
    if (dirty) await db.write()
  }

  // ---------------------------------------------------------------------------
  // Book IPC handlers
  // ---------------------------------------------------------------------------
  ipcMain.handle('db:get-books', () => db.data.books)

  ipcMain.handle('db:add-book', async (_, book: Book) => {
    // Idempotency guard: if a book with this id already exists, skip the insert
    if (db.data.books.some(b => b.id === book.id)) return book
    const stamped: Book = { ...book, updatedAt: new Date().toISOString(), syncStatus: 'pending' }
    db.data.books.push(stamped)
    await db.write()
    void import('./sync.ts').then(m => m.pushBook(stamped)).catch(() => undefined)
    return stamped
  })

  ipcMain.handle('db:update-book', async (_, updatedBook: Book) => {
    const index = db.data.books.findIndex(b => b.id === updatedBook.id)
    if (index !== -1) {
      const existing = db.data.books[index]!
      // If the cover URL has changed from a previous value, delete the old local
      // file so it doesn't become an orphan. We only delete when existing.coverUrl
      // is already set — this guards against the race where saveCover writes the
      // new file first and then updateBook is called with the new coverUrl, which
      // would otherwise cause deleteLocalCover to remove the freshly-saved image.
      if (existing.coverUrl && existing.coverUrl !== updatedBook.coverUrl) {
        deleteLocalCover(existing.id)
      }
      const stamped: Book = { ...updatedBook, updatedAt: new Date().toISOString(), syncStatus: 'pending' }
      db.data.books[index] = stamped
      await db.write()
      void import('./sync.ts').then(m => m.pushBook(stamped)).catch(() => undefined)
      return stamped
    }
    return null
  })

  ipcMain.handle('db:delete-book', async (_, id: string) => {
    const index = db.data.books.findIndex(b => b.id === id)
    if (index !== -1) {
      db.data.books.splice(index, 1)
      // Clean up readingStates for this book across all users
      db.data.readingStates = db.data.readingStates.filter(rs => rs.bookId !== id)
      await db.write()
      deleteLocalCover(id)
      void import('./sync.ts').then(m => m.pushDeletedBook(id)).catch(() => undefined)
      return true
    }
    return false
  })

  // ---------------------------------------------------------------------------
  // Wishlist handlers
  // ---------------------------------------------------------------------------
  ipcMain.handle('db:get-wishlist', () => db.data.wishlist)

  ipcMain.handle('db:add-wishlist-item', async (_, item: WishlistItem) => {
    const stamped: WishlistItem = { ...item, updatedAt: new Date().toISOString(), syncStatus: 'pending' }
    db.data.wishlist.push(stamped)
    await db.write()
    void import('./sync.ts').then(m => m.pushWishlistItem(stamped)).catch(() => undefined)
    return stamped
  })

  ipcMain.handle('db:delete-wishlist-item', async (_, id: string) => {
    const index = db.data.wishlist.findIndex(w => w.id === id)
    if (index !== -1) {
      db.data.wishlist.splice(index, 1)
      await db.write()
      deleteLocalCover(id)
      void import('./sync.ts').then(m => m.pushDeletedWishlistItem(id)).catch(() => undefined)
      return true
    }
    return false
  })

  ipcMain.handle('db:update-wishlist-item', async (_, updatedItem: WishlistItem) => {
    const index = db.data.wishlist.findIndex(w => w.id === updatedItem.id)
    if (index !== -1) {
      const existing = db.data.wishlist[index]!
      // If the cover URL has changed from a previous value, delete the old local
      // file so it doesn't become an orphan. We only delete when existing.coverUrl
      // is already set — this guards against the race where saveCover writes the
      // new file first and then updateWishlistItem is called with the new coverUrl,
      // which would otherwise cause deleteLocalCover to remove the freshly-saved image.
      if (existing.coverUrl && existing.coverUrl !== updatedItem.coverUrl) {
        deleteLocalCover(existing.id)
      }
      const stamped: WishlistItem = { ...updatedItem, updatedAt: new Date().toISOString(), syncStatus: 'pending' }
      db.data.wishlist[index] = stamped
      await db.write()
      void import('./sync.ts').then(m => m.pushWishlistItem(stamped)).catch(() => undefined)
      return stamped
    }
    return null
  })

  ipcMain.handle('db:get-all-tags', () => {
    const tagSet = new Set<string>()
    for (const book of db.data.books) {
      for (const tag of book.tags ?? []) tagSet.add(tag)
    }
    for (const item of db.data.wishlist) {
      for (const tag of item.tags ?? []) tagSet.add(tag)
    }
    return [...tagSet].sort((a, b) => a.localeCompare(b))
  })

  // ---------------------------------------------------------------------------
  // User IPC handlers
  // ---------------------------------------------------------------------------
  ipcMain.handle('db:get-users', () => db.data.users)

  ipcMain.handle('db:add-user', async (_, name: string) => {
    const user: UserProfile = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
    }
    db.data.users.push(user)
    await db.write()
    void import('./sync.ts').then(m => m.pushProfile(user)).catch(() => undefined)
    return user
  })

  ipcMain.handle('db:rename-user', async (_, id: string, name: string) => {
    const user = db.data.users.find(u => u.id === id)
    if (!user) return null
    user.name = name.trim()
    await db.write()
    void import('./sync.ts').then(m => m.pushProfile(user)).catch(() => undefined)
    return user
  })

  ipcMain.handle('db:delete-user', async (_, id: string) => {
    if (db.data.users.length <= 1) return false   // must keep at least one user
    const index = db.data.users.findIndex(u => u.id === id)
    if (index === -1) return false
    db.data.users.splice(index, 1)
    db.data.readingStates = db.data.readingStates.filter(rs => rs.userId !== id)
    if (db.data.activeUserId === id) {
      db.data.activeUserId = db.data.users[0]?.id ?? null
    }
    await db.write()
    void import('./sync.ts').then(m => m.pushDeletedProfile(id)).catch(() => undefined)
    return true
  })

  ipcMain.handle('db:get-active-user', () => {
    if (!db.data.activeUserId) return null
    return db.data.users.find(u => u.id === db.data.activeUserId) ?? null
  })

  ipcMain.handle('db:set-active-user', async (_, id: string) => {
    const user = db.data.users.find(u => u.id === id)
    if (!user) return null
    db.data.activeUserId = id
    await db.write()
    return user
  })

  ipcMain.handle('db:set-user-language', async (_, id: string, language: 'zh' | 'en') => {
    const user = db.data.users.find(u => u.id === id)
    if (!user) return null
    user.language = language
    await db.write()
    return user
  })

  ipcMain.handle('db:get-reading-states', (_, userId: string) =>
    db.data.readingStates.filter(rs => rs.userId === userId)
  )

  ipcMain.handle('db:set-reading-state', async (_, state: ReadingState) => {
    const existing = db.data.readingStates.findIndex(
      rs => rs.userId === state.userId && rs.bookId === state.bookId
    )
    const stamped: ReadingState = { ...state, updatedAt: new Date().toISOString(), syncStatus: 'pending' }
    if (existing !== -1) {
      db.data.readingStates[existing] = stamped
    } else {
      db.data.readingStates.push(stamped)
    }
    await db.write()

    // Debounced push: if the user cycles status rapidly (unread→reading→read),
    // cancel any in-flight timer for this book and only push the latest state.
    // This prevents an earlier "reading" request from arriving at the server
    // after a later "read" request due to network reordering.
    const debounceKey = `${state.userId}:${state.bookId}`
    const pendingTimer = readingStatePushTimers.get(debounceKey)
    if (pendingTimer) clearTimeout(pendingTimer)
    readingStatePushTimers.set(
      debounceKey,
      setTimeout(() => {
        readingStatePushTimers.delete(debounceKey)
        // Re-read the latest state from db rather than using the closed-over
        // `stamped`, so we always push the most up-to-date value.
        const latest = db.data.readingStates.find(
          rs => rs.userId === state.userId && rs.bookId === state.bookId,
        )
        if (latest) {
          void import('./sync.ts').then(m => m.pushReadingState(latest)).catch(() => undefined)
        }
      }, 400),
    )

    return stamped
  })

  // ---------------------------------------------------------------------------
  // Per-user UI preferences
  // ---------------------------------------------------------------------------

  ipcMain.handle('db:get-ui-prefs', (_, userId: string): UIPreferences | null => {
    const user = db.data.users.find(u => u.id === userId)
    return user?.uiPrefs ?? null
  })

  ipcMain.handle('db:set-ui-prefs', async (_, userId: string, patch: Partial<UIPreferences>) => {
    const user = db.data.users.find(u => u.id === userId)
    if (!user) return null
    user.uiPrefs = { ...(user.uiPrefs ?? {}), ...patch }
    await db.write()
    return user.uiPrefs
  })
}
