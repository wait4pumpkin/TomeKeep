// src/lib/sync.ts
// Smart sync logic for the PWA.
//
// Sync is triggered on:
//   1. App initial load
//   2. visibilitychange (coming from background)
//   3. Manual pull-to-refresh
//
// Strategy: LWW (Last-Write-Wins) based on server-side updated_at.
// Steps:
//   1. GET /api/sync/status  — check latest updated_at per table
//   2. Compare with local cursors
//   3. If ahead: GET /api/{table}?since={cursor}  — incremental pull
//   4. Merge into IndexedDB cache
//   5. Update cursors

import { api } from './api.ts'
import {
  getSyncCursors,
  setSyncCursors,
  upsertCachedBooks,
  upsertCachedWishlist,
  upsertCachedReadingStates,
  type CachedBook,
  type CachedWishlistItem,
  type CachedReadingState,
} from './db-cache.ts'

interface SyncStatus {
  books: string
  wishlist: string
  readingStates: string
}

export type SyncState = 'idle' | 'syncing' | 'error'

let _syncing = false

/**
 * Run a full incremental sync cycle.
 * Returns true if any data was updated.
 */
export async function runSync(): Promise<boolean> {
  if (_syncing) return false
  _syncing = true

  try {
    const [status, cursors] = await Promise.all([
      api.get<SyncStatus>('/sync/status'),
      getSyncCursors(),
    ])

    let updated = false

    // Books
    if (!cursors.books || status.books > cursors.books) {
      const since = cursors.books ? `?since=${encodeURIComponent(cursors.books)}` : ''
      const books = await api.get<CachedBook[]>(`/books${since}`)
      if (books.length > 0) {
        await upsertCachedBooks(books)
        updated = true
      }
      cursors.books = status.books
    }

    // Wishlist
    if (!cursors.wishlist || status.wishlist > cursors.wishlist) {
      const since = cursors.wishlist ? `?since=${encodeURIComponent(cursors.wishlist)}` : ''
      const items = await api.get<CachedWishlistItem[]>(`/wishlist${since}`)
      if (items.length > 0) {
        await upsertCachedWishlist(items)
        updated = true
      }
      cursors.wishlist = status.wishlist
    }

    // Reading states — fetch all profiles at once (no profile_id filter; server returns all)
    if (!cursors.readingStates || status.readingStates > cursors.readingStates) {
      const since = cursors.readingStates ? `?since=${encodeURIComponent(cursors.readingStates)}` : ''
      const states = await api.get<CachedReadingState[]>(`/reading-states${since}`)
      if (states.length > 0) {
        await upsertCachedReadingStates(states)
        updated = true
      }
      cursors.readingStates = status.readingStates
    }

    await setSyncCursors(cursors)
    return updated
  } finally {
    _syncing = false
  }
}

/**
 * Push a single reading-state change to the server.
 * profile_id null → owner's default (legacy) row.
 */
export async function pushReadingState(
  bookId: string,
  status: string,
  profileId: string | null,
): Promise<CachedReadingState> {
  return api.put<CachedReadingState>('/reading-states', {
    book_id: bookId,
    status,
    profile_id: profileId,
  })
}

/**
 * Hook-friendly sync manager.
 * Call `useSyncManager` in a top-level component to enable background sync.
 */
export function setupVisibilitySyncListener(onSync: () => void): () => void {
  function handler() {
    if (document.visibilityState === 'visible') {
      void runSync().then(updated => { if (updated) onSync() })
    }
  }
  document.addEventListener('visibilitychange', handler)
  return () => document.removeEventListener('visibilitychange', handler)
}
