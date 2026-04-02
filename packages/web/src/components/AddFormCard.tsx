// src/components/AddFormCard.tsx
// Shared add/edit form for both inventory books and wishlist items.
//
// Props:
//   mode: 'inventory' | 'wishlist'
//   initial: existing item to edit (omit for add)
//   onSaved: called with the created/updated item after a successful API call
//   onCancel: called when the user cancels
//
// Features:
//   - Title, author, publisher, ISBN fields
//   - Douban URL field → fetch metadata via POST /api/metadata/douban
//   - Cover upload via POST /api/covers/upload (multipart)
//   - Priority selector (wishlist only)
//   - Tag management

import { useState, useRef } from 'react'
import { useLang } from '../lib/i18n.tsx'
import { api } from '../lib/api.ts'
import { type CachedBook, type CachedWishlistItem } from '../lib/db-cache.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mode = 'inventory' | 'wishlist'
type Priority = 'high' | 'medium' | 'low'

interface BookPayload {
  title: string
  author: string
  publisher: string
  isbn: string
  cover_key: string
  detail_url: string
  tags: string[]
}

interface WishlistPayload extends BookPayload {
  priority: Priority
}

interface MetadataResponse {
  title?: string
  author?: string
  publisher?: string
  isbn?: string
  cover_key?: string
}

interface CoverUploadResponse {
  key: string
}

export interface AddFormCardProps {
  mode: Mode
  initial?: CachedBook | CachedWishlistItem
  onSaved: (item: CachedBook & CachedWishlistItem) => void
  onCancel: () => void
}

// ---------------------------------------------------------------------------
// Helper: is wishlist item?
// ---------------------------------------------------------------------------

function isWishlistItem(item: CachedBook | CachedWishlistItem): item is CachedWishlistItem {
  return 'priority' in item
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddFormCard({ mode, initial, onSaved, onCancel }: AddFormCardProps) {
  const { t } = useLang()

  const isEdit = !!initial

  // Form fields
  const [title, setTitle] = useState(initial?.title ?? '')
  const [author, setAuthor] = useState(initial?.author ?? '')
  const [publisher, setPublisher] = useState(initial?.publisher ?? '')
  const [isbn, setIsbn] = useState(initial?.isbn ?? '')
  const [detailUrl, setDetailUrl] = useState(initial?.detail_url ?? '')
  const [coverKey, setCoverKey] = useState(initial?.cover_key ?? '')
  const [tags, setTags] = useState<string[]>(initial?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [priority, setPriority] = useState<Priority>(
    initial && isWishlistItem(initial) ? (initial.priority as Priority) : 'medium',
  )

  // Status
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fetchingMeta, setFetchingMeta] = useState(false)
  const [metaMsg, setMetaMsg] = useState('')
  const [uploadingCover, setUploadingCover] = useState(false)

  const coverInputRef = useRef<HTMLInputElement>(null)

  // ---------------------------------------------------------------------------
  // Douban metadata fetch
  // ---------------------------------------------------------------------------

  async function handleFetchMeta() {
    const url = detailUrl.trim()
    if (!url) return
    setFetchingMeta(true)
    setMetaMsg(t('douban_loading'))
    try {
      const meta = await api.post<MetadataResponse>('/metadata/douban', { url })
      if (meta.title) setTitle(meta.title)
      if (meta.author) setAuthor(meta.author)
      if (meta.publisher) setPublisher(meta.publisher)
      if (meta.isbn) setIsbn(meta.isbn)
      if (meta.cover_key) setCoverKey(meta.cover_key)
      setMetaMsg(t('filled_douban_dot'))
    } catch {
      setMetaMsg(t('douban_parse_fail'))
    } finally {
      setFetchingMeta(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Cover upload
  // ---------------------------------------------------------------------------

  async function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingCover(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.upload<CoverUploadResponse>('/covers/upload', fd)
      setCoverKey(res.key)
    } catch {
      // ignore upload errors silently
    } finally {
      setUploadingCover(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Tags
  // ---------------------------------------------------------------------------

  function addTag() {
    const tag = tagInput.trim()
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag])
    }
    setTagInput('')
  }

  function removeTag(tag: string) {
    setTags(tags.filter(t => t !== tag))
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      setError(t('form_title_placeholder'))
      return
    }
    setSaving(true)
    setError('')

    const base: BookPayload = {
      title: title.trim(),
      author: author.trim(),
      publisher: publisher.trim(),
      isbn: isbn.trim(),
      cover_key: coverKey.trim(),
      detail_url: detailUrl.trim(),
      tags,
    }

    try {
      let result: CachedBook & CachedWishlistItem

      if (mode === 'inventory') {
        if (isEdit && initial) {
          result = await api.put<CachedBook & CachedWishlistItem>(`/books/${initial.id}`, base)
        } else {
          result = await api.post<CachedBook & CachedWishlistItem>('/books', base)
        }
      } else {
        const payload: WishlistPayload = { ...base, priority }
        if (isEdit && initial) {
          result = await api.put<CachedBook & CachedWishlistItem>(`/wishlist/${initial.id}`, payload)
        } else {
          result = await api.post<CachedBook & CachedWishlistItem>('/wishlist', payload)
        }
      }

      onSaved(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700 p-4">
      <form onSubmit={e => { void handleSubmit(e) }} noValidate className="space-y-3">
        {/* Cover + basic fields row */}
        <div className="flex gap-3">
          {/* Cover thumbnail + upload button */}
          <div className="flex-shrink-0 flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              disabled={uploadingCover}
              className="w-14 h-20 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 transition-colors"
              title={t('choose_cover')}
            >
              {coverKey ? (
                <img
                  src={`/api/covers/${coverKey}`}
                  alt={title}
                  className="w-full h-full object-cover"
                />
              ) : uploadingCover ? (
                <svg className="w-5 h-5 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
                </svg>
              )}
            </button>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleCoverChange}
            />
            <span className="text-xs text-gray-400 leading-none">{t('choose_cover').slice(0, 4)}</span>
          </div>

          {/* Fields */}
          <div className="flex-1 space-y-2">
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('form_title_placeholder')}
              required
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={author}
              onChange={e => setAuthor(e.target.value)}
              placeholder={t('form_author_placeholder')}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={publisher}
              onChange={e => setPublisher(e.target.value)}
              placeholder={t('form_publisher_placeholder')}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* ISBN */}
        <input
          type="text"
          value={isbn}
          onChange={e => setIsbn(e.target.value)}
          placeholder="ISBN"
          inputMode="numeric"
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* Douban URL + fetch */}
        <div className="flex gap-2">
          <input
            type="url"
            value={detailUrl}
            onChange={e => setDetailUrl(e.target.value)}
            placeholder={t('field_detail_url')}
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => { void handleFetchMeta() }}
            disabled={!detailUrl.trim() || fetchingMeta}
            className="px-3 py-2 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors whitespace-nowrap"
          >
            {fetchingMeta ? '…' : t('douban_login').slice(0, 2)}豆
          </button>
        </div>
        {metaMsg && (
          <p className="text-xs text-blue-500 dark:text-blue-400">{metaMsg}</p>
        )}

        {/* Priority (wishlist only) */}
        {mode === 'wishlist' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 w-12 flex-shrink-0">
              {t('sort_priority')}
            </span>
            {(['high', 'medium', 'low'] as Priority[]).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`flex-1 py-1 text-xs rounded-lg border transition-colors ${
                  priority === p
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        {/* Tags */}
        <div className="space-y-1.5">
          <div className="flex gap-1 flex-wrap">
            {tags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="text-gray-400 hover:text-red-500 transition-colors leading-none"
                  title={t('remove_tag', { tag })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
              placeholder={t('tag_input_placeholder')}
              className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={addTag}
              disabled={!tagInput.trim()}
              className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              {t('add_tag')}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl disabled:opacity-50 transition-colors"
          >
            {saving ? t('saving') : isEdit ? t('save') : t('add')}
          </button>
        </div>
      </form>
    </div>
  )
}
