import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { Book, ReadingState, UserProfile } from '../../electron/db'
import type { DoubanSearchHit } from '../../electron/metadata'

type BookStatus = 'unread' | 'reading' | 'read'
type SortKey = 'addedAt' | 'completedAt' | 'title' | 'author'
type SortDir = 'asc' | 'desc'
type ViewMode = 'detail' | 'compact'
import { IsbnScanModal } from '../components/IsbnScanModal'
import { MobileScanPanel } from '../components/MobileScanPanel'
import { CoverCropModal } from '../components/CoverCropModal'
import { parseIsbnSemantics, parseIsbnPublisher, normalizeIsbn, toIsbn13 } from '../lib/isbn'
import { mergeBookDraftWithMetadata } from '../lib/bookMetadataMerge'
import { normalizeAuthor } from '../lib/author'

export function Inventory() {
  const { watermarkName } = useOutletContext<{ watermarkName: string | null }>()
  const [books, setBooks] = useState<Book[]>([])
  // Refs that always hold the latest values without being closure dependencies.
  // Used by the stable onMobileScanDetected callback so the companion server
  // is never restarted (and the session token never rotated) mid-session.
  const booksRef = useRef<Book[]>([])
  const activeUserIdRef = useRef<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | BookStatus>('all')
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  // Per-user reading state: bookId → status (absent = 'unread')
  const [statusMap, setStatusMap] = useState<Map<string, BookStatus>>(new Map())
  const [completedAtMap, setCompletedAtMap] = useState<Map<string, string>>(new Map())
  const [activeUserId, setActiveUserId] = useState<string | null>(null)
  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('addedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // View mode — persisted in localStorage
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem('inventoryViewMode') as ViewMode | null) ?? 'detail'
  )
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  const closingIdRef = useRef<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [gridCols, setGridCols] = useState(4)

  // Inline edit state for expanded compact panel
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ title: string; author: string; publisher: string; doubanUrl: string; coverDataUrl: string }>({ title: '', author: '', publisher: '', doubanUrl: '', coverDataUrl: '' })
  // Cache-bust map: bookId → timestamp. Appended to app:// cover URLs after a local file save
  // so the browser doesn't serve a stale cached image.
  const [coverBustMap, setCoverBustMap] = useState<Map<string, number>>(new Map())

  // add mode: null = closed, 'manual' = form, 'scan-single' | 'scan-batch' = modal
  const [addMode, setAddMode] = useState<null | 'manual' | 'scan-single' | 'scan-batch'>(null)
  const [mobileScanOpen, setMobileScanOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const [newBook, setNewBook] = useState<Partial<Book>>({})
  const [newBookCoverDataUrl, setNewBookCoverDataUrl] = useState<string | null>(null)
  // Stable ID for the current add-form session — generated once when form opens,
  // reused for both the cover preview download and the final commitBook call.
  const newBookIdRef = useRef<string>(crypto.randomUUID())

  // Auto-download remote coverUrl to app:// so the preview <img> can display it
  // (Douban CDN requires a Referer header that the renderer can't send directly).
  useEffect(() => {
    const url = newBook.coverUrl
    if (!url || url.startsWith('app://') || url.startsWith('data:')) return
    let cancelled = false
    void window.covers.saveCover(newBookIdRef.current, url).then(appUrl => {
      if (cancelled || !appUrl) return
      setNewBook(prev => prev.coverUrl === url ? { ...prev, coverUrl: appUrl } : prev)
    })
    return () => { cancelled = true }
  }, [newBook.coverUrl])

  // Toast for title navigation failures
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 2500)
    return () => clearTimeout(t)
  }, [toastMsg])

  // Douban search-as-you-type state (manual form)
  const [searchHits, setSearchHits] = useState<DoubanSearchHit[]>([])
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [fillState, setFillState] = useState<'idle' | 'loading'>('idle')
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clipboard import status
  const [clipStatus, setClipStatus] = useState<{ state: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ state: 'idle' })

  // Persist viewMode and reset expandedId when it changes
  useEffect(() => {
    localStorage.setItem('inventoryViewMode', viewMode)
    setExpandedId(null)
  }, [viewMode])

  // Toggle compact card expand with close animation
  function handleToggleExpand(bookId: string) {
    if (expandedId === bookId) {
      // Closing same book — animate out then remove
      closingIdRef.current = bookId
      setClosingId(bookId)
      setTimeout(() => {
        if (closingIdRef.current === bookId) {
          closingIdRef.current = null
          setClosingId(null)
          setExpandedId(null)
        }
      }, 160)
    } else {
      // Switching to a different book — start exit on old panel and enter on new simultaneously
      if (expandedId) {
        const prev = expandedId
        closingIdRef.current = prev
        setClosingId(prev)
        setTimeout(() => {
          if (closingIdRef.current === prev) {
            closingIdRef.current = null
            setClosingId(null)
          }
        }, 160)
      }
      setExpandedId(bookId)
    }
  }

  // Measure actual CSS grid column count via ResizeObserver
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const measure = () => {
      const computed = getComputedStyle(el).gridTemplateColumns.trim()
      const parts = computed.split(/\s+/)
      setGridCols(parts.length)
    }
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    return () => obs.disconnect()
  }, [viewMode, sortKey]) // re-attach when switching view or sort key (grouped sections swap which element holds the ref)

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
      const status: BookStatus = statusMap.get(b.id) ?? 'unread'
      if (statusFilter !== 'all' && status !== statusFilter) return false
      if (tagFilter.length > 0 && !tagFilter.every(t => (b.tags ?? []).includes(t))) return false
      if (!q) return true
      return (
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        (b.isbn ?? '').includes(q)
      )
    })
  }, [books, searchQuery, statusFilter, tagFilter, statusMap])

  const sortedBooks = useMemo(() => {
    return [...filteredBooks].sort((a, b) => {
      let cmp: number
      if (sortKey === 'completedAt') {
        const va = completedAtMap.get(a.id) ?? ''
        const vb = completedAtMap.get(b.id) ?? ''
        // Books without a completedAt always sort after those that have one
        if (!va && !vb) cmp = 0
        else if (!va) cmp = 1
        else if (!vb) cmp = -1
        else cmp = va.localeCompare(vb)
      } else if (sortKey === 'addedAt') {
        cmp = a.addedAt.localeCompare(b.addedAt)
      } else {
        const va = (sortKey === 'title' ? a.title : a.author).toLowerCase()
        const vb = (sortKey === 'title' ? b.title : b.author).toLowerCase()
        cmp = va.localeCompare(vb, 'zh-CN')
        // Secondary sort: when authors are equal, sort by title
        if (cmp === 0 && sortKey === 'author') {
          cmp = a.title.toLowerCase().localeCompare(b.title.toLowerCase(), 'zh-CN')
        }
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredBooks, sortKey, sortDir, completedAtMap])

  // Group books by year+month when sorting by a time key.
  // Returns flat list when sorting by title/author.
  type BookSection = { year: string; month: string; books: Book[] }
  const groupedSections = useMemo((): BookSection[] | null => {
    if (sortKey !== 'addedAt' && sortKey !== 'completedAt') return null
    const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
    const sections: BookSection[] = []
    let unknownBooks: Book[] = []

    for (const book of sortedBooks) {
      const dateStr = sortKey === 'completedAt' ? completedAtMap.get(book.id) : book.addedAt
      if (!dateStr) {
        unknownBooks.push(book)
        continue
      }
      const d = new Date(dateStr)
      const year = String(d.getFullYear())
      const month = MONTH_NAMES[d.getMonth()]
      const last = sections[sections.length - 1]
      if (last && last.year === year && last.month === month) {
        last.books.push(book)
      } else {
        sections.push({ year, month, books: [book] })
      }
    }
    if (unknownBooks.length > 0) {
      // For completedAt sort these are unfinished books; for addedAt they should never appear here
      sections.push({ year: '未读完', month: '', books: unknownBooks })
    }
    return sections
  }, [sortedBooks, sortKey, completedAtMap])

  // Build interleaved compact render list for a given slice of books
  type CompactRenderItem =
    | { type: 'book'; book: Book }
    | { type: 'expanded'; book: Book; expandedLocalIndex: number }
  function buildCompactItems(booksSlice: Book[]): CompactRenderItem[] {
    const result: CompactRenderItem[] = []
    let expandedBook: Book | null = null
    let expandedLocalIndex = -1
    if (expandedId) {
      expandedLocalIndex = booksSlice.findIndex(b => b.id === expandedId)
      if (expandedLocalIndex !== -1) expandedBook = booksSlice[expandedLocalIndex]
    }
    // Read live column count directly from the DOM so it's always accurate
    const liveCols = gridRef.current
      ? getComputedStyle(gridRef.current).gridTemplateColumns.trim().split(/\s+/).length
      : gridCols
    for (let i = 0; i < booksSlice.length; i++) {
      result.push({ type: 'book', book: booksSlice[i] })
      const isRowEnd = (i + 1) % liveCols === 0 || i === booksSlice.length - 1
      if (isRowEnd && expandedBook) {
        const rowStart = i - ((i + 1) % liveCols === 0 ? liveCols - 1 : i % liveCols)
        const rowBooks = booksSlice.slice(rowStart, i + 1)
        if (rowBooks.some(b => b.id === expandedId)) {
          result.push({ type: 'expanded', book: expandedBook, expandedLocalIndex })
        }
      }
    }
    return result
  }

  // Build interleaved compact render list: book cards + expanded panel inserted after its row
  const compactRenderItems = useMemo(() => {
    if (viewMode !== 'compact') return []
    return buildCompactItems(sortedBooks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedBooks, viewMode, expandedId, gridCols])

  function buildStatusMap(states: ReadingState[]): Map<string, BookStatus> {
    const m = new Map<string, BookStatus>()
    for (const rs of states) m.set(rs.bookId, rs.status)
    return m
  }

  function buildCompletedAtMap(states: ReadingState[]): Map<string, string> {
    const m = new Map<string, string>()
    for (const rs of states) {
      if (rs.completedAt) m.set(rs.bookId, rs.completedAt)
    }
    return m
  }

  async function loadBooks() {
    const data = await window.db.getBooks()
    setBooks(data)
    booksRef.current = data
    const tags = await window.db.getAllTags()
    setAllTags(tags)
  }

  /**
   * Stable callback passed to MobileScanPanel.
   * Uses refs (booksRef, activeUserIdRef) instead of closed-over state so its
   * identity never changes across re-renders — preventing MobileScanPanel from
   * tearing down and restarting the companion server (and rotating the session
   * token) every time commitBook calls loadBooks.
   */
  const onMobileScanDetected = useCallback((raw: string) => {
    void (async () => {
      const ack = (window as unknown as Record<string, unknown>).__mobileScanAck as
        ((isbn: string, hasMetadata: boolean, title?: string) => void) | undefined

      try {
        const normalized = normalizeIsbn(raw)
        if (!normalized.ok) { ack?.(raw, false); return }
        const isbn13 = toIsbn13(normalized.value)
        if (!isbn13) { ack?.(raw, false); return }

        // Use ref so we always see the latest books without this callback changing identity
        const existing = booksRef.current.find(b => b.isbn === isbn13)
        if (existing) { ack?.(isbn13, true, existing.title); return }

        // Try Douban first for richer metadata
        const searchRes = await window.meta.searchDouban(isbn13)
        if (searchRes.ok && searchRes.value.length > 0) {
          const hit = searchRes.value[0]
          const doubanRes = await window.meta.lookupDouban(
            `https://book.douban.com/subject/${hit.subjectId}/`
          )
          if (doubanRes.ok) {
            await commitBookFromRef({ ...doubanRes.value, isbn: isbn13 })
            ack?.(isbn13, true, doubanRes.value.title)
            return
          }
        }

        // Fallback: isbnsearch.org
        const isbnSearchRes = await window.meta.lookupIsbnSearch(isbn13)
        if (isbnSearchRes.ok) {
          const draft = mergeBookDraftWithMetadata({}, isbnSearchRes.value)
          await commitBookFromRef({ ...draft, isbn: isbn13 } as Partial<Book>)
          ack?.(isbn13, true, draft.title)
          return
        }

        // Fallback: OpenLibrary
        const isbnRes = await window.meta.lookupIsbn(isbn13)
        if (isbnRes.ok) {
          const draft = mergeBookDraftWithMetadata({}, isbnRes.value)
          await commitBookFromRef({ ...draft, isbn: isbn13 } as Partial<Book>)
          ack?.(isbn13, true, draft.title)
          return
        }

        // Last resort: save ISBN only (no metadata)
        await commitBookFromRef({ title: isbn13, author: '—', isbn: isbn13 })
        ack?.(isbn13, false)
      } catch {
        ack?.(raw, false)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** commitBook variant that reads activeUserId from ref (for use inside stable callbacks). */
  async function commitBookFromRef(draft: Partial<Book>, initialStatus?: BookStatus) {
    if (!draft.title || !draft.author) return
    const id = draft.id ?? crypto.randomUUID()
    let coverUrl = draft.coverUrl
    if (coverUrl && !coverUrl.startsWith('app://')) {
      coverUrl = await window.covers.saveCover(id, coverUrl)
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { status: _status, ...rest } = draft as Book
    const bookToAdd = {
      ...rest,
      author: normalizeAuthor(draft.author),
      coverUrl,
      id,
      addedAt: draft.addedAt ?? new Date().toISOString(),
    } as Book
    await window.db.addBook(bookToAdd)
    if (activeUserIdRef.current && initialStatus && initialStatus !== 'unread') {
      await window.db.setReadingState({ userId: activeUserIdRef.current, bookId: id, status: initialStatus })
      setStatusMap(prev => new Map(prev).set(id, initialStatus))
    }
    loadBooks()
  }

  async function loadReadingStates(userId: string) {
    const states = await window.db.getReadingStates(userId)
    setStatusMap(buildStatusMap(states))
    setCompletedAtMap(buildCompletedAtMap(states))
  }

  useEffect(() => {
    let cancelled = false
    async function init() {
      const [data, tags, activeUser] = await Promise.all([
        window.db.getBooks(),
        window.db.getAllTags(),
        window.db.getActiveUser(),
      ])
      if (cancelled) return
      setBooks(data)
      booksRef.current = data
      setAllTags(tags)
      if (activeUser) {
        setActiveUserId(activeUser.id)
        activeUserIdRef.current = activeUser.id
        const states = await window.db.getReadingStates(activeUser.id)
        if (!cancelled) {
          setStatusMap(buildStatusMap(states))
          setCompletedAtMap(buildCompletedAtMap(states))
        }
      }
    }
    void init()
    return () => { cancelled = true }
  }, [])

  // Re-load reading states when the active user changes from the sidebar switcher.
  useEffect(() => {
    function handleUserChange(e: Event) {
      const user = (e as CustomEvent<UserProfile | null>).detail
      if (user) {
        setActiveUserId(user.id)
        activeUserIdRef.current = user.id
        void loadReadingStates(user.id)
      } else {
        setActiveUserId(null)
        activeUserIdRef.current = null
        setStatusMap(new Map())
      }
    }
    window.addEventListener('active-user-changed', handleUserChange)
    return () => {
      window.removeEventListener('active-user-changed', handleUserChange)
    }
  }, [])

  function resetManualForm() {
    setNewBook({})
    setNewBookCoverDataUrl(null)
    setSearchHits([])
    setSearchState('idle')
    setFillState('idle')
    setClipStatus({ state: 'idle' })
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    newBookIdRef.current = crypto.randomUUID()
  }

  /** Save a book draft to db, downloading the cover if needed. */
  async function commitBook(draft: Partial<Book>, initialStatus?: BookStatus) {
    if (!draft.title || !draft.author) return
    const id = draft.id ?? crypto.randomUUID()
    let coverUrl = draft.coverUrl
    if (coverUrl && !coverUrl.startsWith('app://')) {
      coverUrl = await window.covers.saveCover(id, coverUrl)
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { status: _status, ...rest } = draft as Book
    const bookToAdd = {
      ...rest,
      author: normalizeAuthor(draft.author),
      coverUrl,
      id,
      addedAt: draft.addedAt ?? new Date().toISOString(),
    } as Book
    await window.db.addBook(bookToAdd)
    // Write a ReadingState only if status is non-default (unread) and there's an active user
    if (activeUserId && initialStatus && initialStatus !== 'unread') {
      await window.db.setReadingState({ userId: activeUserId, bookId: id, status: initialStatus })
      setStatusMap(prev => new Map(prev).set(id, initialStatus))    }
    loadBooks()
  }

  async function handleAddBook(e: React.FormEvent) {
    e.preventDefault()
    if (!newBook.title || !newBook.author) return
    const id = newBookIdRef.current
    let coverUrl = newBook.coverUrl
    if (newBookCoverDataUrl) {
      coverUrl = await window.covers.saveCoverData(id, newBookCoverDataUrl) ?? coverUrl
    } else if (coverUrl && !coverUrl.startsWith('app://')) {
      coverUrl = await window.covers.saveCover(id, coverUrl)
    }
    await commitBook({ ...newBook, id, coverUrl }, newBook.status as BookStatus | undefined)
    resetManualForm()
    setAddMode(null)
  }

  async function handleDelete(id: string) {
    if (confirm('确定要删除这本书吗？')) {
      await window.db.deleteBook(id)
      loadBooks()
    }
  }

  async function handleCycleStatus(book: Book) {
    if (!activeUserId) return
    const current: BookStatus = statusMap.get(book.id) ?? 'unread'
    const next: BookStatus =
      current === 'unread'  ? 'reading' :
      current === 'reading' ? 'read'    : 'unread'
    setStatusMap(prev => new Map(prev).set(book.id, next))
    // Preserve existing completedAt when transitioning → read (only record on first completion)
    const existingCompletedAt = completedAtMap.get(book.id)
    const completedAt = next === 'read'
      ? (existingCompletedAt ?? new Date().toISOString())
      : undefined
    if (next === 'read' && !existingCompletedAt) {
      setCompletedAtMap(prev => new Map(prev).set(book.id, completedAt!))
    } else if (next !== 'read') {
      setCompletedAtMap(prev => { const m = new Map(prev); m.delete(book.id); return m })
    }
    await window.db.setReadingState({ userId: activeUserId, bookId: book.id, status: next, completedAt })
  }

  async function handleClearCompletedAt(book: Book) {
    if (!activeUserId) return
    setCompletedAtMap(prev => { const m = new Map(prev); m.delete(book.id); return m })
    const status = statusMap.get(book.id) ?? 'unread'
    await window.db.setReadingState({ userId: activeUserId, bookId: book.id, status, completedAt: undefined })
  }

  async function handleUpdateBookTags(book: Book, tags: string[]) {
    const updated = { ...book, tags }
    setBooks(prev => prev.map(b => b.id === book.id ? updated : b))
    await window.db.updateBook(updated)
    const newAllTags = await window.db.getAllTags()
    setAllTags(newAllTags)
  }

  async function handleSaveEdit(book: Book) {
    let coverUrl = book.coverUrl
    if (editDraft.coverDataUrl) {
      const saved = await window.covers.saveCoverData(book.id, editDraft.coverDataUrl)
      if (saved) {
        coverUrl = saved
        // Bust the browser's cached image for this book's app:// URL
        setCoverBustMap(prev => new Map(prev).set(book.id, Date.now()))
      }
    }
    const updated: Book = {
      ...book,
      title: editDraft.title.trim() || book.title,
      author: normalizeAuthor(editDraft.author.trim() || book.author),
      publisher: editDraft.publisher.trim() || book.publisher,
      doubanUrl: editDraft.doubanUrl.trim() || undefined,
      coverUrl,
    }
    setBooks(prev => prev.map(b => b.id === book.id ? updated : b))
    booksRef.current = booksRef.current.map(b => b.id === book.id ? updated : b)
    await window.db.updateBook(updated)
    setEditingId(null)
    void loadBooks()
  }

  /** Trigger debounced Douban search based on current title + author fields. */
  function triggerSearch(title: string, author: string) {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    const query = [title, author].filter(Boolean).join(' ').trim()
    if (query.length < 2) {
      setSearchHits([])
      setSearchState('idle')
      return
    }
    setSearchState('loading')
    searchDebounceRef.current = setTimeout(async () => {
      const res = await window.meta.searchDouban(query)
      if (!res.ok) {
        setSearchState('error')
        return
      }
      setSearchHits(res.value)
      setSearchState('idle')
    }, 600)
  }

  /** Select a search hit: fetch full metadata then fill form. */
  async function handleSelectHit(hit: DoubanSearchHit) {
    setSearchHits([])
    setFillState('loading')
    const res = await window.meta.lookupDouban(`https://book.douban.com/subject/${hit.subjectId}/`)
    if (res.ok) {
      setNewBook(prev => mergeBookDraftWithMetadata(prev, res.value) as Partial<Book>)
    } else {
      // Fallback: at least fill title/author from the search hit
      setNewBook(prev => ({
        ...prev,
        title: prev.title || hit.title,
        author: prev.author || hit.author,
      }))
    }
    setFillState('idle')
  }

  // Helper: build a fallback URL for the Douban URL edit-field placeholder (non-navigating)
  function buildDoubanEditPlaceholderUrl(book: Book): string {
    if (book.doubanUrl) return book.doubanUrl
    return book.isbn
      ? `https://book.douban.com/isbn/${book.isbn}`
      : `https://search.douban.com/book/subject_search?search_text=${encodeURIComponent(book.title)}`
  }

  // Title click: prefer doubanUrl, then Open Library by ISBN, else show toast
  function handleBookTitleClick(book: Book) {
    if (book.doubanUrl) {
      void window.app.openExternal(book.doubanUrl)
    } else if (book.isbn) {
      void window.app.openExternal(`https://openlibrary.org/isbn/${book.isbn}`)
    } else {
      setToastMsg('无法跳转：未填写 ISBN')
    }
  }

  // Derived booleans — hoisted out to avoid TypeScript narrowing issues in JSX
  const showManualForm = addMode === 'manual'
  const scanBatchOpen = addMode === 'scan-batch'

  // Shared detail card JSX — used in both detail grid and compact expanded panel
  // Append cache-bust param to app:// cover URLs after a local file save
  function bustCoverUrl(bookId: string, url: string | undefined): string | undefined {
    if (!url) return undefined
    const bust = coverBustMap.get(bookId)
    return bust ? `${url}?t=${bust}` : url
  }

  // When onEdit is provided (compact expanded panel), shows edit/save buttons.
  // When isEditing is true, fields become editable inputs in-place.
  function renderDetailCard(book: Book, extraClass = '', onEdit?: () => void) {
    const sem = book.isbn ? parseIsbnSemantics(book.isbn) : null
    const inferredPublisher = book.isbn && !book.publisher ? parseIsbnPublisher(book.isbn) : null
    const bookStatus: BookStatus = statusMap.get(book.id) ?? 'unread'
    const isEditing = onEdit !== undefined && editingId === book.id
    const displayCoverUrl = bustCoverUrl(book.id, book.coverUrl)
    return (
      <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow flex flex-col ${extraClass}`}>
        {/* Top: A (cover) + B (text) */}
        <div className="flex flex-row h-28 overflow-hidden">
          {/* A — Cover */}
          <div className="flex-shrink-0 w-20 self-stretch bg-gray-100 dark:bg-gray-700 flex items-center justify-center rounded-tl-xl overflow-hidden relative">
            {isEditing ? (
              <>
                {/* Preview: chosen file first, then existing cover, then placeholder */}
                {(editDraft.coverDataUrl || displayCoverUrl) ? (
                  <img
                    src={editDraft.coverDataUrl || displayCoverUrl}
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
                {/* Clickable overlay */}
                <label
                  className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
                  title="更换封面图片"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                  </svg>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = ev => {
                        const result = ev.target?.result
                        if (typeof result === 'string') {
                          setEditDraft(d => ({ ...d, coverDataUrl: result }))
                        }
                      }
                      reader.readAsDataURL(file)
                    }}
                  />
                </label>
              </>
            ) : displayCoverUrl ? (
              <img src={displayCoverUrl} alt={book.title} className="w-full h-full object-contain" />
            ) : (
              <div className="flex items-center justify-center text-gray-300 dark:text-gray-600">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                </svg>
              </div>
            )}
          </div>

          {/* B — Text & actions */}
          <div className="flex flex-col flex-1 min-w-0 p-3 overflow-hidden">
            {/* Title + status badge */}
            <div className="flex items-start justify-between gap-2 mb-0.5">
              {isEditing ? (
                <input
                  type="text"
                  value={editDraft.title}
                  onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                  className="font-semibold text-sm text-gray-800 dark:text-gray-100 leading-snug flex-1 min-w-0 rounded border border-blue-400 px-1 py-px -m-px bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => handleBookTitleClick(book)}
                  className="font-semibold text-sm text-gray-900 dark:text-gray-100 line-clamp-2 leading-snug text-left hover:text-blue-600 dark:hover:text-blue-400 hover:underline transition-colors"
                >
                  {book.title}
                </button>
              )}
              {!isEditing && <CardTip label={
                bookStatus === 'read'    ? '已读 · 点击改为未读' :
                bookStatus === 'reading' ? '阅读中 · 点击改为已读' :
                                           '未读 · 点击改为阅读中'
              }>
                <button
                  type="button"
                  onClick={() => handleCycleStatus(book)}
                  className={`flex-shrink-0 p-0.5 rounded-full mt-0.5 hover:opacity-70 transition-opacity ${
                    bookStatus === 'read'    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' :
                    bookStatus === 'reading' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' :
                                               'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                  }`}
                >
                  {bookStatus === 'read' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                    </svg>
                  )}
                  {bookStatus === 'reading' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                    </svg>
                  )}
                  {bookStatus !== 'read' && bookStatus !== 'reading' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
                    </svg>
                  )}
                </button>
              </CardTip>}
            </div>

            {isEditing ? (
              <div className="flex flex-col gap-0.5 -mx-px">
                <input
                  type="text"
                  value={editDraft.author}
                  onChange={e => setEditDraft(d => ({ ...d, author: e.target.value }))}
                  placeholder="作者"
                  className="text-xs text-gray-800 dark:text-gray-100 rounded border border-blue-400 px-1 py-px bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                />
                <input
                  type="text"
                  value={editDraft.publisher}
                  onChange={e => setEditDraft(d => ({ ...d, publisher: e.target.value }))}
                  placeholder="出版社"
                  className="text-xs text-gray-800 dark:text-gray-100 rounded border border-blue-400 px-1 py-px bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                />
                <input
                  type="url"
                  value={editDraft.doubanUrl}
                  onChange={e => setEditDraft(d => ({ ...d, doubanUrl: e.target.value }))}
                  placeholder={`详情链接（${buildDoubanEditPlaceholderUrl(book)}）`}
                  className="text-xs text-gray-800 dark:text-gray-100 rounded border border-blue-400 px-1 py-px bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                />
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-0.5 truncate">{book.author}</p>
                {(book.publisher || inferredPublisher) && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate" title={book.publisher ?? inferredPublisher ?? ''}>
                    {book.publisher ?? <span className="italic">{inferredPublisher}</span>}
                  </p>
                )}
                {/* Tag editor */}
                <BookTagEditor
                  tags={book.tags ?? []}
                  allTags={allTags}
                  onChange={tags => handleUpdateBookTags(book, tags)}
                />
              </>
            )}
          </div>
        </div>

        {/* C — bottom bar */}
        <div className="flex items-center justify-between px-3 h-8 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3 min-w-0">
            {sem && book.isbn ? (
              <IsbnSemanticBadge isbn={book.isbn} sem={sem} />
            ) : (
              <span />
            )}
            {!isEditing && completedAtMap.get(book.id) && (
              <span className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400 font-medium whitespace-nowrap group/ca">
                <span title={formatExact(completedAtMap.get(book.id)!)}>
                  ✓ {relativeTime(completedAtMap.get(book.id)!)}
                </span>
                <button
                  type="button"
                  onClick={() => handleClearCompletedAt(book)}
                  title="清除完成时间（下次标记已读时重新记录）"
                  className="opacity-0 group-hover/ca:opacity-100 transition-opacity text-green-400 hover:text-red-400 dark:hover:text-red-400 leading-none"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            )}
          </div>
          {isEditing ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSaveEdit(book)}
                className="px-2 py-0.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                保存
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-0.5">
              {onEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  title="编辑"
                  className="p-1 text-gray-300 hover:text-blue-500 rounded transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                  </svg>
                </button>
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
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg pointer-events-none">
          {toastMsg}
        </div>
      )}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
          我的书库
          {books.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-400 dark:text-gray-500">{books.length}</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {watermarkName && watermarkName !== '匿名' && (
            <span className="h-9 flex items-center px-2 text-base font-medium text-gray-400 dark:text-gray-500 select-none">
              {watermarkName}
            </span>
          )}
          <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            title="添加书籍"
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
                剪贴板
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
                ISBN 扫描 - 单次
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setAddMode('scan-batch') }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
                </svg>
                ISBN 扫描 - 批量
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setMobileScanOpen(true) }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 20.25h3" />
                </svg>
                手机扫码
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setAddMode('manual') }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
                 手动
              </button>
            </div>
          )}
          </div>
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
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 shrink-0">          {/* All */}
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

        {/* Sort button group */}
        <div className="ml-auto flex rounded-lg border border-gray-200 dark:border-gray-700 shrink-0 overflow-visible">
          {([
            { key: 'title',       label: '书名',    icon: (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
              </svg>
            ), defaultDir: 'asc' as SortDir },
            { key: 'author',      label: '作者',    icon: (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            ), defaultDir: 'asc' as SortDir },
            { key: 'addedAt',     label: '入库时间', icon: (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z" />
              </svg>
            ), defaultDir: 'desc' as SortDir },
            { key: 'completedAt', label: '完成时间', icon: (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            ), defaultDir: 'desc' as SortDir },
          ] as { key: SortKey; label: string; icon: React.ReactNode; defaultDir: SortDir }[]).map(({ key, label, icon, defaultDir }, idx, arr) => {
            const active = sortKey === key
            const isFirst = idx === 0
            const isLast = idx === arr.length - 1
            return (
              <CardTip key={key} label={`${label}${active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}`}>
                <button
                  type="button"
                  onClick={() => {
                    if (active) {
                      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
                    } else {
                      setSortKey(key)
                      setSortDir(defaultDir)
                    }
                  }}
                  className={`relative px-2.5 py-1.5 transition-colors ${isFirst ? 'rounded-l-lg' : ''} ${isLast ? 'rounded-r-lg' : ''} ${
                    active
                      ? 'bg-blue-500 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {icon}
                  {active && (
                    <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-blue-600 border-2 border-white dark:border-gray-900 flex items-center justify-center text-white z-10" style={{ fontSize: 7 }}>
                      {sortDir === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </button>
              </CardTip>
            )
          })}
        </div>

        {/* View mode toggle */}
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 shrink-0 ml-2">
          <CardTip label="详细视图">
            <button
              type="button"
              onClick={() => setViewMode('detail')}
              className={`px-2.5 py-1.5 rounded-l-lg transition-colors ${
                viewMode === 'detail'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {/* 2×2 grid icon */}
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
              </svg>
            </button>
          </CardTip>
          <CardTip label="简要视图">
            <button
              type="button"
              onClick={() => setViewMode('compact')}
              className={`px-2.5 py-1.5 rounded-r-lg transition-colors ${
                viewMode === 'compact'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {/* 3×3 grid icon */}
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
          </CardTip>
        </div>
      </div>

      {/* Tag filter bar — shown only when there are tags in use */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {allTags.map(tag => {
            const active = tagFilter.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  setTagFilter(prev =>
                    active ? prev.filter(t => t !== tag) : [...prev, tag]
                  )
                }
                className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? 'bg-violet-500 border-violet-500 text-white'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400'
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
              className="px-2 py-0.5 rounded-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              清除筛选
            </button>
          )}
        </div>
      )}

      {showManualForm && (
        <ManualAddForm
          book={newBook}
          searchHits={searchHits}
          searchState={searchState}
          fillState={fillState}
          clipStatus={clipStatus}
          onBookChange={(patch) => {
            setNewBook(prev => {
              const next = { ...prev, ...patch }
              triggerSearch(next.title ?? '', next.author ?? '')
              return next
            })
          }}
          onSelectHit={handleSelectHit}
          onSubmit={handleAddBook}
          onCancel={() => { setAddMode(null); resetManualForm() }}
          coverDataUrl={newBookCoverDataUrl}
          onCoverDataUrl={setNewBookCoverDataUrl}
        />
      )}

      {/* Single scan modal — direct save on Douban hit, form only as fallback */}
      <IsbnScanModal
        isOpen={addMode === 'scan-single'}
        onClose={() => setAddMode(null)}
        mode="single"
        onDetected={raw => {
          void (async () => {
            const normalized = normalizeIsbn(raw)
            if (!normalized.ok) return
            const isbn13 = toIsbn13(normalized.value)
            if (!isbn13) return

            // Try Douban first — on success save directly, no form needed
            const searchRes = await window.meta.searchDouban(isbn13)
            if (searchRes.ok && searchRes.value.length > 0) {
              const hit = searchRes.value[0]
              const doubanRes = await window.meta.lookupDouban(`https://book.douban.com/subject/${hit.subjectId}/`)
                if (doubanRes.ok) {
                setAddMode(null)
                await commitBook({ ...doubanRes.value, isbn: isbn13 })
                return
              }
            }

            // Fallback: open manual form pre-filled with what we have
            resetManualForm()
            const isbnRes = await window.meta.lookupIsbn(isbn13)
            if (isbnRes.ok) {
              setNewBook(prev => ({ ...mergeBookDraftWithMetadata(prev, isbnRes.value), isbn: isbn13 } as Partial<Book>))
            } else {
              setNewBook({ isbn: isbn13 })
            }
            setAddMode('manual')
          })()
        }}
      />

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
            if (books.some(b => b.isbn === isbn13)) return
            const res = await window.meta.lookupIsbn(isbn13)
            await commitBook({
              title: res.ok ? (res.value.title ?? isbn13) : isbn13,
              author: res.ok ? (res.value.author ?? '—') : '—',
              isbn: isbn13,
              coverUrl: res.ok ? res.value.coverUrl : undefined,
            })
          })()
        }}
      />

      {/* Mobile phone scan panel — HTTPS companion server + QR code */}
      {mobileScanOpen && (
        <MobileScanPanel
          onClose={() => { setMobileScanOpen(false); loadBooks() }}
          onDetected={onMobileScanDetected}
          onDeleteEntry={isbn => {
            const book = booksRef.current.find(b => b.isbn === isbn)
            if (book) void handleDelete(book.id)
          }}
        />
      )}

      {/* ── Detail mode grid ── */}
      {viewMode === 'detail' && (
        groupedSections
          ? groupedSections.map((section, si) => {
              const prevSection = si > 0 ? groupedSections[si - 1] : null
              const showYear = !prevSection || prevSection.year !== section.year
              return (
                <div key={`${section.year}-${section.month}`} className="flex flex-col gap-2">
                  {/* Year header — only when year changes */}
                  {showYear && section.year !== '未读完' && (
                    <h2 className="text-base font-semibold text-gray-700 dark:text-gray-200 pt-2 pb-0.5 border-b border-gray-200 dark:border-gray-700">
                      {section.year}年
                    </h2>
                  )}
                  {/* Month sub-header */}
                  {section.month && (
                    <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                      {section.month}
                    </h3>
                  )}
                  {section.year === '未读完' && (
                    <h2 className="text-base font-semibold text-gray-400 dark:text-gray-500 pt-2 pb-0.5 border-b border-gray-200 dark:border-gray-700">
                      未读完
                    </h2>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {section.books.map(book => renderDetailCard(book))}
                  </div>
                </div>
              )
            })
          : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {sortedBooks.map(book => renderDetailCard(book))}
            </div>
          )
      )}

      {/* ── Compact mode grid with inline expand ── */}
      {viewMode === 'compact' && (() => {
        // Helper: render a list of CompactRenderItems into grid cells
        function renderCompactItems(items: CompactRenderItem[]) {
          return items.map((item, idx) => {
            if (item.type === 'expanded') {
              const { book, expandedLocalIndex } = item

              const gap = 8 // gap-2 = 8px
              const gridEl = gridRef.current
              const computedCols = gridEl
                ? getComputedStyle(gridEl).gridTemplateColumns.trim().split(/\s+/)
                : []
              const liveColWidth = computedCols.length > 0 ? parseFloat(computedCols[0]) : 0
              const liveCols = computedCols.length > 0 ? computedCols.length : gridCols
              const colIndex = expandedLocalIndex % liveCols
              const gridTotalWidth = gridEl ? gridEl.getBoundingClientRect().width : 0
              const panelWidth = 320
              const rawSpacer = colIndex * (liveColWidth + gap)
              const spacerPx = Math.min(rawSpacer, Math.max(0, gridTotalWidth - panelWidth))
              return (
                <div
                  key={`expanded-${book.id}`}
                  className={`col-span-full flex ${closingId === book.id ? 'compact-panel-exit' : 'compact-panel-enter'}`}
                >
                  <div className="flex-shrink-0" style={{ width: spacerPx }} />
                  <div className="w-80 flex-shrink-0 pb-2">
                    {renderDetailCard(book, '', () => {
                      setEditDraft({
                        title: book.title,
                        author: book.author,
                        publisher: book.publisher ?? '',
                        doubanUrl: book.doubanUrl ?? '',
                        coverDataUrl: '',
                      })
                      setEditingId(book.id)
                    })}
                  </div>
                </div>
              )
            }
            const book = item.book
            const isExpanded = expandedId === book.id
            return (
              <div key={`compact-${book.id}-${idx}`} className="flex flex-col cursor-pointer group">
                <div
                  className={`aspect-[2/3] bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden relative transition-all ${
                    isExpanded ? 'ring-2 ring-blue-500' : 'hover:ring-2 hover:ring-blue-300'
                  }`}
                  onClick={() => handleToggleExpand(book.id)}
                >
                  {bustCoverUrl(book.id, book.coverUrl) ? (
                    <img src={bustCoverUrl(book.id, book.coverUrl)} alt={book.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300 dark:text-gray-600">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                      </svg>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleBookTitleClick(book)}
                  className="mt-1 text-[11px] text-gray-700 dark:text-gray-300 line-clamp-2 leading-snug text-center hover:text-blue-600 dark:hover:text-blue-400 transition-colors px-0.5"
                  title={book.title}
                >
                  {book.title}
                </button>
              </div>
            )
          })
        }

        if (groupedSections) {
          // Grouped: one sub-grid per section, each with its own headers
          return (
            <div className="flex flex-col gap-4">
              {groupedSections.map((section, si) => {
                const prevSection = si > 0 ? groupedSections[si - 1] : null
                const showYear = !prevSection || prevSection.year !== section.year
                const items = buildCompactItems(section.books)
                return (
                  <div key={`${section.year}-${section.month}`} className="flex flex-col gap-2">
                    {showYear && section.year !== '未读完' && (
                      <h2 className="text-base font-semibold text-gray-700 dark:text-gray-200 pt-1 pb-0.5 border-b border-gray-200 dark:border-gray-700">
                        {section.year}年
                      </h2>
                    )}
                    {section.month && (
                      <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                        {section.month}
                      </h3>
                    )}
                    {section.year === '未读完' && (
                      <h2 className="text-base font-semibold text-gray-400 dark:text-gray-500 pt-1 pb-0.5 border-b border-gray-200 dark:border-gray-700">
                        未读完
                      </h2>
                    )}
                    <div ref={si === 0 ? gridRef : undefined} className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
                      {renderCompactItems(items)}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        }

        // Flat (title/author sort)
        return (
          <div ref={gridRef} className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
            {renderCompactItems(compactRenderItems)}
          </div>
        )
      })()}

      {sortedBooks.length === 0 && !addMode && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          {books.length === 0
            ? '书库还是空的，点击 "+" 开始添加吧！'
            : '没有符合条件的书籍。'}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ManualAddForm — compact inline form for manually adding a book.
// Debounces title+author input → searches Douban → select to auto-fill.
// ---------------------------------------------------------------------------

type ManualAddFormProps = {
  book: Partial<Book>
  coverDataUrl: string | null
  searchHits: DoubanSearchHit[]
  searchState: 'idle' | 'loading' | 'error'
  fillState: 'idle' | 'loading'
  clipStatus: { state: 'idle' | 'loading' | 'success' | 'error'; message?: string }
  onBookChange: (patch: Partial<Book>) => void
  onCoverDataUrl: (dataUrl: string) => void
  onSelectHit: (hit: DoubanSearchHit) => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
}

function ManualAddForm({ book, coverDataUrl, searchHits, searchState, fillState, clipStatus, onBookChange, onCoverDataUrl, onSelectHit, onSubmit, onCancel }: ManualAddFormProps) {
  const inputCls = 'w-full px-1 py-px text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-400'

  const [cropMode, setCropMode] = useState<'file' | 'camera' | null>(null)
  const [pendingFile, setPendingFile] = useState<File | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const statusOptions: { value: BookStatus; label: string }[] = [
    { value: 'unread', label: '未读' },
    { value: 'reading', label: '在读' },
    { value: 'read', label: '已读' },
  ]

  // Single status line: clipboard takes priority, then fill state.
  // Meta-filled confirmation only shows after a clipboard import (clipStatus.state === 'success'),
  // not when fields are filled via manual Douban search-as-you-type.
  const statusLine: { text: string; type: 'info' | 'error' | 'success' | 'loading' } | null =
    clipStatus.state === 'loading' ? { text: '正在从剪贴板导入…', type: 'loading' } :
    clipStatus.state === 'error'   ? { text: clipStatus.message ?? '导入失败', type: 'error' } :
    fillState === 'loading'        ? { text: '正在从豆瓣获取详情…', type: 'loading' } :
    clipStatus.state === 'success' ? { text: clipStatus.message ?? '已从豆瓣填充元信息', type: 'success' } :
    null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-3 max-w-xs">
      <form onSubmit={onSubmit}>
        {/* Row 1: cover preview + fields */}
        <div className="flex gap-3">
          {/* Cover column: thumbnail with overlaid capture buttons */}
          <div className="flex-shrink-0 self-start">
            <div className="relative w-12 h-[4.5rem] rounded-md bg-gray-100 dark:bg-gray-700 overflow-hidden flex items-center justify-center">
              {(coverDataUrl || book.coverUrl) ? (
                <img src={coverDataUrl ?? book.coverUrl} alt="" className="w-full h-full object-contain" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                </svg>
              )}
              {/* Bottom overlay: file + camera buttons */}
              <div className="absolute bottom-0 inset-x-0 flex justify-center gap-1 py-1 bg-black/40">
                <button
                  type="button"
                  title="从文件选择封面"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-0.5 rounded text-white/80 hover:text-white transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                  </svg>
                </button>
                <button
                  type="button"
                  title="拍摄封面"
                  onClick={() => setCropMode('camera')}
                  className="p-0.5 rounded text-white/80 hover:text-white transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                  </svg>
                </button>
              </div>
            </div>
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={e => {
                const file = e.target.files?.[0]
                if (!file) return
                setPendingFile(file)
                setCropMode('file')
                e.target.value = ''
              }}
            />
          </div>

          {/* Input fields */}
          <div className="flex-1 min-w-0 space-y-1">
            {/* Title */}
            <div className="relative">
              <input
                type="text"
                required
                placeholder="书名 *"
                value={book.title ?? ''}
                onChange={e => onBookChange({ title: e.target.value })}
                className={inputCls}
                autoFocus
              />
              {/* Search indicator */}
              {searchState === 'loading' && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                </span>
              )}

              {/* Search results dropdown */}
              {searchHits.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-0.5 z-40 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden">
                  {searchHits.map(hit => (
                    <button
                      key={hit.subjectId}
                      type="button"
                      onClick={() => onSelectHit(hit)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-700 last:border-0"
                    >
                      {hit.coverUrl ? (
                        <img src={hit.coverUrl} alt="" className="w-6 h-8 object-cover rounded flex-shrink-0" />
                      ) : (
                        <div className="w-6 h-8 rounded bg-gray-100 dark:bg-gray-700 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm text-gray-900 dark:text-gray-100 truncate leading-snug">{hit.title}</p>
                        {hit.author && <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{hit.author}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Author */}
            <input
              type="text"
              required
              placeholder="作者 *"
              value={book.author ?? ''}
              onChange={e => onBookChange({ author: e.target.value })}
              className={inputCls}
            />

            {/* Publisher */}
            <input
              type="text"
              placeholder="出版社"
              value={book.publisher ?? ''}
              onChange={e => onBookChange({ publisher: e.target.value })}
              className={inputCls}
            />

            {/* ISBN */}
            <input
              type="text"
              placeholder="ISBN"
              value={book.isbn ?? ''}
              onChange={e => onBookChange({ isbn: e.target.value })}
              className={inputCls}
            />
          </div>
        </div>

        {/* CoverCropModal */}
        <CoverCropModal
          isOpen={cropMode !== null}
          onClose={() => { setCropMode(null); setPendingFile(undefined) }}
          onConfirm={dataUrl => { onCoverDataUrl(dataUrl); setCropMode(null); setPendingFile(undefined) }}
          mode={cropMode ?? 'file'}
          initialFile={pendingFile}
        />

        {/* Status line — above actions */}
        {statusLine && (
          <p className={`text-xs mt-2 flex items-center gap-1.5 ${
            statusLine.type === 'error'   ? 'text-red-500 dark:text-red-400' :
            statusLine.type === 'success' ? 'text-green-600 dark:text-green-400' :
                                            'text-gray-400 dark:text-gray-500'
          }`}>
            {statusLine.type === 'loading' && (
              <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            {statusLine.text}
          </p>
        )}

        {/* Row 2: status + actions */}
        <div className="flex items-center gap-2 mt-1.5">
          {/* Status segmented control */}
          <div className="flex rounded border border-gray-200 dark:border-gray-700 overflow-hidden shrink-0">
            {statusOptions.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onBookChange({ status: opt.value })}
                className={`px-2 py-0.5 text-xs transition-colors ${
                  (book.status ?? 'unread') === opt.value
                    ? 'bg-blue-500 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Cancel */}
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            取消
          </button>

          {/* Save */}
          <button
            type="submit"
            disabled={!book.title || !book.author}
            className="px-2 py-0.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            添加
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// relativeTime — human-readable relative timestamp, e.g. "3 天前"
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1)  return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)   return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30)    return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12)  return `${months} 个月前`
  const years = Math.floor(days / 365)
  return `${years} 年前`
}

function formatExact(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
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

// ---------------------------------------------------------------------------
// BookTagEditor — inline tag chips with add/remove on a book card.
// ---------------------------------------------------------------------------

function BookTagEditor({
  tags,
  allTags,
  onChange,
}: {
  tags: string[]
  allTags: string[]
  onChange: (tags: string[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useRef(`tag-list-${Math.random().toString(36).slice(2)}`)

  function commitInput() {
    const trimmed = inputValue.trim()
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed])
    }
    setInputValue('')
    setAdding(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitInput()
    } else if (e.key === 'Escape') {
      setInputValue('')
      setAdding(false)
    }
  }

  function removeTag(tag: string) {
    onChange(tags.filter(t => t !== tag))
  }

  const suggestions = allTags.filter(t => !tags.includes(t))

  if (tags.length === 0 && !adding) {
    return (
      <button
        type="button"
        onClick={() => { setAdding(true); setTimeout(() => inputRef.current?.focus(), 0) }}
        className="mt-1.5 text-xs text-gray-300 dark:text-gray-600 hover:text-violet-400 dark:hover:text-violet-500 transition-colors flex items-center gap-0.5"
        title="添加标签"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
        </svg>
        标签
      </button>
    )
  }

  return (
    <div className="mt-1.5 flex flex-wrap gap-1 items-center">
      {tags.map(tag => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-700"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="ml-0.5 text-violet-400 hover:text-violet-700 dark:hover:text-violet-100 transition-colors leading-none"
            title={`移除标签 ${tag}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
      {adding ? (
        <>
          <datalist id={listId.current}>
            {suggestions.map(s => <option key={s} value={s} />)}
          </datalist>
          <input
            ref={inputRef}
            type="text"
            list={listId.current}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitInput}
            placeholder="输入标签…"
            className="w-20 px-1.5 py-0.5 text-xs rounded-full border border-violet-300 dark:border-violet-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
        </>
      ) : (
        <button
          type="button"
          onClick={() => { setAdding(true); setTimeout(() => inputRef.current?.focus(), 0) }}
          title="添加标签"
          className="w-5 h-5 flex items-center justify-center rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-300 dark:text-gray-600 hover:border-violet-400 hover:text-violet-400 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}
    </div>
  )
}
