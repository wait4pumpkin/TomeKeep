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
  }
}
