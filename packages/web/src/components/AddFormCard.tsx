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
//   - Title, author, publisher, ISBN, detail URL fields
//   - Cover upload via POST /api/covers/upload (multipart)
//   - Tag management (edit mode only)

import { useState, useRef } from 'react'
import { useLang } from '../lib/i18n.tsx'
import { api } from '../lib/api.ts'
import { type CachedBook, type CachedWishlistItem } from '../lib/db-cache.ts'
import { tagColor } from '@tomekeep/shared'
import { IsbnScanModal } from './IsbnScanModal.tsx'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mode = 'inventory' | 'wishlist'

interface BookPayload {
  title: string
  author: string
  publisher: string
  isbn: string
  cover_key: string
  detail_url: string
  tags: string[]
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

  // Status
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [uploadingCover, setUploadingCover] = useState(false)
  const [showScanner, setShowScanner] = useState(false)

  const coverInputRef = useRef<HTMLInputElement>(null)

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
        if (isEdit && initial) {
          result = await api.put<CachedBook & CachedWishlistItem>(`/wishlist/${initial.id}`, base)
        } else {
          result = await api.post<CachedBook & CachedWishlistItem>('/wishlist', base)
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
        <div className="flex gap-3 items-stretch">
          {/* Cover thumbnail — stretches to match the height of the three input fields */}
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            disabled={uploadingCover}
            className="flex-shrink-0 w-[60px] rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 transition-colors"
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
            className="hidden"
            onChange={handleCoverChange}
          />

          {/* Fields */}
          <div className="flex-1 flex flex-col gap-1.5">
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('form_title_placeholder')}
              required
              className="w-full px-2.5 py-1.5 text-base rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={author}
              onChange={e => setAuthor(e.target.value)}
              placeholder={t('form_author_placeholder')}
              className="w-full px-2.5 py-1.5 text-base rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={publisher}
              onChange={e => setPublisher(e.target.value)}
              placeholder={t('form_publisher_placeholder')}
              className="w-full px-2.5 py-1.5 text-base rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* ISBN + scan button */}
        <div className="flex gap-2">
          <input
            type="text"
            value={isbn}
            onChange={e => setIsbn(e.target.value)}
            placeholder="ISBN"
            inputMode="numeric"
            className="flex-1 px-2.5 py-1.5 text-base rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => setShowScanner(true)}
            title={t('scan_isbn')}
            className="flex-shrink-0 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 18.75h.75v.75h-.75v-.75ZM18.75 13.5h.75v.75h-.75v-.75ZM18.75 18.75h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z" />
            </svg>
          </button>
        </div>

        {/* Detail URL */}
        <input
          type="url"
          value={detailUrl}
          onChange={e => setDetailUrl(e.target.value)}
          placeholder={t('field_detail_url')}
          className="w-full px-2.5 py-1.5 text-base rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* Tags — only shown when editing an existing item */}
        {isEdit && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
              placeholder={t('tag_input_placeholder')}
              className="flex-1 px-2.5 py-1.5 text-base rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          {tags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {tags.map(tag => (
              <span
                key={tag}
                className={`inline-flex items-center gap-1 text-sm px-2.5 py-1 rounded-full border ${tagColor(tag).badge}`}
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="opacity-60 hover:opacity-100 transition-opacity leading-none"
                  title={t('remove_tag', { tag })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          )}
        </div>
        )}

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

      {/* ISBN barcode scanner modal */}
      <IsbnScanModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onDetected={raw => setIsbn(raw)}
        mode="single"
      />
    </div>
  )
}
