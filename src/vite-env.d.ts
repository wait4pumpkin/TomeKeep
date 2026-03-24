/// <reference types="vite/client" />

interface Window {
  ipcRenderer: import('electron').IpcRenderer
  db: {
    getBooks: () => Promise<import('../electron/db').Book[]>
    addBook: (book: import('../electron/db').Book) => Promise<import('../electron/db').Book>
    updateBook: (book: import('../electron/db').Book) => Promise<import('../electron/db').Book | null>
    deleteBook: (id: string) => Promise<boolean>
    getWishlist: () => Promise<import('../electron/db').WishlistItem[]>
    addWishlistItem: (item: import('../electron/db').WishlistItem) => Promise<import('../electron/db').WishlistItem>
    updateWishlistItem: (item: import('../electron/db').WishlistItem) => Promise<import('../electron/db').WishlistItem | null>
    deleteWishlistItem: (id: string) => Promise<boolean>
    getAllTags: () => Promise<string[]>
    // User management
    getUsers: () => Promise<import('../electron/db').UserProfile[]>
    addUser: (name: string) => Promise<import('../electron/db').UserProfile>
    renameUser: (id: string, name: string) => Promise<import('../electron/db').UserProfile | null>
    deleteUser: (id: string) => Promise<boolean>
    getActiveUser: () => Promise<import('../electron/db').UserProfile | null>
    setActiveUser: (id: string) => Promise<import('../electron/db').UserProfile | null>
    // Per-user reading state
    getReadingStates: (userId: string) => Promise<import('../electron/db').ReadingState[]>
    setReadingState: (state: import('../electron/db').ReadingState) => Promise<import('../electron/db').ReadingState>
  }
  meta: {
    lookupIsbn: (isbn13: string) => Promise<
      | { ok: true; value: import('./lib/openLibrary').BookMetadata }
      | { ok: false; error: 'invalid_isbn' | 'not_found' | 'timeout' | 'network' | 'bad_response' }
    >
    lookupIsbnSearch: (isbn13: string) => Promise<
      | { ok: true; value: import('./lib/openLibrary').BookMetadata }
      | { ok: false; error: 'invalid_isbn' | 'not_found' | 'timeout' | 'network' | 'bad_response' }
    >
    lookupDouban: (input: string) => Promise<
      | { ok: true; value: import('./lib/openLibrary').BookMetadata }
      | { ok: false; error: 'invalid_url' | 'not_found' | 'timeout' | 'network' | 'bad_response' }
    >
    searchDouban: (query: string) => Promise<
      | { ok: true; value: import('../electron/metadata').DoubanSearchHit[] }
      | { ok: false; error: 'timeout' | 'network' | 'bad_response' }
    >
  }
  pricing: {
    get: (keys: string[]) => Promise<Record<string, import('../electron/db').PriceCacheEntry>>
    openCapture: (
      input: import('../electron/pricing').PricingInput & { channel: import('../electron/pricing').CaptureChannel },
    ) => Promise<import('../electron/pricing').OpenCaptureResult>
  }
  stores: {
    openLogin: (channel: import('../electron/stores').StoreChannel) => Promise<boolean>
    openPage: (url: string) => Promise<{ ok: true } | { ok: false; error: 'invalid_url' | 'not_allowed' }>
    getStatus: (channel: import('../electron/stores').StoreChannel) => Promise<{ ok: true; loggedIn: boolean }>
    clearCookies: (channel: import('../electron/stores').StoreChannel) => Promise<{ ok: true }>
  }
  app: {
    openExternal: (url: string) => Promise<{ ok: true } | { ok: false; error: 'invalid_url' }>
  }
  covers: {
    /**
     * Download a remote cover image and persist it to userData/covers/<id>.jpg.
     * Returns an app:// URL for the saved file, or the original URL on failure.
     */
    saveCover: (id: string, url: string) => Promise<string>
    /**
     * Save a cover from a base64 data URL (from a local file picker).
     * Returns an app:// URL for the saved file, or null on failure.
     */
    saveCoverData: (id: string, dataUrl: string) => Promise<string | null>
  }
  companion: {
    /** Start the HTTPS companion server. Returns the LAN URL (with token) to share with the phone. */
    start: () => Promise<
      | { ok: true; url: string; token: string }
      | { ok: false; error: string }
    >
    /** Stop the companion server and invalidate the current session token. */
    stop: () => Promise<void>
    /** Returns current server status. */
    status: () => Promise<
      | { running: true; url: string }
      | { running: false }
    >
    /**
     * Register a callback invoked whenever the phone scanner sends an ISBN.
     * Returns a dispose function that removes the listener.
     */
    onIsbnReceived: (cb: (isbn: string) => void) => () => void
    /** Send scan result acknowledgement back to the phone (displayed on phone UI). */
    sendScanAck: (isbn: string, hasMetadata: boolean, title?: string) => void
  }
}
