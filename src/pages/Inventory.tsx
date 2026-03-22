import { useEffect, useMemo, useRef, useState } from 'react'
import type { Book } from '../../electron/db'
import { AddFormCard } from '../components/AddFormCard'
import { DoubanFillField } from '../components/DoubanFillField'
import { IsbnScanModal } from '../components/IsbnScanModal'
import { parseIsbnSemantics, parseIsbnPublisher, normalizeIsbn, toIsbn13 } from '../lib/isbn'
import { mergeBookDraftWithMetadata } from '../lib/bookMetadataMerge'

export function Inventory() {
  const [books, setBooks] = useState<Book[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Book['status']>('all')

  // add mode: null = closed, 'manual' = form, 'scan-single' | 'scan-batch' = modal
  const [addMode, setAddMode] = useState<null | 'manual' | 'scan-single' | 'scan-batch'>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const [newBook, setNewBook] = useState<Partial<Book>>({ status: 'unread' })
  const [isbnError, setIsbnError] = useState<string | null>(null)
  const [metaStatus, setMetaStatus] = useState<{ state: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({
    state: 'idle',
  })

  // Clipboard import status
  const [clipStatus, setClipStatus] = useState<{ state: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ state: 'idle' })

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  // Clipboard import: detect Douban URL / ISBN / plain text → fill form
  async function handleClipboardImport() {
    setMenuOpen(false)
    setClipStatus({ state: 'loading' })
    let text = ''
    try {
      text = (await navigator.clipboard.readText()).trim()
    } catch {
      setClipStatus({ state: 'error', message: '无法读取剪贴板，请检查权限。' })
      return
    }
    if (!text) {
      setClipStatus({ state: 'error', message: '剪贴板为空。' })
      return
    }

    // Try Douban URL first
    const isDouban = /book\.douban\.com\/subject\/\d+/i.test(text)
    if (isDouban) {
      const res = await window.meta.lookupDouban(text)
      if (res.ok) {
        setNewBook(prev => mergeBookDraftWithMetadata(prev, res.value) as Partial<Book>)
        setClipStatus({ state: 'success', message: '已从豆瓣填充元信息。' })
        setAddMode('manual')
        return
      }
      setClipStatus({ state: 'error', message: '解析豆瓣链接失败，已打开手动录入。' })
      setAddMode('manual')
      return
    }

    // Try ISBN
    const digitsOnly = text.replace(/[^0-9X]/gi, '')
    if (digitsOnly.length === 13 || digitsOnly.length === 10) {
      const normalized = normalizeIsbn(text)
      if (normalized.ok) {
        const isbn13 = toIsbn13(normalized.value)
        if (isbn13) {
          const res = await window.meta.lookupIsbn(isbn13)
          if (res.ok) {
            setNewBook(prev => ({ ...mergeBookDraftWithMetadata(prev, res.value), isbn: isbn13 } as Partial<Book>))
            setClipStatus({ state: 'success', message: '已从 ISBN 填充元信息。' })
            setAddMode('manual')
            return
          }
          // ISBN valid but lookup failed — pre-fill ISBN and open form
          setNewBook(prev => ({ ...prev, isbn: isbn13 }))
          setClipStatus({ state: 'idle' })
          setAddMode('manual')
          return
        }
      }
    }

    // Fallback: treat as title
    setNewBook(prev => ({ ...prev, title: text }))
    setClipStatus({ state: 'idle' })
    setAddMode('manual')
  }

  const filteredBooks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return books.filter(b => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false
      if (!q) return true
      return (
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        (b.isbn ?? '').includes(q)
      )
    })
  }, [books, searchQuery, statusFilter])

  async function loadBooks() {
    const data = await window.db.getBooks()
    setBooks(data)
  }

  useEffect(() => {
    let cancelled = false
    window.db.getBooks().then(data => {
      if (!cancelled) setBooks(data)
    })
    return () => { cancelled = true }
  }, [])

  async function handleAddBook(e: React.FormEvent) {
    e.preventDefault()
    if (!newBook.title || !newBook.author) return

    const id = crypto.randomUUID()

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
    setAddMode(null)
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
      if (result.error === 'empty') { setIsbnError(null); return null }
      setIsbnError(result.error === 'invalid_checksum' ? 'ISBN 校验失败，请重试或手动输入。' : '未识别到有效的 ISBN。')
      return null
    }
    const isbn13 = toIsbn13(result.value)
    if (!isbn13) { setIsbnError('未识别到有效的 ISBN。'); return null }
    setNewBook(prev => ({ ...prev, isbn: isbn13 }))
    setIsbnError(null)
    return isbn13
  }

  // Derived booleans — hoisted out to avoid TypeScript narrowing issues in JSX
  const showManualForm = addMode === 'manual'
  const scanSingleOpen = addMode === 'scan-single'
  const scanBatchOpen = addMode === 'scan-batch'

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">My Library</h2>
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            title="Add Book"
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg z-30 overflow-hidden">
              <button
                type="button"
                onClick={handleClipboardImport}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                </svg>
                剪贴板导入
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setAddMode('scan-single') }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 19.5h.75v.75h-.75v-.75ZM19.5 13.5h.75v.75h-.75v-.75ZM19.5 19.5h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z" />
                </svg>
                ISBN 扫描（单次）
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setAddMode('scan-batch') }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
                </svg>
                ISBN 扫描（连续）
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setAddMode('manual') }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
                手动输入
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Search + status filter bar */}
      <div className="flex items-center gap-2">
        {/* Search input */}
        <div className="relative w-56">
          <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="搜索书名、作者、ISBN…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Status icon tabs */}
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 shrink-0">
          {/* All */}
          <CardTip label="全部">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1.5 rounded-l-lg transition-colors ${
                statusFilter === 'all'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
              </svg>
            </button>
          </CardTip>
          {/* Unread */}
          <CardTip label="未读">
            <button
              type="button"
              onClick={() => setStatusFilter('unread')}
              className={`px-2.5 py-1.5 transition-colors ${
                statusFilter === 'unread'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
              </svg>
            </button>
          </CardTip>
          {/* Reading */}
          <CardTip label="阅读中">
            <button
              type="button"
              onClick={() => setStatusFilter('reading')}
              className={`px-2.5 py-1.5 transition-colors ${
                statusFilter === 'reading'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
              </svg>
            </button>
          </CardTip>
          {/* Read */}
          <CardTip label="已读">
            <button
              type="button"
              onClick={() => setStatusFilter('read')}
              className={`px-2.5 py-1.5 rounded-r-lg transition-colors ${
                statusFilter === 'read'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
              </svg>
            </button>
          </CardTip>
        </div>
      </div>

      {showManualForm && (
        <>
          {clipStatus.state !== 'idle' && (
            <p className={`text-sm px-1 ${clipStatus.state === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
              {clipStatus.state === 'loading' ? '正在从剪贴板导入…' : clipStatus.message}
            </p>
          )}
          <AddFormCard
            title="Add New Book"
            onSubmit={handleAddBook}
            onCancel={() => { setAddMode(null); setNewBook({ status: 'unread' }); setClipStatus({ state: 'idle' }) }}
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
                  onBlur={e => { if (e.target.value) setIsbnFromRaw(e.target.value) }}
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
                  onClick={() => setAddMode('scan-single')}
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
            isOpen={scanSingleOpen}
            onClose={() => setAddMode(null)}
            onDetected={raw => {
              const isbn13 = setIsbnFromRaw(raw)
              if (isbn13) void fillMetadataByIsbn(isbn13)
            }}
          />
        </>
      )}

      {/* Batch scan modal — adds books directly without opening the form */}
      <IsbnScanModal
        isOpen={scanBatchOpen}
        onClose={() => { setAddMode(null); loadBooks() }}
        mode="batch"
        onDetected={raw => {
          void (async () => {
            const normalized = normalizeIsbn(raw)
            if (!normalized.ok) return
            const isbn13 = toIsbn13(normalized.value)
            if (!isbn13) return
            const id = crypto.randomUUID()
            let title = isbn13
            let author = '—'
            let coverUrl: string | undefined
            const res = await window.meta.lookupIsbn(isbn13)
            if (res.ok) {
              title = res.value.title ?? isbn13
              author = res.value.author ?? '—'
              if (res.value.coverUrl) {
                coverUrl = await window.covers.saveCover(id, res.value.coverUrl)
              }
            }
            const book: Book = {
              id,
              title,
              author,
              isbn: isbn13,
              coverUrl,
              status: 'unread',
              addedAt: new Date().toISOString(),
            }
            await window.db.addBook(book)
          })()
        }}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filteredBooks.map(book => {
          const sem = book.isbn ? parseIsbnSemantics(book.isbn) : null
          const inferredPublisher = book.isbn && !book.publisher ? parseIsbnPublisher(book.isbn) : null
          return (
            <div key={book.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow flex flex-row">
              {/* Cover */}
              <div className="flex-shrink-0 w-20 bg-gray-100 dark:bg-gray-700 self-stretch flex items-center justify-center rounded-l-xl overflow-hidden">
                {book.coverUrl ? (
                  <img src={book.coverUrl} alt={book.title} className="w-full h-full object-contain" />
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
                    className="font-semibold text-sm text-gray-900 dark:text-gray-100 line-clamp-2 leading-snug text-left hover:text-blue-600 dark:hover:text-blue-400 hover:underline transition-colors"
                  >
                    {book.title}
                  </button>
                  <CardTip label={
                    book.status === 'read'    ? '已读 · 点击改为未读' :
                    book.status === 'reading' ? '阅读中 · 点击改为已读' :
                                                '未读 · 点击改为阅读中'
                  }>
                    <button
                      type="button"
                      onClick={() => handleCycleStatus(book)}
                      className={`flex-shrink-0 p-0.5 rounded-full mt-0.5 hover:opacity-70 transition-opacity ${
                        book.status === 'read'    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' :
                        book.status === 'reading' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' :
                                                    'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
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
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
                        </svg>
                      )}
                    </button>
                  </CardTip>
                </div>

                <p className="text-xs text-gray-600 dark:text-gray-400 mb-0.5 truncate">{book.author}</p>
                {(book.publisher || inferredPublisher) && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate" title={book.publisher ?? inferredPublisher ?? ''}>
                    {book.publisher ?? <span className="italic">{inferredPublisher}</span>}
                  </p>
                )}

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

      {filteredBooks.length === 0 && !addMode && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          {books.length === 0
            ? 'No books in your library yet. Click "+" to get started!'
            : '没有符合条件的书籍。'}
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
    <CardTip label={copied ? '已复制！' : `点击复制 ISBN：${isbn}`}>
      <button
        type="button"
        onClick={handleCopy}
        className="text-xs text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors text-left leading-snug"
      >
        {copied ? (
          <span className="text-blue-500">已复制 ✓</span>
        ) : (
          <span>{sem.language} · {sem.region}</span>
        )}
      </button>
    </CardTip>
  )
}

// ---------------------------------------------------------------------------
// CardTip — instant custom tooltip, appears immediately on mouseenter.
// ---------------------------------------------------------------------------

function CardTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md text-xs whitespace-nowrap z-50 bg-gray-800 text-white dark:bg-gray-100 dark:text-gray-900 shadow-sm">
          {label}
        </span>
      )}
    </div>
  )
}
