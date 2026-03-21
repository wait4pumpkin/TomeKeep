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
    deleteWishlistItem: (id: string) => Promise<boolean>
  }
  meta: {
    lookupIsbn: (isbn13: string) => Promise<
      | { ok: true; value: import('./lib/openLibrary').BookMetadata }
      | { ok: false; error: 'invalid_isbn' | 'not_found' | 'timeout' | 'network' | 'bad_response' }
    >
    lookupDouban: (input: string) => Promise<
      | { ok: true; value: import('./lib/openLibrary').BookMetadata }
      | { ok: false; error: 'invalid_url' | 'not_found' | 'timeout' | 'network' | 'bad_response' }
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
}
