import { ipcRenderer, contextBridge } from 'electron'
import type { Book, WishlistItem, UserProfile, ReadingState, UIPreferences } from './db'
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
  setUserLanguage: (id: string, language: 'zh' | 'en') => ipcRenderer.invoke('db:set-user-language', id, language) as Promise<UserProfile | null>,
  // Per-user reading state
  getReadingStates: (userId: string) => ipcRenderer.invoke('db:get-reading-states', userId) as Promise<ReadingState[]>,
  setReadingState: (state: ReadingState) => ipcRenderer.invoke('db:set-reading-state', state) as Promise<ReadingState>,
  // Per-user UI preferences
  getUiPrefs: (userId: string) => ipcRenderer.invoke('db:get-ui-prefs', userId) as Promise<UIPreferences | null>,
  setUiPrefs: (userId: string, patch: Partial<UIPreferences>) => ipcRenderer.invoke('db:set-ui-prefs', userId, patch) as Promise<UIPreferences | null>,
})

contextBridge.exposeInMainWorld('meta', {
  lookupIsbn: (isbn13: string) => ipcRenderer.invoke('meta:lookup-isbn', isbn13),
  lookupIsbnSearch: (isbn13: string) => ipcRenderer.invoke('meta:lookup-isbnsearch', isbn13),
  lookupDouban: (input: string) => ipcRenderer.invoke('meta:lookup-douban', input),
  searchDouban: (query: string) => ipcRenderer.invoke('meta:search-douban', query),
  /** Unified waterfall: Douban → OpenLibrary → isbnsearch (with cookie persistence). */
  lookupWaterfall: (isbn13: string) => ipcRenderer.invoke('meta:lookup-isbn-waterfall', isbn13),
  /** Open a small modal window so the user can solve an isbnsearch captcha. */
  resolveCaptcha: (isbn13: string) => ipcRenderer.invoke('meta:resolve-captcha', isbn13),
  /** Open a Douban login window so the user can authenticate once; cookies persist for future fetches. */
  loginDouban: () => ipcRenderer.invoke('meta:login-douban') as Promise<{ ok: true } | { ok: false; error: string }>,
  /** Check whether the user is currently logged in to Douban (based on persisted session cookies). */
  doubanStatus: () => ipcRenderer.invoke('meta:douban-status') as Promise<{ loggedIn: boolean }>,
})

contextBridge.exposeInMainWorld('pricing', {
  get: (keys: string[]) => ipcRenderer.invoke('pricing:get', keys),
  openCapture: (input: import('./pricing').PricingInput & { channel: import('./pricing').CaptureChannel }) =>
    ipcRenderer.invoke('pricing:open-capture', input),
  /** Trigger automated headless price capture for all three channels. */
  autoCaptureAll: (input: import('./pricing').PricingInput) =>
    ipcRenderer.invoke('pricing:auto-capture-all', input) as Promise<void>,
  /** Trigger automated headless price capture for a single channel. */
  autoCaptureChannel: (input: import('./pricing').PricingInput, channel: import('./pricing').CaptureChannel) =>
    ipcRenderer.invoke('pricing:auto-capture-channel', input, channel) as Promise<void>,
  /** Remove the 'manual' flag from a quote (sets source to 'auto') without re-fetching. */
  removeManualFlag: (key: string, channel: import('./pricing').CaptureChannel) =>
    ipcRenderer.invoke('pricing:remove-manual-flag', key, channel) as Promise<void>,
  /** Re-fetch the product page for a manually-captured channel, keeping source='manual'. */
  refreshManualChannel: (input: import('./pricing').PricingInput, channel: import('./pricing').CaptureChannel) =>
    ipcRenderer.invoke('pricing:refresh-manual-channel', input, channel) as Promise<void>,
  /**
   * Subscribe to auto-capture progress events pushed from the main process.
   * Returns a dispose function that removes the listener.
   */
  onAutoProgress: (cb: (event: import('./pricing').AutoCaptureProgressEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: import('./pricing').AutoCaptureProgressEvent) => cb(ev)
    ipcRenderer.on('pricing:auto-progress', listener)
    return () => ipcRenderer.off('pricing:auto-progress', listener)
  },
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
    ipcRenderer.invoke('covers:save-cover', { id, url }) as Promise<string | undefined>,
  saveCoverData: (id: string, dataUrl: string) =>
    ipcRenderer.invoke('covers:save-cover-data', { id, dataUrl }) as Promise<string | null>,
  coverExists: (appUrl: string) =>
    ipcRenderer.invoke('covers:cover-exists', appUrl) as Promise<boolean>,
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
  /**
   * Register a callback invoked when the phone requests deletion of a failed scan entry.
   * Returns a dispose function that removes the listener.
   */
  onDeleteEntryReceived: (cb: (isbn: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isbn: string) => cb(isbn)
    ipcRenderer.on('companion:delete-entry', listener)
    return () => ipcRenderer.off('companion:delete-entry', listener)
  },
  /**
   * Register a callback for cover photos received from the phone.
   * Payload: { dataUrl: string (JPEG data URL), session: string }
   * Returns a dispose function that removes the listener.
   */
  onCoverReceived: (cb: (payload: { dataUrl: string; session: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { dataUrl: string; session: string }) => cb(payload)
    ipcRenderer.on('companion:cover-received', listener)
    return () => ipcRenderer.off('companion:cover-received', listener)
  },
})

contextBridge.exposeInMainWorld('sync', {
  login: (username: string, password: string) =>
    ipcRenderer.invoke('sync:login', { username, password }) as Promise<{ ok: true } | { ok: false; error: string }>,
  logout: () =>
    ipcRenderer.invoke('sync:logout') as Promise<{ ok: true }>,
  getStatus: () =>
    ipcRenderer.invoke('sync:status') as Promise<{ loggedIn: boolean; lastSyncAt: string | null }>,
  pull: () =>
    ipcRenderer.invoke('sync:pull') as Promise<{ updated: boolean; error?: string }>,
  pushPending: () =>
    ipcRenderer.invoke('sync:push-pending') as Promise<{ ok: true }>,
  migrate: () =>
    ipcRenderer.invoke('sync:migrate') as Promise<
      { ok: true; books: number; wishlist: number; readingStates: number; covers: number; skipped: number } |
      { ok: false; error: string; books: number; wishlist: number; readingStates: number; covers: number; skipped: number }
    >,
  onMigrateProgress: (cb: (p: import('./sync').MigrateProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: import('./sync').MigrateProgress) => cb(p)
    ipcRenderer.on('sync:migrate-progress', listener)
    return () => ipcRenderer.off('sync:migrate-progress', listener)
  },
  onTokenCleared: (cb: () => void): (() => void) => {
    const listener = () => cb()
    ipcRenderer.on('sync:token-cleared', listener)
    return () => ipcRenderer.off('sync:token-cleared', listener)
  },
})
