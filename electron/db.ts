import { app, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
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

export interface DatabaseSchema {
  books: Book[]
  wishlist: WishlistItem[]
}

const defaultData: DatabaseSchema = { books: [], wishlist: [] }

export async function setupDatabase() {
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'db.json')
  
  console.log('Database path:', dbPath)

  const db = await JSONFilePreset<DatabaseSchema>(dbPath, defaultData)

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
