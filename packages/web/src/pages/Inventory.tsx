// src/pages/Inventory.tsx
// PWA book library page.
// Reads from IndexedDB cache; writes go through the API and refresh the cache.

import { useState, useEffect, useCallback, useTransition, useRef } from 'react'
import { useLang, type DictKey } from '../lib/i18n.tsx'
import { api } from '../lib/api.ts'
import {
  getCachedBooks,
  getCachedReadingStates,
  upsertCachedBooks,
  upsertCachedReadingStates,
  type CachedBook,
  type CachedReadingState,
} from '../lib/db-cache.ts'
import { AddFormCard } from '../components/AddFormCard.tsx'
import { PullToRefresh } from '../components/PullToRefresh.tsx'
import { runSync, pushReadingState } from '../lib/sync.ts'
import { tagColor } from '@tomekeep/shared'
import { getActiveProfile } from '../lib/profiles.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReadingStatus = 'unread' | 'reading' | 'read'
type SortKey = 'added' | 'finished' | 'title' | 'author'
type FilterStatus = 'all' | ReadingStatus
type ViewMode = 'detail' | 'compact'

const VIEW_MODE_KEY = 'tk_inv_view'
const COMPACT_COLS_KEY = 'tk_inv_cols'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusForBook(
  book: CachedBook,
  stateMap: Map<string, CachedReadingState>,
): ReadingStatus {
  return (stateMap.get(book.id)?.status as ReadingStatus | undefined) ?? 'unread'
}

function sortBooks(
  books: CachedBook[],
  key: SortKey,
  stateMap: Map<string, CachedReadingState>,
): CachedBook[] {
  return [...books].sort((a, b) => {
    if (key === 'title') return a.title.localeCompare(b.title)
    if (key === 'author') return a.author.localeCompare(b.author)
    if (key === 'finished') {
      const ca = stateMap.get(a.id)?.completed_at ?? ''
      const cb = stateMap.get(b.id)?.completed_at ?? ''
      // Books without a completed_at go to the end
      if (!ca && !cb) return 0
      if (!ca) return 1
      if (!cb) return -1
      return cb.localeCompare(ca) // newest first
    }
    // 'added' — newest first
    return b.added_at.localeCompare(a.added_at)
  })
}

function filterBooks(
  books: CachedBook[],
  filter: FilterStatus,
  stateMap: Map<string, CachedReadingState>,
  query: string,
): CachedBook[] {
  const q = query.trim().toLowerCase()
  return books.filter(b => {
    if (filter !== 'all' && statusForBook(b, stateMap) !== filter) return false
    if (q) {
      const haystack = [b.title, b.author, b.isbn ?? '', b.publisher ?? '']
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Status cycle: unread → reading → read → unread
// ---------------------------------------------------------------------------

const statusCycle: Record<ReadingStatus, ReadingStatus> = {
  unread: 'reading',
  reading: 'read',
  read: 'unread',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Inventory() {
  const { t } = useLang()

  const [books, setBooks] = useState<CachedBook[]>([])
  const [stateMap, setStateMap] = useState<Map<string, CachedReadingState>>(new Map())
  const [loading, setLoading] = useState(true)
  const [, startTransition] = useTransition()

  // Active profile — null means the account-level default
  const [activeProfileId, setActiveProfileId] = useState<string | null>(() => getActiveProfile()?.id ?? null)

  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null) ?? 'detail'
  )
  const [compactCols, setCompactCols] = useState<2 | 3 | 4 | 5 | 6>(
    () => (Number(localStorage.getItem(COMPACT_COLS_KEY)) as 2 | 3 | 4 | 5 | 6) || 2
  )

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [sort, setSort] = useState<SortKey>('added')

  const [showAdd, setShowAdd] = useState(false)
  const [editBook, setEditBook] = useState<CachedBook | null>(null)

  // Book being deleted (optimistic remove)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Collapsed header when scrolled away from top
  const [collapsed, setCollapsed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Walk up to the nearest scrollable ancestor (the <main> in Layout.tsx)
    let el: HTMLElement | null = scrollRef.current?.parentElement ?? null
    while (el && getComputedStyle(el).overflowY === 'visible') {
      el = el.parentElement
    }
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
    const profileId = getActiveProfile()?.id ?? null
    const [bs, allStates] = await Promise.all([getCachedBooks(), getCachedReadingStates(undefined)])
    const map = new Map<string, CachedReadingState>()
    // First pass: load the null-profile (desktop-written) rows as a baseline
    for (const r of allStates) {
      if (r.profile_id === null) map.set(r.book_id, r)
    }
    // Second pass: profile-specific rows take precedence (overwrite the baseline)
    if (profileId !== null) {
      for (const r of allStates) {
        if (r.profile_id === profileId) map.set(r.book_id, r)
      }
    }
    // Batch both updates; wrap in startTransition for background reloads so React
    // doesn't flash a loading state mid-render.
    if (background) {
      startTransition(() => {
        setBooks(bs)
        setStateMap(map)
      })
    } else {
      setBooks(bs)
      setStateMap(map)
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

  // Reload when active profile changes
  useEffect(() => {
    function onProfile() {
      setActiveProfileId(getActiveProfile()?.id ?? null)
      void loadFromCache()
    }
    window.addEventListener('tomekeep:profile', onProfile)
    return () => window.removeEventListener('tomekeep:profile', onProfile)
  }, [loadFromCache])

  // ---------------------------------------------------------------------------
  // Pull-to-refresh
  // ---------------------------------------------------------------------------

  const handleRefresh = useCallback(async () => {
    await runSync()
    await loadFromCache()
  }, [loadFromCache])

  // ---------------------------------------------------------------------------
  // Cycle reading status
  // ---------------------------------------------------------------------------

  async function handleStatusCycle(book: CachedBook) {
    const current = statusForBook(book, stateMap)
    const next = statusCycle[current]
    const profileId = activeProfileId

    // Optimistic update
    const prev = stateMap.get(book.id)
    const optimistic: CachedReadingState = {
      user_id: prev?.user_id ?? '',
      book_id: book.id,
      profile_id: profileId,
      status: next,
      completed_at: next === 'read' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }
    setStateMap(m => new Map(m).set(book.id, optimistic))

    try {
      const updated = await pushReadingState(book.id, next, profileId)
      await upsertCachedReadingStates([updated])
      setStateMap(m => new Map(m).set(book.id, updated))
    } catch {
      // Roll back optimistic update
      setStateMap(m => {
        const next2 = new Map(m)
        if (prev) next2.set(book.id, prev)
        else next2.delete(book.id)
        return next2
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Delete book
  // ---------------------------------------------------------------------------

  async function handleDelete(book: CachedBook) {
    if (!window.confirm(t('confirm_delete_book'))) return
    setDeletingId(book.id)
    try {
      await api.delete(`/books/${book.id}`)
      // Soft-delete: mark in cache then refresh
      const tombstone: CachedBook = {
        ...book,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      await upsertCachedBooks([tombstone])
      setBooks(bs => bs.filter(b => b.id !== book.id))
    } catch {
      // leave as-is
    } finally {
      setDeletingId(null)
    }
  }

  // ---------------------------------------------------------------------------
  // After add / edit
  // ---------------------------------------------------------------------------

  async function handleSaved(saved: CachedBook) {
    await upsertCachedBooks([saved])
    await loadFromCache()
    setShowAdd(false)
    setEditBook(null)
  }

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const sorted = sortBooks(books, sort, stateMap)
  const visible = filterBooks(sorted, filter, stateMap, query)

  const readCount = visible.filter(b => statusForBook(b, stateMap) === 'read').length
  const totalCount = visible.length
  const readPct = totalCount > 0 ? readCount / totalCount : 0

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div
        ref={scrollRef}
        className="min-h-full pb-6"
      >
        {/* Header row */}
        <div className={`sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 px-4 transition-[padding] duration-300 ${collapsed ? 'pt-2 pb-0' : 'pt-3 pb-3'}`}>
          {/* Title + add button — always visible */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2 min-w-0">
              <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex-shrink-0">
                {t('page_library')}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {totalCount < books.length
                  ? <>{totalCount}<span className="opacity-50"> / {books.length}</span></>
                  : books.length}
              </p>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              title={t('add_book')}
              className="flex items-center justify-center w-6 h-6 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          </div>

          {/* Collapsible controls: search + sort + filter + view */}
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
              {/* Search + sort — same row */}
              <div className="flex items-center gap-2">
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={t('search_placeholder')}
                  className="flex-1 min-w-0 h-6 px-2 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={sort}
                  onChange={e => setSort(e.target.value as SortKey)}
                  className="flex-shrink-0 h-6 text-xs px-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none"
                >
                  <option value="added">{t('sort_added')}</option>
                  <option value="finished">{t('sort_finished')}</option>
                  <option value="title">{t('sort_title')}</option>
                  <option value="author">{t('sort_author')}</option>
                </select>
              </div>

              {/* Filter icons + view toggle + col count — same row */}
              <div className="flex items-center gap-1.5">
                {/* Status filter icon buttons */}
                {([
                  { key: 'all' as FilterStatus,     label: t('filter_all'),     icon: (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
                    </svg>
                  ) },
                  { key: 'unread' as FilterStatus,  label: t('filter_unread'),  icon: (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
                    </svg>
                  ) },
                  { key: 'reading' as FilterStatus, label: t('filter_reading'), icon: (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                    </svg>
                  ) },
                  { key: 'read' as FilterStatus,    label: t('filter_read'),    icon: (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                    </svg>
                  ) },
                ]).map(({ key: f, label, icon }) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    title={label}
                    className={`flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-lg border transition-colors ${
                      filter === f
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-400'
                    }`}
                  >
                    {icon}
                  </button>
                ))}

                <div className="ml-auto flex items-center gap-1.5">
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
                      className={`p-1 transition-colors ${viewMode === 'detail' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => { setViewMode('compact'); localStorage.setItem(VIEW_MODE_KEY, 'compact') }}
                      title={t('compact_view')}
                      className={`p-1 transition-colors ${viewMode === 'compact' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
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
            </div>
            </div>
          </div>

          {/* Reading progress bar — acts as header/list divider */}
          <div className={`relative group -mx-4 transition-[margin] duration-300 ${collapsed ? 'mt-2' : 'mt-3'}`}>
            <div className="h-0.5 bg-gray-200 dark:bg-gray-700 overflow-hidden">
              {books.length > 0 && (
                <div
                  className="h-full bg-green-500 dark:bg-green-400 animate-pulse transition-[width] duration-500 ease-in-out"
                  style={{ width: `${readPct * 100}%` }}
                />
              )}
            </div>
            {/* Tooltip — appears on hover, centred above the bar */}
            {books.length > 0 && (
              <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap rounded px-2 py-0.5 text-xs bg-gray-800 dark:bg-gray-700 text-white tabular-nums shadow-sm">
                {t('progress_read', { read: readCount, total: totalCount })}
                {' · '}
                {Math.round(readPct * 100)}%
              </div>
            )}
          </div>
        </div>

        {/* Add / Edit form */}
        {(showAdd || editBook) && (
          <div className="px-4 pt-4">
            <AddFormCard
              mode="inventory"
              initial={editBook ?? undefined}
              onSaved={(book: CachedBook) => { void handleSaved(book) }}
              onCancel={() => { setShowAdd(false); setEditBook(null) }}
            />
          </div>
        )}

        {/* Book list */}
        <div className={`px-4 pt-3 ${viewMode === 'compact' ? `grid gap-1` : 'space-y-2'}`}
          style={viewMode === 'compact' ? { gridTemplateColumns: `repeat(${compactCols}, minmax(0, 1fr))` } : undefined}
        >
          {loading && (
            <p className={`text-sm text-gray-400 dark:text-gray-500 text-center py-12`}
              style={viewMode === 'compact' ? { gridColumn: `1 / -1` } : undefined}
            >…</p>
          )}

          {!loading && visible.length === 0 && (
            <p className={`text-sm text-gray-400 dark:text-gray-500 text-center py-12`}
              style={viewMode === 'compact' ? { gridColumn: `1 / -1` } : undefined}
            >
              {books.length === 0 ? t('empty_library') : t('empty_filter')}
            </p>
          )}

          {visible.map(book =>
            viewMode === 'compact' ? (
              <BookGridCard
                key={book.id}
                book={book}
                status={statusForBook(book, stateMap)}
                deleting={deletingId === book.id}
                compactCols={compactCols}
                onEdit={() => setEditBook(book)}
                t={t}
              />
            ) : (
              <BookCard
                key={book.id}
                book={book}
                status={statusForBook(book, stateMap)}
                deleting={deletingId === book.id}
                onStatusCycle={() => { void handleStatusCycle(book) }}
                onEdit={() => setEditBook(book)}
                onDelete={() => { void handleDelete(book) }}
                t={t}
              />
            )
          )}
        </div>
      </div>
    </PullToRefresh>
  )
}

// ---------------------------------------------------------------------------
// BookGridCard  (compact view)
// ---------------------------------------------------------------------------

interface BookGridCardProps {
  book: CachedBook
  status: ReadingStatus
  deleting: boolean
  compactCols: 2 | 3 | 4 | 5 | 6
  onEdit: () => void
  t: (key: DictKey, vars?: Record<string, string | number>) => string
}

function BookGridCard({ book, status, deleting, compactCols, onEdit }: BookGridCardProps) {
  const statusDot: Record<ReadingStatus, string> = {
    unread:  'bg-gray-300 dark:bg-gray-600',
    reading: 'bg-yellow-400 dark:bg-yellow-500',
    read:    'bg-green-500 dark:bg-green-400',
  }

  return (
    <button
      onClick={onEdit}
      className={`flex flex-col bg-white dark:bg-gray-800 rounded-xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-700 transition-opacity w-full text-left ${deleting ? 'opacity-40 pointer-events-none' : ''}`}
    >
      {/* Cover */}
      <div className="w-full aspect-[2/3] bg-gray-100 dark:bg-gray-700 relative">
        {book.cover_key ? (
          <img
            src={`/api/covers/${book.cover_key}`}
            alt={book.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
        )}
        {/* Status dot */}
        <span className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-800 ${statusDot[status]}`} />
      </div>
      {/* Title */}
      <div className="px-1 py-0.5">
        <p className={`font-medium text-gray-900 dark:text-gray-100 truncate leading-snug text-center ${
          compactCols <= 3 ? 'text-[10px]' : compactCols <= 5 ? 'text-[9px]' : 'text-[8px]'
        }`}>
          {book.title}
        </p>
      </div>
    </button>
  )
}

interface BookCardProps {
  book: CachedBook
  status: ReadingStatus
  deleting: boolean
  onStatusCycle: () => void
  onEdit: () => void
  onDelete: () => void
  t: (key: DictKey, vars?: Record<string, string | number>) => string
}

function BookCard({ book, status, deleting, onStatusCycle, onEdit, onDelete, t }: BookCardProps) {
  const statusTip: Record<ReadingStatus, string> = {
    unread: t('status_unread_tip'),
    reading: t('status_reading_tip'),
    read: t('status_read_tip'),
  }

  return (
    <div className={`flex gap-2.5 bg-white dark:bg-gray-800 rounded-xl p-2.5 shadow-sm border border-gray-100 dark:border-gray-700 transition-opacity ${deleting ? 'opacity-40 pointer-events-none' : ''}`}>
      {/* Cover */}
      <div className="flex-shrink-0 w-14 h-20 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-700">
        {book.cover_key ? (
          <img
            src={`/api/covers/${book.cover_key}`}
            alt={book.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-5 h-5 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
        )}
      </div>

      {/* Right side: meta + actions */}
      <div className="flex flex-1 min-w-0 gap-1.5">
        {/* Meta: 3 rows, compact */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          {/* Row 1: title */}
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate leading-snug">
            {book.title}
          </p>
          {/* Row 2: author · publisher */}
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {book.author}
            {book.publisher && ` · ${book.publisher}`}
          </p>
          {/* Row 3: tags (horizontal scroll) */}
          {book.tags.length > 0 && (
            <div className="flex gap-1 overflow-x-auto no-scrollbar">
              {book.tags.map(tag => (
                <span key={tag} className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${tagColor(tag).badge}`}>
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions: status top-right, edit+delete bottom-right */}
        <div className="flex flex-col items-end justify-between flex-shrink-0">
          {/* Status toggle — top */}
          <button
            onClick={onStatusCycle}
            title={statusTip[status]}
            className={`p-0.5 rounded-full hover:opacity-70 transition-opacity ${
              status === 'read'    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' :
              status === 'reading' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' :
                                     'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            {status === 'read' && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
              </svg>
            )}
            {status === 'reading' && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
              </svg>
            )}
            {status === 'unread' && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
              </svg>
            )}
          </button>

          {/* Edit + Delete — bottom */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={onEdit}
              className="p-1 rounded text-gray-400 dark:text-gray-500 hover:text-blue-500 transition-colors"
              title={t('edit')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
              </svg>
            </button>
            <button
              onClick={onDelete}
              className="p-1 rounded text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
              title={t('delete')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
