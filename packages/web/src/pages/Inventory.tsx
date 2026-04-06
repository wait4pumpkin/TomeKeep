// src/pages/Inventory.tsx
// PWA book library page.
// Reads from IndexedDB cache; writes go through the API and refresh the cache.

import { useState, useEffect, useCallback, useTransition, useRef, useMemo } from 'react'
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
  dir: 'asc' | 'desc',
): CachedBook[] {
  return [...books].sort((a, b) => {
    let cmp = 0
    if (key === 'title') cmp = a.title.localeCompare(b.title)
    else if (key === 'author') cmp = a.author.localeCompare(b.author)
    else if (key === 'finished') {
      const ca = stateMap.get(a.id)?.completed_at ?? ''
      const cb = stateMap.get(b.id)?.completed_at ?? ''
      if (!ca && !cb) cmp = 0
      else if (!ca) cmp = 1
      else if (!cb) cmp = -1
      else cmp = ca.localeCompare(cb)
    } else {
      // 'added'
      cmp = a.added_at.localeCompare(b.added_at)
    }
    return dir === 'asc' ? cmp : -cmp
  })
}

function filterBooks(
  books: CachedBook[],
  filter: FilterStatus,
  stateMap: Map<string, CachedReadingState>,
  query: string,
  tagFilter: string[],
): CachedBook[] {
  const q = query.trim().toLowerCase()
  return books.filter(b => {
    if (filter !== 'all' && statusForBook(b, stateMap) !== filter) return false
    if (tagFilter.length > 0 && !tagFilter.every(t => {
      if (t === '__untagged__') return b.tags.length === 0
      return b.tags.includes(t)
    })) return false
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
  const [showSearchModal, setShowSearchModal] = useState(false)
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [sort, setSort] = useState<SortKey>('added')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [tagFilter, setTagFilter] = useState<string[]>([])

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

  const sorted = sortBooks(books, sort, stateMap, sortDir)
  const visible = filterBooks(sorted, filter, stateMap, query, tagFilter)

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const b of books) for (const t of b.tags) set.add(t)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [books])

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
          {/* Title row: title/count + search button + add button — always visible */}
          <div className="flex items-center gap-2">
            {/* Title + count */}
            <div className="flex items-baseline gap-2 min-w-0 flex-1">
              <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex-shrink-0">
                {t('page_library')}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {totalCount < books.length
                  ? <>{totalCount}<span className="opacity-50"> / {books.length}</span></>
                  : books.length}
              </p>
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
              title={t('add_book')}
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

                {/* Status filter + sort + view — single row */}
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
                      className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg border transition-colors ${
                        filter === f
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-400'
                      }`}
                    >
                      {icon}
                    </button>
                  ))}

                  {/* Sort icon buttons */}
                  <div className="ml-auto flex items-center gap-1.5">
                    <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-visible">
                      {([
                        { key: 'added' as SortKey,    label: t('sort_added'),    defaultDir: 'desc' as const, icon: (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                          </svg>
                        ) },
                        { key: 'finished' as SortKey, label: t('sort_finished'), defaultDir: 'desc' as const, icon: (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                          </svg>
                        ) },
                        { key: 'title' as SortKey,    label: t('sort_title'),    defaultDir: 'asc' as const, icon: (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                          </svg>
                        ) },
                        { key: 'author' as SortKey,   label: t('sort_author'),   defaultDir: 'asc' as const, icon: (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
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
            {/* Confirm / close */}
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
  const [expanded, setExpanded] = useState(false)
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

      {/* Right side */}
      <div className="flex flex-1 min-w-0 flex-col">
        {/* Top: title + status */}
        <div className="flex items-start gap-1 min-w-0">
          <p className="flex-1 min-w-0 text-base font-medium text-gray-900 dark:text-gray-100 truncate leading-snug">
            {book.title}
          </p>
          <button
            onClick={onStatusCycle}
            title={statusTip[status]}
            className={`flex-shrink-0 p-0.5 rounded-full hover:opacity-70 transition-opacity ${
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
        </div>

        {/* Middle: author */}
        <p className="flex-1 text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
          {book.author}
          {book.publisher && ` · ${book.publisher}`}
        </p>

        {/* Bottom: tags ↔ actions */}
        <div className="flex items-center gap-1 min-w-0">
          {expanded ? (
            <>
              <div className="flex items-center gap-0.5 flex-1">
                <button onClick={() => { closeActions(); onEdit() }} className="px-1 py-0.5 rounded text-gray-400 dark:text-gray-500 hover:text-blue-500 transition-colors" title={t('edit')}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                  </svg>
                </button>
                <button onClick={() => { closeActions(); onDelete() }} className="px-1 py-0.5 rounded text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors" title={t('delete')}>
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
                {book.tags.map(tag => (
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
