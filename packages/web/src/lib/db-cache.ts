// src/lib/db-cache.ts
// IndexedDB cache layer for the PWA.
// Stores books, wishlist, reading-states locally so the app works offline.
// Uses a simple key-value store pattern on top of IndexedDB.

const DB_NAME = 'tomekeep'
const DB_VERSION = 2

// ---------------------------------------------------------------------------
// Shared types (mirror API row shapes)
// ---------------------------------------------------------------------------

export interface CachedBook {
  id: string
  owner_id: string
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

export interface CachedWishlistItem {
  id: string
  owner_id: string
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

export interface CachedReadingState {
  user_id: string
  book_id: string
  profile_id: string | null
  status: string
  completed_at: string | null
  updated_at: string
}

// Cursors track the last synced updated_at per table.
export interface SyncCursors {
  books: string
  wishlist: string
  readingStates: string
}

// ---------------------------------------------------------------------------
// Open DB
// ---------------------------------------------------------------------------

let _db: IDBDatabase | null = null

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (event) => {
      const db = req.result
      const oldVersion = event.oldVersion

      if (!db.objectStoreNames.contains('books')) {
        const books = db.createObjectStore('books', { keyPath: 'id' })
        books.createIndex('updated_at', 'updated_at')
      }
      if (!db.objectStoreNames.contains('wishlist')) {
        const wl = db.createObjectStore('wishlist', { keyPath: 'id' })
        wl.createIndex('updated_at', 'updated_at')
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' })
      }

      // v1 used keyPath ['user_id','book_id']; v2 adds profile_id to the key.
      // Drop and recreate so the composite key is correct.
      if (oldVersion < 2) {
        if (db.objectStoreNames.contains('reading_states')) {
          db.deleteObjectStore('reading_states')
        }
        const rs = db.createObjectStore('reading_states', { keyPath: ['user_id', 'book_id', 'profile_id'] })
        rs.createIndex('updated_at', 'updated_at')
      } else if (!db.objectStoreNames.contains('reading_states')) {
        const rs = db.createObjectStore('reading_states', { keyPath: ['user_id', 'book_id', 'profile_id'] })
        rs.createIndex('updated_at', 'updated_at')
      }
    }

    req.onsuccess = () => { _db = req.result; resolve(_db) }
    req.onerror = () => reject(req.error)
  })
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function tx(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
): IDBTransaction {
  return db.transaction(stores, mode)
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function getAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return promisifyRequest<T[]>(
    tx(db, storeName, 'readonly').objectStore(storeName).getAll()
  )
}

function putAllToStore<T>(db: IDBDatabase, storeName: string, items: T[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = tx(db, storeName, 'readwrite')
    const store = t.objectStore(storeName)
    for (const item of items) store.put(item)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

export async function getCachedBooks(): Promise<CachedBook[]> {
  const db = await openDb()
  const all = await getAllFromStore<CachedBook>(db, 'books')
  return all.filter(b => !b.deleted_at)
}

export async function upsertCachedBooks(books: CachedBook[]): Promise<void> {
  if (books.length === 0) return
  const db = await openDb()
  await putAllToStore(db, 'books', books)
}

// ---------------------------------------------------------------------------
// Wishlist
// ---------------------------------------------------------------------------

export async function getCachedWishlist(): Promise<CachedWishlistItem[]> {
  const db = await openDb()
  const all = await getAllFromStore<CachedWishlistItem>(db, 'wishlist')
  return all.filter(w => !w.deleted_at)
}

export async function upsertCachedWishlist(items: CachedWishlistItem[]): Promise<void> {
  if (items.length === 0) return
  const db = await openDb()
  await putAllToStore(db, 'wishlist', items)
}

// ---------------------------------------------------------------------------
// Reading states
// ---------------------------------------------------------------------------

export async function getCachedReadingStates(profileId?: string | null): Promise<CachedReadingState[]> {
  const db = await openDb()
  const all = await getAllFromStore<CachedReadingState>(db, 'reading_states')
  if (profileId === undefined) return all   // caller wants everything (e.g. sync)
  return all.filter(r => r.profile_id === (profileId ?? null))
}

export async function upsertCachedReadingStates(states: CachedReadingState[]): Promise<void> {
  if (states.length === 0) return
  const db = await openDb()
  await putAllToStore(db, 'reading_states', states)
}

// ---------------------------------------------------------------------------
// Sync cursors (stored in 'meta' store)
// ---------------------------------------------------------------------------

const CURSOR_KEY = 'sync_cursors'

const emptyCursors: SyncCursors = { books: '', wishlist: '', readingStates: '' }

export async function getSyncCursors(): Promise<SyncCursors> {
  const db = await openDb()
  const row = await promisifyRequest<{ key: string; value: SyncCursors } | undefined>(
    tx(db, 'meta', 'readonly').objectStore('meta').get(CURSOR_KEY)
  )
  return row?.value ?? { ...emptyCursors }
}

export async function setSyncCursors(cursors: SyncCursors): Promise<void> {
  const db = await openDb()
  await promisifyRequest(
    tx(db, 'meta', 'readwrite').objectStore('meta').put({ key: CURSOR_KEY, value: cursors })
  )
}

// ---------------------------------------------------------------------------
// Clear all (used on logout)
// ---------------------------------------------------------------------------

export async function clearCache(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const t = tx(db, ['books', 'wishlist', 'reading_states', 'meta'], 'readwrite')
    t.objectStore('books').clear()
    t.objectStore('wishlist').clear()
    t.objectStore('reading_states').clear()
    t.objectStore('meta').clear()
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}
