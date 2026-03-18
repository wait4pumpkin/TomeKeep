import { app, ipcMain } from 'electron'
import path from 'node:path'
import { JSONFilePreset } from 'lowdb/node'

export interface Book {
  id: string
  title: string
  author: string
  isbn?: string
  publisher?: string
  status: 'unread' | 'reading' | 'read'
  rating?: number
  coverUrl?: string
  addedAt: string
}

export interface WishlistItem {
  id: string
  title: string
  author: string
  isbn?: string
  priority: 'high' | 'medium' | 'low'
  addedAt: string
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
}

const defaultData: DatabaseSchema = { books: [], wishlist: [], priceCache: {} }

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
  dbInstance = db

  // Register IPC handlers
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
      await db.write()
      return true
    }
    return false
  })

  // Wishlist handlers
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
}
