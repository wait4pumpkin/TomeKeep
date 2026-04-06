// src/pages/Inventory.tsx
// PWA book library page.
// Reads from IndexedDB cache; writes go through the API and refresh the cache.

import { useState, useEffect, useCallback } from 'react'
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
type SortKey = 'added' | 'title' | 'author'
type FilterStatus = 'all' | ReadingStatus
type ViewMode = 'detail' | 'compact'

const VIEW_MODE_KEY = 'tk_inv_view'

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
): CachedBook[] {
  return [...books].sort((a, b) => {
    if (key === 'title') return a.title.localeCompare(b.title)
    if (key === 'author') return a.author.localeCompare(b.author)
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

  // Active profile — null means the account-level default
  const [activeProfileId, setActiveProfileId] = useState<string | null>(() => getActiveProfile()?.id ?? null)

  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null) ?? 'detail'
  )

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [sort, setSort] = useState<SortKey>('added')

  const [showAdd, setShowAdd] = useState(false)
  const [editBook, setEditBook] = useState<CachedBook | null>(null)

  // Book being deleted (optimistic remove)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Load from cache
  // ---------------------------------------------------------------------------

  const loadFromCache = useCallback(async () => {
    const profileId = getActiveProfile()?.id ?? null
    const [bs, rs] = await Promise.all([getCachedBooks(), getCachedReadingStates(profileId)])
    setBooks(bs)
    const map = new Map<string, CachedReadingState>()
    for (const r of rs) map.set(r.book_id, r)
    setStateMap(map)
  }, [])

  useEffect(() => {
    setLoading(true)
    loadFromCache().finally(() => setLoading(false))
  }, [loadFromCache])

  // Reload from cache whenever a background sync writes new data
  useEffect(() => {
    function onSync() { void loadFromCache() }
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

  const sorted = sortBooks(books, sort)
  const visible = filterBooks(sorted, filter, stateMap, query)

  const readCount = books.filter(b => statusForBook(b, stateMap) === 'read').length

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="min-h-full pb-6">
        {/* Header row */}
        <div className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3 space-y-2">
          {/* Title + add button */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {t('page_library')}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {t('progress_read', { read: readCount, total: books.length })}
              </p>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {t('add_book')}
            </button>
          </div>

          {/* Search */}
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('search_placeholder')}
            className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {/* Filter + sort */}
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
            {(['all', 'unread', 'reading', 'read'] as FilterStatus[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-shrink-0 px-3 py-1 text-xs rounded-full border transition-colors ${
                  filter === f
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                }`}
              >
                {f === 'all' ? t('filter_all')
                  : f === 'unread' ? t('filter_unread')
                  : f === 'reading' ? t('filter_reading')
                  : t('filter_read')}
              </button>
            ))}
            <div className="flex-shrink-0 ml-auto flex items-center gap-1.5">
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none"
              >
                <option value="added">{t('sort_added')}</option>
                <option value="title">{t('sort_title')}</option>
                <option value="author">{t('sort_author')}</option>
              </select>
              {/* View toggle */}
              <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
                <button
                  onClick={() => { setViewMode('detail'); localStorage.setItem(VIEW_MODE_KEY, 'detail') }}
                  title={t('detail_view')}
                  className={`p-1 transition-colors ${viewMode === 'detail' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                  </svg>
                </button>
                <button
                  onClick={() => { setViewMode('compact'); localStorage.setItem(VIEW_MODE_KEY, 'compact') }}
                  title={t('compact_view')}
                  className={`p-1 transition-colors ${viewMode === 'compact' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
                  </svg>
                </button>
              </div>
            </div>
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
        <div className={`px-4 pt-3 ${viewMode === 'compact' ? 'grid grid-cols-2 gap-2' : 'space-y-2'}`}>
          {loading && (
            <p className={`text-sm text-gray-400 dark:text-gray-500 text-center py-12 ${viewMode === 'compact' ? 'col-span-2' : ''}`}>…</p>
          )}

          {!loading && visible.length === 0 && (
            <p className={`text-sm text-gray-400 dark:text-gray-500 text-center py-12 ${viewMode === 'compact' ? 'col-span-2' : ''}`}>
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
  onEdit: () => void
  t: (key: DictKey, vars?: Record<string, string | number>) => string
}

function BookGridCard({ book, status, deleting, onEdit }: BookGridCardProps) {
  const statusDot: Record<ReadingStatus, string> = {
    unread: 'bg-gray-300 dark:bg-gray-600',
    reading: 'bg-yellow-400',
    read: 'bg-blue-500',
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
      <div className="px-2 py-1.5">
        <p className="text-xs font-medium text-gray-900 dark:text-gray-100 line-clamp-2 leading-snug">
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
  const statusIcon: Record<ReadingStatus, string> = {
    unread: '○',
    reading: '◑',
    read: '●',
  }
  const statusTip: Record<ReadingStatus, string> = {
    unread: t('status_unread_tip'),
    reading: t('status_reading_tip'),
    read: t('status_read_tip'),
  }
  const statusColor: Record<ReadingStatus, string> = {
    unread: 'text-gray-400',
    reading: 'text-yellow-500',
    read: 'text-blue-500',
  }

  return (
    <div className={`flex gap-3 bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm border border-gray-100 dark:border-gray-700 transition-opacity ${deleting ? 'opacity-40 pointer-events-none' : ''}`}>
      {/* Cover */}
      <div className="flex-shrink-0 w-12 h-16 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-700">
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

      {/* Meta */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate leading-snug">
            {book.title}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
            {book.author}
            {book.publisher && ` · ${book.publisher}`}
          </p>
        </div>
        {book.tags.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {book.tags.slice(0, 3).map(tag => (
              <span key={tag} className={`text-xs px-1.5 py-0.5 rounded-full ${tagColor(tag).badge}`}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col items-center justify-between flex-shrink-0 gap-1">
        {/* Status toggle */}
        <button
          onClick={onStatusCycle}
          title={statusTip[status]}
          className={`text-lg leading-none ${statusColor[status]}`}
        >
          {statusIcon[status]}
        </button>

        {/* Edit */}
        <button
          onClick={onEdit}
          className="p-1 rounded text-gray-400 dark:text-gray-500 hover:text-blue-500 transition-colors"
          title={t('edit')}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
          </svg>
        </button>

        {/* Delete */}
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
  )
}
