// src/lib/data-context.tsx
// Shared data layer for books and wishlist.
//
// DataProvider lives inside Layout, so it persists across Inventory ↔ Wishlist
// tab switches.  Both pages read data from context and get instant renders
// (no IndexedDB round-trip on every mount → no skeleton flash).

import { createContext, useContext, useState, useEffect, useCallback, useTransition } from 'react'
import {
  getCachedBooks,
  getCachedReadingStates,
  getCachedWishlist,
  type CachedBook,
  type CachedReadingState,
  type CachedWishlistItem,
} from './db-cache.ts'
import { getActiveProfile } from './profiles.ts'

// ---------------------------------------------------------------------------
// Books context
// ---------------------------------------------------------------------------

export interface BooksContextValue {
  books: CachedBook[]
  stateMap: Map<string, CachedReadingState>
  loading: boolean
  activeProfileId: string | null
  setBooks: React.Dispatch<React.SetStateAction<CachedBook[]>>
  setStateMap: React.Dispatch<React.SetStateAction<Map<string, CachedReadingState>>>
  setActiveProfileId: React.Dispatch<React.SetStateAction<string | null>>
  reload: (background?: boolean) => Promise<void>
}

// ---------------------------------------------------------------------------
// Wishlist context
// ---------------------------------------------------------------------------

export interface WishlistContextValue {
  items: CachedWishlistItem[]
  loading: boolean
  setItems: React.Dispatch<React.SetStateAction<CachedWishlistItem[]>>
  reload: (background?: boolean) => Promise<void>
}

// ---------------------------------------------------------------------------
// Context objects
// ---------------------------------------------------------------------------

const BooksContext = createContext<BooksContextValue>(null!)
const WishlistContext = createContext<WishlistContextValue>(null!)

export function useBooksContext(): BooksContextValue {
  return useContext(BooksContext)
}

export function useWishlistContext(): WishlistContextValue {
  return useContext(WishlistContext)
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [, startTransition] = useTransition()

  // Books + reading states
  const [books, setBooks] = useState<CachedBook[]>([])
  const [stateMap, setStateMap] = useState<Map<string, CachedReadingState>>(new Map())
  const [booksLoading, setBooksLoading] = useState(true)
  const [activeProfileId, setActiveProfileId] = useState<string | null>(
    () => getActiveProfile()?.id ?? null,
  )

  // Wishlist
  const [items, setItems] = useState<CachedWishlistItem[]>([])
  const [wishlistLoading, setWishlistLoading] = useState(true)

  // ---------------------------------------------------------------------------
  // Reload helpers
  // ---------------------------------------------------------------------------

  const reloadBooks = useCallback(async (background = false) => {
    const profileId = getActiveProfile()?.id ?? null
    const [bs, allStates] = await Promise.all([
      getCachedBooks(),
      getCachedReadingStates(undefined),
    ])
    const map = new Map<string, CachedReadingState>()
    // null-profile rows (desktop-written) serve as a baseline
    for (const r of allStates) {
      if (r.profile_id === null) map.set(r.book_id, r)
    }
    // Profile-specific rows take precedence
    if (profileId !== null) {
      for (const r of allStates) {
        if (r.profile_id === profileId) map.set(r.book_id, r)
      }
    }
    if (background) {
      startTransition(() => { setBooks(bs); setStateMap(map) })
    } else {
      setBooks(bs)
      setStateMap(map)
    }
  }, [startTransition])

  const reloadWishlist = useCallback(async (background = false) => {
    const ws = await getCachedWishlist()
    if (background) {
      startTransition(() => setItems(ws))
    } else {
      setItems(ws)
    }
  }, [startTransition])

  // ---------------------------------------------------------------------------
  // Initial load (runs once when Layout mounts)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setBooksLoading(true)
    reloadBooks().finally(() => setBooksLoading(false))
  }, [reloadBooks])

  useEffect(() => {
    setWishlistLoading(true)
    reloadWishlist().finally(() => setWishlistLoading(false))
  }, [reloadWishlist])

  // ---------------------------------------------------------------------------
  // Reload on background sync
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function onSync() {
      void reloadBooks(true)
      void reloadWishlist(true)
    }
    window.addEventListener('tomekeep:sync', onSync)
    return () => window.removeEventListener('tomekeep:sync', onSync)
  }, [reloadBooks, reloadWishlist])

  // ---------------------------------------------------------------------------
  // Reload on active profile change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function onProfile() {
      setActiveProfileId(getActiveProfile()?.id ?? null)
      void reloadBooks()
    }
    window.addEventListener('tomekeep:profile', onProfile)
    return () => window.removeEventListener('tomekeep:profile', onProfile)
  }, [reloadBooks])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <BooksContext.Provider value={{
      books, stateMap, loading: booksLoading, activeProfileId,
      setBooks, setStateMap, setActiveProfileId,
      reload: reloadBooks,
    }}>
      <WishlistContext.Provider value={{
        items, loading: wishlistLoading,
        setItems, reload: reloadWishlist,
      }}>
        {children}
      </WishlistContext.Provider>
    </BooksContext.Provider>
  )
}
