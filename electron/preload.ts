import { ipcRenderer, contextBridge } from 'electron'
import type { Book, WishlistItem } from './db'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

contextBridge.exposeInMainWorld('db', {
  getBooks: () => ipcRenderer.invoke('db:get-books') as Promise<Book[]>,
  addBook: (book: Book) => ipcRenderer.invoke('db:add-book', book) as Promise<Book>,
  updateBook: (book: Book) => ipcRenderer.invoke('db:update-book', book) as Promise<Book | null>,
  deleteBook: (id: string) => ipcRenderer.invoke('db:delete-book', id),
  getWishlist: () => ipcRenderer.invoke('db:get-wishlist') as Promise<WishlistItem[]>,
  addWishlistItem: (item: WishlistItem) => ipcRenderer.invoke('db:add-wishlist-item', item) as Promise<WishlistItem>,
  deleteWishlistItem: (id: string) => ipcRenderer.invoke('db:delete-wishlist-item', id),
})

contextBridge.exposeInMainWorld('meta', {
  lookupIsbn: (isbn13: string) => ipcRenderer.invoke('meta:lookup-isbn', isbn13),
  lookupDouban: (input: string) => ipcRenderer.invoke('meta:lookup-douban', input),
})
