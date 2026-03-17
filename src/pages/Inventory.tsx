import { useEffect, useState } from 'react'
import type { Book } from '../../electron/db'
import { AddFormCard } from '../components/AddFormCard'
import { DoubanFillField } from '../components/DoubanFillField'
import { IsbnScanModal } from '../components/IsbnScanModal'
import { normalizeIsbn, toIsbn13 } from '../lib/isbn'
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

    const bookToAdd = {
      ...newBook,
      id: crypto.randomUUID(),
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
        <h2 className="text-2xl font-bold text-gray-800">My Library</h2>
        <button
          onClick={() => setIsAdding(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Add Book
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                required
                value={newBook.title || ''}
                onChange={e => setNewBook({ ...newBook, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Author</label>
              <input
                type="text"
                required
                value={newBook.author || ''}
                onChange={e => setNewBook({ ...newBook, author: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ISBN</label>
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
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    const raw = newBook.isbn ?? ''
                    const isbn13 = setIsbnFromRaw(raw)
                    if (isbn13) void fillMetadataByIsbn(isbn13)
                  }}
                  className="px-3 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:hover:bg-gray-100"
                  disabled={!newBook.isbn}
                >
                  Fill
                </button>
                <button
                  type="button"
                  onClick={() => setIsScanOpen(true)}
                  className="px-3 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Scan
                </button>
              </div>
              {isbnError && <p className="mt-2 text-sm text-red-600">{isbnError}</p>}
              {metaStatus.state !== 'idle' && !isbnError && (
                <p className={`mt-2 text-sm ${metaStatus.state === 'error' ? 'text-red-600' : 'text-gray-600'}`}>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={newBook.status}
                onChange={e => setNewBook({ ...newBook, status: e.target.value as Book['status'] })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {books.map(book => (
          <div key={book.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-semibold text-lg text-gray-900 line-clamp-1" title={book.title}>
                {book.title}
              </h3>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                book.status === 'read' ? 'bg-green-100 text-green-800' :
                book.status === 'reading' ? 'bg-yellow-100 text-yellow-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {book.status}
              </span>
            </div>
            <p className="text-gray-600 mb-4">{book.author}</p>
            <div className="flex justify-between items-center text-sm text-gray-500">
              <span>{book.isbn || 'No ISBN'}</span>
              <button
                onClick={() => handleDelete(book.id)}
                className="text-red-500 hover:text-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      
      {books.length === 0 && !isAdding && (
        <div className="text-center py-12 text-gray-500">
          No books in your library yet. Click "Add Book" to get started!
        </div>
      )}
    </div>
  )
}
