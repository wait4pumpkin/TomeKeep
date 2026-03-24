import { app, ipcMain } from 'electron'
import path from 'node:path'
import { JSONFilePreset } from 'lowdb/node'

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
  tags?: string[]
  /** Optional custom Douban URL override. If absent, derived from isbn or title. */
  doubanUrl?: string
  addedAt: string
}

export interface WishlistItem {
  id: string
  title: string
  author: string
  isbn?: string
  publisher?: string
  coverUrl?: string
  tags?: string[]
  priority: 'high' | 'medium' | 'low'
  addedAt: string
}

export interface UserProfile {
  id: string
  name: string
  createdAt: string
}

export interface ReadingState {
  userId: string
  bookId: string
  status: 'unread' | 'reading' | 'read'
  /** ISO datetime string set when status first transitions to 'read'. Cleared when status moves away from 'read'. */
  completedAt?: string
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
  source?: 'manual'
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
  // Book IPC handlers
  // ---------------------------------------------------------------------------
  ipcMain.handle('db:get-books', () => db.data.books)

  ipcMain.handle('db:add-book', async (_, book: Book) => {
    db.data.books.push(book)
    await db.write()
    return book
  })

  ipcMain.handle('db:update-book', async (_, updatedBook: Book) => {
    const index = db.data.books.findIndex(b => b.id === updatedBook.id)
    if (index !== -1) {
      db.data.books[index] = updatedBook
      await db.write()
      return updatedBook
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
      return true
    }
    return false
  })

  // ---------------------------------------------------------------------------
  // Wishlist handlers
  // ---------------------------------------------------------------------------
  ipcMain.handle('db:get-wishlist', () => db.data.wishlist)

  ipcMain.handle('db:add-wishlist-item', async (_, item: WishlistItem) => {
    db.data.wishlist.push(item)
    await db.write()
    return item
  })

  ipcMain.handle('db:delete-wishlist-item', async (_, id: string) => {
    const index = db.data.wishlist.findIndex(w => w.id === id)
    if (index !== -1) {
      db.data.wishlist.splice(index, 1)
      await db.write()
      return true
    }
    return false
  })

  ipcMain.handle('db:update-wishlist-item', async (_, updatedItem: WishlistItem) => {
    const index = db.data.wishlist.findIndex(w => w.id === updatedItem.id)
    if (index !== -1) {
      db.data.wishlist[index] = updatedItem
      await db.write()
      return updatedItem
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
    return user
  })

  ipcMain.handle('db:rename-user', async (_, id: string, name: string) => {
    const user = db.data.users.find(u => u.id === id)
    if (!user) return null
    user.name = name.trim()
    await db.write()
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

  ipcMain.handle('db:get-reading-states', (_, userId: string) =>
    db.data.readingStates.filter(rs => rs.userId === userId)
  )

  ipcMain.handle('db:set-reading-state', async (_, state: ReadingState) => {
    const existing = db.data.readingStates.findIndex(
      rs => rs.userId === state.userId && rs.bookId === state.bookId
    )
    if (existing !== -1) {
      db.data.readingStates[existing] = state
    } else {
      db.data.readingStates.push(state)
    }
    await db.write()
    return state
  })
}
