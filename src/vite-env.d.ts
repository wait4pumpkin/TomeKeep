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
    setUserLanguage: (id: string, language: 'zh' | 'en') => Promise<import('../electron/db').UserProfile | null>
    // Per-user reading state
    getReadingStates: (userId: string) => Promise<import('../electron/db').ReadingState[]>
    setReadingState: (state: import('../electron/db').ReadingState) => Promise<import('../electron/db').ReadingState>
    // Per-user UI preferences
    getUiPrefs: (userId: string) => Promise<import('../electron/db').UIPreferences | null>
    setUiPrefs: (userId: string, patch: Partial<import('../electron/db').UIPreferences>) => Promise<import('../electron/db').UIPreferences | null>
  }
  meta: {
    lookupIsbn: (isbn13: string) => Promise<
      | { ok: true; value: import('./lib/openLibrary').BookMetadata }
      | { ok: false; error: 'invalid_isbn' | 'not_found' | 'timeout' | 'network' | 'bad_response' }
    >
    lookupIsbnSearch: (isbn13: string) => Promise<
      | { ok: true; value: import('./lib/openLibrary').BookMetadata }
      | { ok: false; error: 'invalid_isbn' | 'not_found' | 'timeout' | 'network' | 'bad_response' | 'captcha' }
    >
    lookupDouban: (input: string) => Promise<
      | { ok: true; value: import('./lib/openLibrary').BookMetadata }
      | { ok: false; error: 'invalid_url' | 'not_found' | 'timeout' | 'network' | 'bad_response' | 'captcha' }
    >
    searchDouban: (query: string) => Promise<
      | { ok: true; value: import('../electron/metadata').DoubanSearchHit[] }
      | { ok: false; error: 'timeout' | 'network' | 'bad_response' }
    >
    /**
     * Unified waterfall: Douban → OpenLibrary → isbnsearch.
     * Returns the first successful result with source info.
     * Returns { ok: false, error: 'captcha' } when isbnsearch triggers a captcha
     * — call resolveCaptcha() to let the user solve it, then retry if needed.
     */
    lookupWaterfall: (isbn13: string) => Promise<
      | { ok: true; value: import('./lib/openLibrary').BookMetadata; source: 'douban' | 'openlibrary' | 'isbnsearch'; detailUrl?: string }
      | { ok: false; error: 'not_found' | 'captcha' }
    >
    /**
     * Open a small modal window pointing at isbnsearch.org so the user can
     * solve a captcha. Resolves once the book page loads successfully, or
     * with not_found if the user closes the window without solving.
     */
    resolveCaptcha: (isbn13: string) => Promise<
      | { ok: true; value: import('./lib/openLibrary').BookMetadata }
      | { ok: false; error: 'not_found' }
    >
    /** Open a Douban login window; cookies persist in the Electron session so future fetches bypass bot-detection. */
    loginDouban: () => Promise<{ ok: true } | { ok: false; error: string }>
    /** Check whether the persisted Douban session has a valid login cookie. */
    doubanStatus: () => Promise<{ loggedIn: boolean }>
  }
  pricing: {
    get: (keys: string[]) => Promise<Record<string, import('../electron/db').PriceCacheEntry>>
    openCapture: (
      input: import('../electron/pricing').PricingInput & { channel: import('../electron/pricing').CaptureChannel },
    ) => Promise<import('../electron/pricing').OpenCaptureResult>
    /** Trigger headless auto-capture for all three channels concurrently. */
    autoCaptureAll: (input: import('../electron/pricing').PricingInput) => Promise<void>
    /** Trigger headless auto-capture for a single channel. */
    autoCaptureChannel: (input: import('../electron/pricing').PricingInput, channel: import('../electron/pricing').CaptureChannel) => Promise<void>
    /** Remove the 'manual' source flag from a quote without re-fetching. */
    removeManualFlag: (key: string, channel: import('../electron/pricing').CaptureChannel) => Promise<void>
    /** Re-fetch the product page for a manually-captured channel, keeping source='manual'. */
    refreshManualChannel: (input: import('../electron/pricing').PricingInput, channel: import('../electron/pricing').CaptureChannel) => Promise<void>
    /**
     * Subscribe to per-channel auto-capture progress events pushed from main.
     * Returns a dispose function that removes the listener.
     */
    onAutoProgress: (cb: (event: import('../electron/pricing').AutoCaptureProgressEvent) => void) => () => void
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
    saveCover: (id: string, url: string) => Promise<string | undefined>
    /**
     * Save a cover from a base64 data URL (from a local file picker).
     * Returns an app:// URL for the saved file, or null on failure.
     */
    saveCoverData: (id: string, dataUrl: string) => Promise<string | null>
    /**
     * Check whether the local cover file for a given app:// URL exists on disk.
     * Used at startup to detect covers referenced in the DB but never written.
     */
    coverExists: (appUrl: string) => Promise<boolean>
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
    /**
     * Register a callback invoked when the phone requests deletion of a failed scan entry.
     * Returns a dispose function that removes the listener.
     */
    onDeleteEntryReceived: (cb: (isbn: string) => void) => () => void
    /**
     * Register a callback invoked when the phone sends a captured cover photo.
     * Returns a dispose function that removes the listener.
     */
    onCoverReceived: (cb: (payload: { dataUrl: string; session: string }) => void) => () => void
  }
}
