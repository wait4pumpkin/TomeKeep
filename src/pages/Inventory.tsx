import { useEffect, useState } from 'react'
import type { Book } from '../../electron/db'
import { AddFormCard } from '../components/AddFormCard'
import { DoubanFillField } from '../components/DoubanFillField'
import { IsbnScanModal } from '../components/IsbnScanModal'
import { parseIsbnSemantics, parseIsbnPublisher, normalizeIsbn, toIsbn13 } from '../lib/isbn'
import { mergeBookDraftWithMetadata } from '../lib/bookMetadataMerge'

export function Inventory() {
  const [books, setBooks] = useState<Book[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const [newBook, setNewBook] = useState<Partial<Book>>({ status: 'unread' })
  const [isScanOpen, setIsScanOpen] = useState(false)
  const [isbnError, setIsbnError] = useState<string | null>(null)
  const [metaStatus, setMetaStatus] = useState<{ state: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({
    state: 'idle',
  })

  async function loadBooks() {
    const data = await window.db.getBooks()
    setBooks(data)
  }

  useEffect(() => {
    let cancelled = false
    window.db.getBooks().then(data => {
      if (!cancelled) setBooks(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleAddBook(e: React.FormEvent) {
    e.preventDefault()
    if (!newBook.title || !newBook.author) return

    const id = crypto.randomUUID()

    // Download cover to local storage before saving the record
    let coverUrl = newBook.coverUrl
    if (coverUrl && !coverUrl.startsWith('app://')) {
      coverUrl = await window.covers.saveCover(id, coverUrl)
    }

    const bookToAdd = {
      ...newBook,
      coverUrl,
      id,
      addedAt: new Date().toISOString(),
    } as Book

    await window.db.addBook(bookToAdd)
    setNewBook({ status: 'unread' })
    setIsbnError(null)
    setMetaStatus({ state: 'idle' })
    setIsAdding(false)
    loadBooks()
  }

  async function handleDelete(id: string) {
    if (confirm('Are you sure you want to delete this book?')) {
      await window.db.deleteBook(id)
      loadBooks()
    }
  }

  async function handleCycleStatus(book: Book) {
    const next: Book['status'] =
      book.status === 'unread'  ? 'reading' :
      book.status === 'reading' ? 'read'    : 'unread'
    const updated = { ...book, status: next }
    // Optimistic update
    setBooks(prev => prev.map(b => b.id === book.id ? updated : b))
    await window.db.updateBook(updated)
  }

  async function fillMetadataByIsbn(isbn13: string) {
    setMetaStatus({ state: 'loading' })
    const res = await window.meta.lookupIsbn(isbn13)
    if (!res.ok) {
      const message =
        res.error === 'not_found' ? '未找到对应 ISBN 的元信息。' :
        res.error === 'timeout' ? '获取元信息超时，请稍后重试。' :
        res.error === 'invalid_isbn' ? 'ISBN 无效。' :
        '获取元信息失败，请稍后重试。'
      setMetaStatus({ state: 'error', message })
      return
    }

    setNewBook(prev => mergeBookDraftWithMetadata(prev, res.value) as Partial<Book>)
    setMetaStatus({ state: 'success', message: '已填充元信息。' })
  }

  function setIsbnFromRaw(raw: string): string | null {
    const digitsCount = (raw.match(/\d/g) ?? []).length
    const isbn10CharsCount = (raw.toUpperCase().match(/[0-9X]/g) ?? []).length
    if (digitsCount < 13 && isbn10CharsCount < 10) {
      setIsbnError(null)
      return null
    }

    const result = normalizeIsbn(raw)
    if (!result.ok) {
      if (result.error === 'empty') {
        setIsbnError(null)
        return null
      }
      setIsbnError(result.error === 'invalid_checksum' ? 'ISBN 校验失败，请重试或手动输入。' : '未识别到有效的 ISBN。')
      return null
    }

    const isbn13 = toIsbn13(result.value)
    if (!isbn13) {
      setIsbnError('未识别到有效的 ISBN。')
      return null
    }

    setNewBook(prev => ({ ...prev, isbn: isbn13 }))
    setIsbnError(null)
    return isbn13
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">My Library</h2>
        <button
          onClick={() => setIsAdding(true)}
          title="Add Book"
          className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {isAdding && (
        <>
          <AddFormCard
            title="Add New Book"
            onSubmit={handleAddBook}
            onCancel={() => setIsAdding(false)}
            submitLabel="Save Book"
            cancelLabel="Cancel"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
              <input
                type="text"
                required
                value={newBook.title || ''}
                onChange={e => setNewBook({ ...newBook, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Author</label>
              <input
                type="text"
                required
                value={newBook.author || ''}
                onChange={e => setNewBook({ ...newBook, author: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ISBN</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newBook.isbn || ''}
                  onChange={e => {
                    setNewBook({ ...newBook, isbn: e.target.value })
                    setIsbnError(null)
                    setMetaStatus({ state: 'idle' })
                  }}
                  onBlur={e => {
                    if (e.target.value) setIsbnFromRaw(e.target.value)
                  }}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
                <button
                  type="button"
                  onClick={() => {
                    const raw = newBook.isbn ?? ''
                    const isbn13 = setIsbnFromRaw(raw)
                    if (isbn13) void fillMetadataByIsbn(isbn13)
                  }}
                  className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:hover:bg-gray-100 dark:disabled:hover:bg-gray-700"
                  disabled={!newBook.isbn}
                >
                  Fill
                </button>
                <button
                  type="button"
                  onClick={() => setIsScanOpen(true)}
                  className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Scan
                </button>
              </div>
              {isbnError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{isbnError}</p>}
              {metaStatus.state !== 'idle' && !isbnError && (
                <p className={`mt-2 text-sm ${metaStatus.state === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                  {metaStatus.state === 'loading' ? '正在获取元信息…' : metaStatus.message}
                </p>
              )}
            </div>
            <DoubanFillField
              onApply={meta => {
                setNewBook(prev => mergeBookDraftWithMetadata(prev, meta) as Partial<Book>)
                setIsbnError(null)
                setMetaStatus({ state: 'idle' })
              }}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
              <select
                value={newBook.status}
                onChange={e => setNewBook({ ...newBook, status: e.target.value as Book['status'] })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                <option value="unread">Unread</option>
                <option value="reading">Reading</option>
                <option value="read">Read</option>
              </select>
            </div>
          </AddFormCard>
          <IsbnScanModal
            isOpen={isScanOpen}
            onClose={() => setIsScanOpen(false)}
            onDetected={raw => {
              const isbn13 = setIsbnFromRaw(raw)
              if (isbn13) void fillMetadataByIsbn(isbn13)
            }}
          />
        </>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {books.map(book => {
          const sem = book.isbn ? parseIsbnSemantics(book.isbn) : null
          const inferredPublisher = book.isbn && !book.publisher ? parseIsbnPublisher(book.isbn) : null
          return (
          <div key={book.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow overflow-hidden flex flex-row">
            {/* Cover — fixed width, natural height via object-contain */}
            <div className="relative flex-shrink-0 w-20 bg-gray-100 dark:bg-gray-700 self-stretch flex items-center justify-center">
              {book.coverUrl ? (
                <img
                  src={book.coverUrl}
                  alt={book.title}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="flex items-center justify-center text-gray-300 dark:text-gray-600">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                  </svg>
                </div>
              )}
            </div>

            {/* Card body */}
            <div className="p-3 flex flex-col flex-1 min-w-0">
              {/* Title + status badge */}
              <div className="flex items-start justify-between gap-2 mb-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const url = book.isbn
                      ? `https://book.douban.com/isbn/${book.isbn}`
                      : `https://search.douban.com/book/subject_search?search_text=${encodeURIComponent(book.title)}`
                    void window.app.openExternal(url)
                  }}
                  className="font-semibold text-sm text-gray-900 dark:text-gray-100 line-clamp-2 leading-snug text-left hover:text-blue-600 dark:hover:text-blue-400 hover:underline transition-colors cursor-pointer"
                  title="在豆瓣查看"
                >
                  {book.title}
                </button>
                <button
                  type="button"
                  onClick={() => handleCycleStatus(book)}
                  title={
                    book.status === 'read'    ? '已读 · 点击改为未读' :
                    book.status === 'reading' ? '阅读中 · 点击改为已读' :
                                                '未读 · 点击改为阅读中'
                  }
                  className={`flex-shrink-0 p-0.5 rounded-full mt-0.5 transition-opacity hover:opacity-70 cursor-pointer ${
                    book.status === 'read'    ? 'bg-green-100 text-green-700' :
                    book.status === 'reading' ? 'bg-yellow-100 text-yellow-700' :
                                                'bg-gray-100 text-gray-500'
                  }`}
                >
                  {book.status === 'read' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                    </svg>
                  )}
                  {book.status === 'reading' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                    </svg>
                  )}
                  {book.status !== 'read' && book.status !== 'reading' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                    </svg>
                  )}
                </button>
              </div>

              <p className="text-xs text-gray-600 dark:text-gray-400 mb-0.5 truncate">{book.author}</p>
              {(book.publisher || inferredPublisher) && (
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate" title={book.publisher ?? inferredPublisher ?? ''}>
                  {book.publisher ?? <span className="italic">{inferredPublisher}</span>}
                </p>
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Bottom row */}
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50 dark:border-gray-700">
                {sem && book.isbn ? (
                  <IsbnSemanticBadge isbn={book.isbn} sem={sem} />
                ) : (
                  <span />
                )}
                <button
                  onClick={() => handleDelete(book.id)}
                  title="删除"
                  className="p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19 7-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          )
        })}
      </div>

      {books.length === 0 && !isAdding && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          No books in your library yet. Click "+" to get started!
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// IsbnSemanticBadge — shows language · region, click to copy ISBN to clipboard
// ---------------------------------------------------------------------------

function IsbnSemanticBadge(props: { isbn: string; sem: { language: string; region: string } }) {
  const { isbn, sem } = props
  const [copied, setCopied] = useState<boolean>(false)

  function handleCopy() {
    void navigator.clipboard.writeText(isbn).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? '已复制！' : `点击复制 ISBN：${isbn}`}
      className="text-xs text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors text-left leading-snug"
    >
      {copied ? (
        <span className="text-blue-500">已复制 ✓</span>
      ) : (
        <span>{sem.language} · {sem.region}</span>
      )}
    </button>
  )
}

