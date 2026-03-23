import { ipcRenderer, contextBridge } from 'electron'
import type { Book, WishlistItem, UserProfile, ReadingState } from './db'
import type { StoreChannel } from './stores'

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
  updateWishlistItem: (item: WishlistItem) => ipcRenderer.invoke('db:update-wishlist-item', item) as Promise<WishlistItem | null>,
  deleteWishlistItem: (id: string) => ipcRenderer.invoke('db:delete-wishlist-item', id),
  getAllTags: () => ipcRenderer.invoke('db:get-all-tags') as Promise<string[]>,
  // User management
  getUsers: () => ipcRenderer.invoke('db:get-users') as Promise<UserProfile[]>,
  addUser: (name: string) => ipcRenderer.invoke('db:add-user', name) as Promise<UserProfile>,
  renameUser: (id: string, name: string) => ipcRenderer.invoke('db:rename-user', id, name) as Promise<UserProfile | null>,
  deleteUser: (id: string) => ipcRenderer.invoke('db:delete-user', id) as Promise<boolean>,
  getActiveUser: () => ipcRenderer.invoke('db:get-active-user') as Promise<UserProfile | null>,
  setActiveUser: (id: string) => ipcRenderer.invoke('db:set-active-user', id) as Promise<UserProfile | null>,
  // Per-user reading state
  getReadingStates: (userId: string) => ipcRenderer.invoke('db:get-reading-states', userId) as Promise<ReadingState[]>,
  setReadingState: (state: ReadingState) => ipcRenderer.invoke('db:set-reading-state', state) as Promise<ReadingState>,
})

contextBridge.exposeInMainWorld('meta', {
  lookupIsbn: (isbn13: string) => ipcRenderer.invoke('meta:lookup-isbn', isbn13),
  lookupDouban: (input: string) => ipcRenderer.invoke('meta:lookup-douban', input),
  searchDouban: (query: string) => ipcRenderer.invoke('meta:search-douban', query),
})

contextBridge.exposeInMainWorld('pricing', {
  get: (keys: string[]) => ipcRenderer.invoke('pricing:get', keys),
  openCapture: (input: import('./pricing').PricingInput & { channel: import('./pricing').CaptureChannel }) =>
    ipcRenderer.invoke('pricing:open-capture', input),
})

contextBridge.exposeInMainWorld('stores', {
  openLogin: (channel: StoreChannel) => ipcRenderer.invoke('stores:open-login', channel),
  openPage: (url: string) => ipcRenderer.invoke('stores:open-page', url),
  getStatus: (channel: StoreChannel) => ipcRenderer.invoke('stores:get-status', channel),
  clearCookies: (channel: StoreChannel) => ipcRenderer.invoke('stores:clear-cookies', channel),
})

contextBridge.exposeInMainWorld('app', {
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
})

contextBridge.exposeInMainWorld('covers', {
  saveCover: (id: string, url: string) =>
    ipcRenderer.invoke('covers:save-cover', { id, url }) as Promise<string>,
})

contextBridge.exposeInMainWorld('companion', {
  start: () => ipcRenderer.invoke('companion:start'),
  stop: () => ipcRenderer.invoke('companion:stop'),
  status: () => ipcRenderer.invoke('companion:status'),
  /**
   * Register a callback for ISBNs received from the phone scanner.
   * Returns a dispose function that removes the listener.
   */
  onIsbnReceived: (cb: (isbn: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isbn: string) => cb(isbn)
    ipcRenderer.on('companion:isbn-received', listener)
    return () => ipcRenderer.off('companion:isbn-received', listener)
  },
  /** Notify the phone (via SSE) whether the scanned ISBN was saved with metadata. */
  sendScanAck: (isbn: string, hasMetadata: boolean, title?: string) => {
    ipcRenderer.send('companion:scan-ack', { isbn, hasMetadata, title })
  },
})
