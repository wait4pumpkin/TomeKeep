// src/pages/Wishlist.tsx
// PWA wishlist page.
// Reads from IndexedDB cache; writes go through the API and refresh the cache.

import { useState, useEffect, useCallback, useTransition, useRef, useMemo } from 'react'
import { useLang, type DictKey } from '../lib/i18n.tsx'
import { api, coverUrl } from '../lib/api.ts'
import { useSyncState } from '../lib/sync-context.ts'
import {
  getCachedWishlist,
  upsertCachedWishlist,
  upsertCachedBooks,
  type CachedWishlistItem,
  type CachedBook,
} from '../lib/db-cache.ts'
import { AddFormCard } from '../components/AddFormCard.tsx'
import { PullToRefresh } from '../components/PullToRefresh.tsx'
import { runSync } from '../lib/sync.ts'
import { tagColor } from '@tomekeep/shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WishFilter = 'all' | 'pending'
type WishSort = 'title' | 'author' | 'added'
type ViewMode = 'detail' | 'compact'

const VIEW_MODE_KEY = 'tk_wl_view'
const COMPACT_COLS_KEY = 'tk_wl_cols'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortWishlist(items: CachedWishlistItem[], key: WishSort, dir: 'asc' | 'desc'): CachedWishlistItem[] {
  return [...items].sort((a, b) => {
    let cmp = 0
    if (key === 'title') {
      cmp = a.title.localeCompare(b.title)
    } else if (key === 'author') {
      cmp = (a.author ?? '').localeCompare(b.author ?? '')
    } else {
      // 'added'
      cmp = a.added_at.localeCompare(b.added_at)
    }
    return dir === 'asc' ? cmp : -cmp
  })
}

function filterWishlist(
  items: CachedWishlistItem[],
  filter: WishFilter,
  query: string,
  tagFilter: string[],
): CachedWishlistItem[] {
  const q = query.trim().toLowerCase()
  return items.filter(item => {
    if (filter === 'pending' && !item.pending_buy) return false
    if (tagFilter.length > 0 && !tagFilter.every(t => {
      if (t === '__untagged__') return item.tags.length === 0
      return item.tags.includes(t)
    })) return false
    if (q) {
      const haystack = [item.title, item.author, item.isbn ?? '']
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Wishlist() {
  const { t } = useLang()
  const { syncing } = useSyncState()

  const [items, setItems] = useState<CachedWishlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [, startTransition] = useTransition()

  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null) ?? 'detail'
  )
  const [compactCols, setCompactCols] = useState<2 | 3 | 4 | 5 | 6>(
    () => (Number(localStorage.getItem(COMPACT_COLS_KEY)) as 2 | 3 | 4 | 5 | 6) || 2
  )

  const [query, setQuery] = useState('')
  const [showSearchModal, setShowSearchModal] = useState(false)
  const [filter, setFilter] = useState<WishFilter>('all')
  const [sort, setSort] = useState<WishSort>('added')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [tagFilter, setTagFilter] = useState<string[]>([])

  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState<CachedWishlistItem | null>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)

  // Collapsed header when scrolled away from top
  const [collapsed, setCollapsed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let el: HTMLElement | null = scrollRef.current?.parentElement ?? null
    while (el && getComputedStyle(el).overflowY === 'visible') el = el.parentElement
    if (!el) return
    const scroller = el
    function onScroll() { setCollapsed(scroller.scrollTop > 8) }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  // ---------------------------------------------------------------------------
  // Load from cache
  // ---------------------------------------------------------------------------

  const loadFromCache = useCallback(async (background = false) => {
    const ws = await getCachedWishlist()
    if (background) {
      startTransition(() => setItems(ws))
    } else {
      setItems(ws)
    }
  }, [startTransition])

  useEffect(() => {
    setLoading(true)
    loadFromCache().finally(() => setLoading(false))
  }, [loadFromCache])

  // Reload from cache whenever a background sync writes new data
  useEffect(() => {
    function onSync() { void loadFromCache(true) }
    window.addEventListener('tomekeep:sync', onSync)
    return () => window.removeEventListener('tomekeep:sync', onSync)
  }, [loadFromCache])

  // ---------------------------------------------------------------------------
  // Pull-to-refresh
  // ---------------------------------------------------------------------------

  const handleRefresh = useCallback(async () => {
    await runSync()
    await loadFromCache()
  }, [loadFromCache])

  // ---------------------------------------------------------------------------
  // Toggle pending_buy
  // ---------------------------------------------------------------------------

  async function handleTogglePending(item: CachedWishlistItem) {
    const next = !item.pending_buy
    const optimistic: CachedWishlistItem = {
      ...item,
      pending_buy: next,
      updated_at: new Date().toISOString(),
    }
    setItems(prev => prev.map(w => (w.id === item.id ? optimistic : w)))

    try {
      const updated = await api.put<CachedWishlistItem>(`/wishlist/${item.id}`, {
        pending_buy: next,
      })
      await upsertCachedWishlist([updated])
      setItems(prev => prev.map(w => (w.id === updated.id ? updated : w)))
    } catch {
      // Roll back
      setItems(prev => prev.map(w => (w.id === item.id ? item : w)))
    }
  }

  // ---------------------------------------------------------------------------
  // Move to inventory
  // ---------------------------------------------------------------------------

  async function handleMoveToInventory(item: CachedWishlistItem) {
    setMovingId(item.id)
    try {
      const book = await api.post<CachedBook>(`/wishlist/${item.id}/move-to-inventory`, {})
      // Write the new book into the inventory cache immediately
      await upsertCachedBooks([book])
      // Mark wishlist item as soft-deleted in the wishlist cache
      const tombstone: CachedWishlistItem = {
        ...item,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      await upsertCachedWishlist([tombstone])
      setItems(prev => prev.filter(w => w.id !== item.id))
    } catch {
      // leave as-is
    } finally {
      setMovingId(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  async function handleDelete(item: CachedWishlistItem) {
    if (!window.confirm(t('confirm_remove_wishlist'))) return
    setDeletingId(item.id)
    try {
      await api.delete(`/wishlist/${item.id}`)
      const tombstone: CachedWishlistItem = {
        ...item,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      await upsertCachedWishlist([tombstone])
      setItems(prev => prev.filter(w => w.id !== item.id))
    } catch {
      // leave as-is
    } finally {
      setDeletingId(null)
    }
  }

  // ---------------------------------------------------------------------------
  // After add / edit
  // ---------------------------------------------------------------------------

  async function handleSaved(saved: CachedWishlistItem) {
    await upsertCachedWishlist([saved])
    await loadFromCache()
    setShowAdd(false)
    setEditItem(null)
  }

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const sorted = sortWishlist(items, sort, sortDir)
  const visible = filterWishlist(sorted, filter, query, tagFilter)

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) for (const t of item.tags) set.add(t)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [items])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div ref={scrollRef} className="min-h-full pb-6">
        {/* Header */}
        <div className={`sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 px-4 transition-[padding] duration-300 ${collapsed ? 'pt-2 pb-0' : 'pt-3 pb-3'}`}>
          {/* Title row: title/count + search button + add button */}
          <div className="flex items-center gap-2">
            {/* Title + count + sync spinner */}
            <div className="flex items-baseline gap-2 min-w-0 flex-1">
              <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex-shrink-0">
                {t('page_wishlist')}
              </h1>
              {syncing && (
                <svg className="w-3.5 h-3.5 animate-spin text-blue-400 flex-shrink-0 self-center" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              {items.length > 0 && (
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {visible.length < items.length
                    ? <>{visible.length}<span className="opacity-50"> / {items.length}</span></>
                    : items.length}
                </span>
              )}
            </div>

            {/* Search button */}
            <button
              onClick={() => setShowSearchModal(true)}
              title={t('search_placeholder')}
              className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg border transition-colors ${
                query
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-400'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
            </button>

            {/* Add button */}
            <button
              onClick={() => setShowAdd(true)}
              title={t('add_to_wishlist')}
              className="flex-shrink-0 flex items-center justify-center w-7 h-7 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          </div>

          {/* Collapsible controls */}
          <div
            className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
            style={{
              gridTemplateRows: collapsed ? '0fr' : '1fr',
              opacity: collapsed ? 0 : 1,
              pointerEvents: collapsed ? 'none' : undefined,
            }}
          >
            <div className="overflow-hidden">
              <div className="space-y-2 mt-2">

                {/* Filter + sort + view — single row */}
                <div className="flex items-center gap-1.5">
                  {/* Wishlist filter buttons */}
                  {([
                    { key: 'all' as WishFilter, label: t('filter_all'), icon: (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
                      </svg>
                    ) },
                    { key: 'pending' as WishFilter, label: t('filter_pending'), icon: (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill={filter === 'pending' ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
                      </svg>
                    ) },
                  ]).map(({ key: f, label, icon }) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      title={label}
                      className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg border transition-colors ${
                        filter === f
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-400'
                      }`}
                    >
                      {icon}
                    </button>
                  ))}

                  {/* Sort icon buttons + view toggle */}
                  <div className="ml-auto flex items-center gap-1.5">
                    <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-visible">
                      {([
                        { key: 'title' as WishSort,    label: t('sort_title'),    defaultDir: 'asc' as const, icon: (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                          </svg>
                        ) },
                        { key: 'author' as WishSort,   label: t('sort_author'),   defaultDir: 'asc' as const, icon: (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                          </svg>
                        ) },
                        { key: 'added' as WishSort,    label: t('sort_added'),    defaultDir: 'desc' as const, icon: (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                          </svg>
                        ) },
                      ] as const).map(({ key: sk, label, defaultDir, icon }, i, arr) => {
                        const active = sort === sk
                        return (
                          <button
                            key={sk}
                            title={label + (active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')}
                            onClick={() => {
                              if (active) {
                                setSortDir(d => d === 'asc' ? 'desc' : 'asc')
                              } else {
                                setSort(sk)
                                setSortDir(defaultDir)
                              }
                            }}
                            className={`relative p-1.5 transition-colors ${i === 0 ? 'rounded-l-lg' : ''} ${i === arr.length - 1 ? 'rounded-r-lg' : ''} ${
                              active
                                ? 'bg-blue-600 text-white'
                                : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                            }`}
                          >
                            {icon}
                            {active && (
                              <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-blue-700 border-2 border-gray-50 dark:border-gray-900 flex items-center justify-center text-white z-10" style={{ fontSize: 7 }}>
                                {sortDir === 'asc' ? '↑' : '↓'}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>

                    {/* Column count — only in compact mode */}
                    {viewMode === 'compact' && (
                      <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
                        {([2, 3, 4, 5, 6] as const).map(n => (
                          <button
                            key={n}
                            onClick={() => { setCompactCols(n); localStorage.setItem(COMPACT_COLS_KEY, String(n)) }}
                            className={`px-1.5 py-1 text-xs transition-colors ${compactCols === n ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* View toggle */}
                    <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
                      <button
                        onClick={() => { setViewMode('detail'); localStorage.setItem(VIEW_MODE_KEY, 'detail') }}
                        title={t('detail_view')}
                        className={`p-1.5 transition-colors ${viewMode === 'detail' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => { setViewMode('compact'); localStorage.setItem(VIEW_MODE_KEY, 'compact') }}
                        title={t('compact_view')}
                        className={`p-1.5 transition-colors ${viewMode === 'compact' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <rect x="3" y="3" width="5" height="5" rx="0.75" />
                          <rect x="9.5" y="3" width="5" height="5" rx="0.75" />
                          <rect x="16" y="3" width="5" height="5" rx="0.75" />
                          <rect x="3" y="9.5" width="5" height="5" rx="0.75" />
                          <rect x="9.5" y="9.5" width="5" height="5" rx="0.75" />
                          <rect x="16" y="9.5" width="5" height="5" rx="0.75" />
                          <rect x="3" y="16" width="5" height="5" rx="0.75" />
                          <rect x="9.5" y="16" width="5" height="5" rx="0.75" />
                          <rect x="16" y="16" width="5" height="5" rx="0.75" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Tag filter pills */}
                {allTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTagFilter(prev =>
                        prev.includes('__untagged__')
                          ? prev.filter(t => t !== '__untagged__')
                          : ['__untagged__']
                      )}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                        tagFilter.includes('__untagged__')
                          ? 'bg-violet-500 border-violet-500 text-white'
                          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-violet-400'
                      }`}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
                        <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" />
                      </svg>
                      无标签
                    </button>
                    {allTags.map(tag => {
                      const active = tagFilter.includes(tag)
                      const palette = tagColor(tag)
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setTagFilter(prev =>
                            active
                              ? prev.filter(t => t !== tag)
                              : [...prev.filter(t => t !== '__untagged__'), tag]
                          )}
                          className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                            active
                              ? palette.active
                              : `bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 ${palette.hover}`
                          }`}
                        >
                          {tag}
                        </button>
                      )
                    })}
                    {tagFilter.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setTagFilter([])}
                        className="px-2 py-0.5 rounded-full text-xs border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors"
                      >
                        清除
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Progress bar divider */}
          <div className={`-mx-4 transition-[margin] duration-300 ${collapsed ? 'mt-2' : 'mt-3'}`}>
            <div className="h-0.5 bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>

        {/* Add / Edit form */}
        {(showAdd || editItem) && (
          <div className="px-4 pt-4">
            <AddFormCard
              mode="wishlist"
              initial={editItem ?? undefined}
              onSaved={(item: CachedWishlistItem) => { void handleSaved(item) }}
              onCancel={() => { setShowAdd(false); setEditItem(null) }}
            />
          </div>
        )}

        {/* Wishlist items */}
        <div className={`px-4 pt-3 ${viewMode === 'compact' ? 'grid gap-1' : 'space-y-2'}`}
          style={viewMode === 'compact' ? { gridTemplateColumns: `repeat(${compactCols}, minmax(0, 1fr))` } : undefined}
        >
          {loading && viewMode === 'detail' && (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-2.5 animate-pulse">
                <div className="w-14 h-20 rounded bg-gray-200 dark:bg-gray-700 shrink-0" />
                <div className="flex-1 py-1 space-y-2">
                  <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                </div>
              </div>
            ))
          )}
          {loading && viewMode === 'compact' && (
            Array.from({ length: compactCols * 4 }).map((_, i) => (
              <div key={i} className="animate-pulse flex flex-col gap-1">
                <div className="w-full aspect-[2/3] rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-4/5 mx-auto" />
              </div>
            ))
          )}
          {!loading && visible.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-12"
              style={viewMode === 'compact' ? { gridColumn: '1 / -1' } : undefined}
            >
              {items.length === 0 ? t('empty_wishlist') : t('empty_filter')}
            </p>
          )}
          {visible.map(item =>
            viewMode === 'compact' ? (
              <WishGridCard
                key={item.id}
                item={item}
                deleting={deletingId === item.id || movingId === item.id}
                compactCols={compactCols}
                onEdit={() => setEditItem(item)}
                t={t}
              />
            ) : (
              <WishCard
                key={item.id}
                item={item}
                deleting={deletingId === item.id}
                moving={movingId === item.id}
                onTogglePending={() => { void handleTogglePending(item) }}
                onMoveToInventory={() => { void handleMoveToInventory(item) }}
                onEdit={() => setEditItem(item)}
                onDelete={() => { void handleDelete(item) }}
                t={t}
              />
            )
          )}
        </div>
      </div>

      {/* Search modal */}
      {showSearchModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/40 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setShowSearchModal(false) }}
        >
          <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="relative p-3">
              <svg className="absolute left-5.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('search_placeholder')}
                autoFocus
                className="w-full h-10 pl-9 pr-9 text-base rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-5.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSearchModal(false)}
                  className="absolute right-5.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <div className="border-t border-gray-100 dark:border-gray-700 px-3 py-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setQuery(''); setShowSearchModal(false) }}
                className="px-3 py-1.5 text-sm rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => setShowSearchModal(false)}
                className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                {t('done')}
              </button>
            </div>
          </div>
        </div>
      )}
    </PullToRefresh>
  )
}

// ---------------------------------------------------------------------------
// WishGridCard  (compact view)
// ---------------------------------------------------------------------------

interface WishGridCardProps {
  item: CachedWishlistItem
  deleting: boolean
  compactCols: 2 | 3 | 4 | 5 | 6
  onEdit: () => void
  t: (key: DictKey, vars?: Record<string, string | number>) => string
}

function WishGridCard({ item, deleting, compactCols, onEdit }: WishGridCardProps) {
  const priorityDot: Record<string, string> = {
    high: 'bg-red-400',
    medium: 'bg-yellow-400',
    low: 'bg-gray-300 dark:bg-gray-600',
  }

  return (
    <button
      onClick={onEdit}
      className={`flex flex-col bg-white dark:bg-gray-800 rounded-xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-700 transition-opacity w-full text-left ${deleting ? 'opacity-40 pointer-events-none' : ''}`}
    >
      {/* Cover */}
      <div className="w-full aspect-[2/3] bg-gray-100 dark:bg-gray-700 relative">
        {item.cover_key ? (
          <img
                src={coverUrl(item.cover_key)}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
            </svg>
          </div>
        )}
        {/* Priority dot */}
        <span className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-800 ${priorityDot[item.priority] ?? priorityDot.low}`} />
        {/* Pending buy indicator */}
        {item.pending_buy && (
          <span className="absolute top-1.5 left-1.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-800 bg-blue-500" />
        )}
      </div>
      {/* Title */}
      <div className="px-1 py-0.5">
        <p className={`font-medium text-gray-900 dark:text-gray-100 truncate leading-snug text-center ${
          compactCols <= 3 ? 'text-[10px]' : compactCols <= 5 ? 'text-[9px]' : 'text-[8px]'
        }`}>
          {item.title}
        </p>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// WishCard
// ---------------------------------------------------------------------------

interface WishCardProps {
  item: CachedWishlistItem
  deleting: boolean
  moving: boolean
  onTogglePending: () => void
  onMoveToInventory: () => void
  onEdit: () => void
  onDelete: () => void
  t: (key: DictKey, vars?: Record<string, string | number>) => string
}

function WishCard({
  item,
  deleting,
  moving,
  onTogglePending,
  onMoveToInventory,
  onEdit,
  onDelete,
  t,
}: WishCardProps) {
  const isBusy = deleting || moving
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openActions() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setExpanded(true)
    timerRef.current = setTimeout(() => setExpanded(false), 3000)
  }
  function closeActions() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setExpanded(false)
  }

  return (
    <div
      className={`flex gap-2.5 bg-white dark:bg-gray-800 rounded-xl p-2.5 shadow-sm border border-gray-100 dark:border-gray-700 transition-opacity ${isBusy ? 'opacity-40 pointer-events-none' : ''}`}
    >
      {/* Cover */}
      <div className="flex-shrink-0 w-14 h-20 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-700">
        {item.cover_key ? (
          <img
                src={coverUrl(item.cover_key)}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-5 h-5 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
            </svg>
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex flex-1 min-w-0 flex-col">
        {/* Top: title + pending-buy bookmark */}
        <div className="flex items-start gap-1 min-w-0">
          <p className="flex-1 min-w-0 text-base font-medium text-gray-900 dark:text-gray-100 truncate leading-snug">
            {item.title}
          </p>
          <button
            onClick={onTogglePending}
            title={item.pending_buy ? t('not_pending_buy') : t('pending_buy')}
            className={`flex-shrink-0 p-0.5 rounded transition-colors ${item.pending_buy ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600 hover:text-amber-400'}`}
          >
            <svg className="w-4 h-4" fill={item.pending_buy ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
            </svg>
          </button>
        </div>

        {/* Middle: author */}
        <p className="flex-1 text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
          {item.author}
          {item.publisher && ` · ${item.publisher}`}
        </p>

        {/* Bottom: tags ↔ actions */}
        <div className="flex items-center gap-1 min-w-0">
          {expanded ? (
            <>
              <div className="flex items-center gap-0.5 flex-1">
                <button onClick={() => { closeActions(); onMoveToInventory() }} className="px-1 py-0.5 rounded text-gray-400 dark:text-gray-500 hover:text-green-500 transition-colors" title={t('move_to_library')}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  title={copied ? t('copy_title_done') : t('copy_title')}
                  onClick={() => {
                    void navigator.clipboard.writeText(item.title).then(() => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    })
                  }}
                  className="px-1 py-0.5 rounded text-gray-400 dark:text-gray-500 hover:text-blue-500 transition-colors"
                >
                  {copied ? (
                    <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                    </svg>
                  )}
                </button>
                <button onClick={() => { closeActions(); onEdit() }} className="px-1 py-0.5 rounded text-gray-400 dark:text-gray-500 hover:text-blue-500 transition-colors" title={t('edit')}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                  </svg>
                </button>
                <button onClick={() => { closeActions(); onDelete() }} className="px-1 py-0.5 rounded text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors" title={t('remove')}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
              </div>
              <button onClick={closeActions} className="flex-shrink-0 px-1 py-0.5 rounded text-gray-400 dark:text-gray-500 hover:text-gray-600 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          ) : (
            <>
              <div className="flex-1 flex gap-1 overflow-x-auto no-scrollbar">
                {item.tags.map(tag => (
                  <span key={tag} className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${tagColor(tag).badge}`}>
                    {tag}
                  </span>
                ))}
              </div>
              <button onClick={openActions} className="flex-shrink-0 px-1 py-0.5 rounded text-gray-400 dark:text-gray-500 hover:text-gray-600 transition-colors">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
