import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { PriceCacheEntry, PriceChannel, PriceQuote, WishlistItem } from '../../electron/db'
import type { DoubanSearchHit } from '../../electron/metadata'
import type { CaptureChannel, PricingInput } from '../../electron/pricing'
import { mergeBookDraftWithMetadata } from '../lib/bookMetadataMerge'
import { parseIsbnSemantics as parseIsbnSem, parseIsbnPublisher } from '../lib/isbn'
import { normalizeAuthor } from '../lib/author'
import { tagColor } from '../lib/tagColor'
import { CoverCropModal } from '../components/CoverCropModal'
import { CoverLightbox } from '../components/CoverLightbox'
import { IsbnScanModal } from '../components/IsbnScanModal'
import type { OcrResult } from '../lib/coverOcr'
import { extractCoverText } from '../lib/coverOcr'
import { useLang } from '../lib/i18n'
import type { Lang, DictKey } from '../lib/i18n'

type ViewMode = 'detail' | 'compact'

const channelOrder: PriceChannel[] = ['jd', 'bookschina', 'dangdang']

type WishlistSortKey = 'addedAt' | 'title' | 'author' | 'priority'
type SortDir = 'asc' | 'desc'

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

// Channels that have capture support in this release
const CAPTURE_SUPPORTED: PriceChannel[] = ['jd', 'dangdang', 'bookschina']

export function Wishlist() {
  const { watermarkName } = useOutletContext<{ watermarkName: string | null }>()
  const { t } = useLang()
  const [items, setItems] = useState<WishlistItem[]>([])
  const [inventoryTitles, setInventoryTitles] = useState<Set<string>>(new Set())
  const [addMode, setAddMode] = useState<null | 'manual'>(null)
  const [newItem, setNewItem] = useState<Partial<WishlistItem>>({})
  const [newItemCoverDataUrl, setNewItemCoverDataUrl] = useState<string | null>(null)
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null)
  const [ocrState, setOcrState] = useState<'idle' | 'loading' | 'done'>('idle')
  // Stable ID for the current add-form session — generated once when form opens,
  // reused for both the cover preview download and the final handleAdd call.
  const newItemIdRef = useRef<string>(crypto.randomUUID())

  // Auto-download remote coverUrl to app:// so the preview <img> can display it
  // (Douban CDN requires a Referer header that the renderer can't send directly).
  useEffect(() => {
    const url = newItem.coverUrl
    if (!url || url.startsWith('app://') || url.startsWith('data:')) return
    let cancelled = false
    void window.covers.saveCover(newItemIdRef.current, url).then(appUrl => {
      if (cancelled || !appUrl) return
      setNewItem(prev => prev.coverUrl === url ? { ...prev, coverUrl: appUrl } : prev)
    })
    return () => { cancelled = true }
  }, [newItem.coverUrl])

  // Toast for title navigation failures
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!toastMsg) return
    const timer = setTimeout(() => setToastMsg(null), 2500)
    return () => clearTimeout(timer)
  }, [toastMsg])
  const [priceCache, setPriceCache] = useState<Record<string, PriceCacheEntry>>({})
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [sortKey, setSortKey] = useState<WishlistSortKey>('addedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [searchQuery, setSearchQuery] = useState('')
  // key -> channel -> whether capture window is open
  const [capturingKeys, setCapturingKeys] = useState<Record<string, Record<string, boolean>>>({})

  // View mode — persisted in localStorage
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem('wishlistViewMode') as ViewMode | null) ?? 'detail'
  )
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [gridCols, setGridCols] = useState(4)

  // Dropdown
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Lightbox: show cover full-screen
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  // Clipboard import status
  const [clipStatus, setClipStatus] = useState<{ state: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ state: 'idle' })

  // Douban search-as-you-type state (manual form)
  const [searchHits, setSearchHits] = useState<DoubanSearchHit[]>([])
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [fillState, setFillState] = useState<'idle' | 'loading'>('idle')
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close dropdown on outside click
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

  // Persist viewMode and reset expandedId when it changes
  useEffect(() => {
    localStorage.setItem('wishlistViewMode', viewMode)
    setExpandedId(null)
  }, [viewMode])

  // Measure actual CSS grid column count via ResizeObserver
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const measure = () => {
      const cols = getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length
      setGridCols(cols)
    }
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    return () => obs.disconnect()
  }, [viewMode]) // re-attach when switching to compact (grid is only rendered in compact)

  async function loadWishlist() {
    const data = await window.db.getWishlist()
    setItems(data)
    const tags = await window.db.getAllTags()
    setAllTags(tags)
    return data
  }

  useEffect(() => {
    let cancelled = false
    async function init() {
      const [data, tags, books] = await Promise.all([window.db.getWishlist(), window.db.getAllTags(), window.db.getBooks()])
      if (cancelled) return
      setItems(data)
      setAllTags(tags)
      setInventoryTitles(new Set(books.map(b => b.title.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase())))

      // Load whatever is already cached — no auto-fetch
      const inputs = buildPricingInputsForItems(data)
      const keys = inputs.map(i => i.key)
      if (keys.length === 0) return
      const cached = await window.pricing.get(keys)
      if (cancelled) return
      setPriceCache(prev => ({ ...prev, ...cached }))
    }
    void init()
    return () => { cancelled = true }
  }, [])

  // On startup: repair wishlist items whose coverUrl points to an app:// URL that no
  // longer exists on disk (lost due to async-unlink race during redirect chain).
  useEffect(() => {
    void (async () => {
      const all = await window.db.getWishlist()
      const broken = all.filter(i => i.coverUrl?.startsWith('app://'))
      if (broken.length === 0) return
      const checks = await Promise.all(broken.map(i => window.covers.coverExists(i.coverUrl!)))
      const missing = broken.filter((_, idx) => !checks[idx])
      if (missing.length === 0) return
      console.log('[cover-repair] %d wishlist item(s) with missing cover file(s)', missing.length)
      for (const item of missing) {
        if (!item.isbn) {
          const updated: WishlistItem = { ...item, coverUrl: undefined }
          await window.db.updateWishlistItem(updated)
          setItems(prev => prev.map(i => i.id === item.id ? updated : i))
          continue
        }
        const result = await window.meta.lookupWaterfall(item.isbn)
        if (!result.ok) continue
        const rawCover = result.value.coverUrl
        if (!rawCover || rawCover.startsWith('app://')) continue
        const appUrl = await window.covers.saveCover(item.id, rawCover)
        if (!appUrl) continue
        const updated: WishlistItem = { ...item, coverUrl: appUrl }
        await window.db.updateWishlistItem(updated)
        setItems(prev => prev.map(i => i.id === item.id ? updated : i))
        console.log('[cover-repair] repaired cover for wishlist item "%s"', item.title)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function resetForm() {
    setNewItem({})
    setNewItemCoverDataUrl(null)
    setOcrResult(null)
    setOcrState('idle')
    setSearchHits([])
    setSearchState('idle')
    setFillState('idle')
    setClipStatus({ state: 'idle' })
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    newItemIdRef.current = crypto.randomUUID()
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newItem.title || !newItem.author) return

    const id = newItemIdRef.current

    // Download/save cover to local storage before saving the record
    let coverUrl = newItem.coverUrl
    if (newItemCoverDataUrl) {
      coverUrl = await window.covers.saveCoverData(id, newItemCoverDataUrl) ?? coverUrl
    } else if (coverUrl && !coverUrl.startsWith('app://')) {
      coverUrl = await window.covers.saveCover(id, coverUrl)
    }

    const itemToAdd = {
      ...newItem,
      author: normalizeAuthor(newItem.author ?? ''),
      coverUrl,
      id,
      addedAt: new Date().toISOString(),
    } as WishlistItem

    await window.db.addWishlistItem(itemToAdd)
    resetForm()
    setAddMode(null)
    await loadWishlist()
  }

  async function handleDelete(id: string) {
    if (confirm(t('confirm_remove_wishlist'))) {
      await window.db.deleteWishlistItem(id)
      void loadWishlist()
    }
  }

  async function handleUpdateItemTags(item: WishlistItem, tags: string[]) {
    const updated = { ...item, tags }
    setItems(prev => prev.map(i => i.id === item.id ? updated : i))
    await window.db.updateWishlistItem(updated)
    const newAllTags = await window.db.getAllTags()
    setAllTags(newAllTags)
  }

  async function handleCapture(item: WishlistItem, channel: CaptureChannel) {
    const input = buildPricingInput(item)
    const key = input.key

    setCapturingKeys(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), [channel]: true },
    }))

    try {
      const result = await window.pricing.openCapture({ ...input, channel })
      if (result.ok) {
        // Re-read the updated cache entry from main process
        const updated = await window.pricing.get([key])
        setPriceCache(prev => ({ ...prev, ...updated }))
      }
    } finally {
      setCapturingKeys(prev => ({
        ...prev,
        [key]: { ...(prev[key] ?? {}), [channel]: false },
      }))
    }
  }

  async function handleClipboardImport() {
    setMenuOpen(false)
    setClipStatus({ state: 'loading' })
    let text = ''
    try {
      text = (await navigator.clipboard.readText()).trim()
    } catch {
      setClipStatus({ state: 'error', message: t('clip_perm_error') })
      setAddMode('manual')
      return
    }
    if (!text) {
      setClipStatus({ state: 'error', message: t('clip_empty') })
      setAddMode('manual')
      return
    }

    // Only handle Douban URLs here; plain text falls through to manual form
    const isDouban = /book\.douban\.com\/subject\/\d+/i.test(text)
    if (isDouban) {
      const res = await window.meta.lookupDouban(text)
      if (res.ok) {
        setNewItem(prev => mergeBookDraftWithMetadata(prev, res.value) as Partial<WishlistItem>)
        setClipStatus({ state: 'success', message: t('filled_douban_dot') })
      } else {
        setClipStatus({ state: 'error', message: t('douban_parse_fail_manual') })
      }
      setAddMode('manual')
      return
    }

    // Fallback: treat as title seed and open manual form
    setNewItem(prev => ({ ...prev, title: text }))
    setClipStatus({ state: 'idle' })
    setAddMode('manual')
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
      if (!res.ok) { setSearchState('error'); return }
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
      setNewItem(prev => mergeBookDraftWithMetadata(prev, res.value) as Partial<WishlistItem>)
    } else {
      setNewItem(prev => ({
        ...prev,
        title: prev.title || hit.title,
        author: prev.author || hit.author,
      }))
    }
    setFillState('idle')
  }

  const showForm = addMode === 'manual'

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return items.filter(i => {
      if (tagFilter.length > 0 && !tagFilter.every(t => (i.tags ?? []).includes(t))) return false
      if (!q) return true
      return (
        i.title.toLowerCase().includes(q) ||
        i.author.toLowerCase().includes(q) ||
        (i.isbn ?? '').includes(q)
      )
    })
  }, [items, tagFilter, searchQuery])

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let cmp: number
      if (sortKey === 'priority') {
        cmp = (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1)
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
  }, [filteredItems, sortKey, sortDir])

  // Build interleaved compact render list: item cards + expanded panel inserted after its row
  const compactRenderItems = useMemo(() => {
    if (viewMode !== 'compact') return []
    type RenderItem =
      | { type: 'item'; item: WishlistItem }
      | { type: 'expanded'; item: WishlistItem }

    const result: RenderItem[] = []
    let expandedItem: WishlistItem | null = null
    if (expandedId) expandedItem = sortedItems.find(i => i.id === expandedId) ?? null

    for (let i = 0; i < sortedItems.length; i++) {
      result.push({ type: 'item', item: sortedItems[i] })
      const isRowEnd = (i + 1) % gridCols === 0 || i === sortedItems.length - 1
      if (isRowEnd && expandedItem) {
        const rowStart = i - ((i + 1) % gridCols === 0 ? gridCols - 1 : i % gridCols)
        const rowItems = sortedItems.slice(rowStart, i + 1)
        if (rowItems.some(it => it.id === expandedId)) {
          result.push({ type: 'expanded', item: expandedItem })
        }
      }
    }
    return result
  }, [sortedItems, viewMode, expandedId, gridCols])

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
          {t('page_wishlist')}
          {items.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-400 dark:text-gray-500">
              {filteredItems.length < items.length
                ? <>{filteredItems.length}<span className="opacity-50"> / {items.length}</span></>
                : items.length}
            </span>
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
            title={t('add_to_wishlist')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg z-30 overflow-hidden">
              <button
                type="button"
                onClick={handleClipboardImport}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                </svg>
                 {t('clipboard')}
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setAddMode('manual') }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
                 {t('manual')}
              </button>
            </div>
          )}
          </div>
        </div>
      </div>

      {showForm && (
        <WishlistAddForm
          item={newItem}
          inventoryTitles={inventoryTitles}
          searchHits={searchHits}
          searchState={searchState}
          fillState={fillState}
          clipStatus={clipStatus}
          ocrResult={ocrResult}
          ocrState={ocrState}
          onItemChange={(patch: Partial<WishlistItem>) => {
            setNewItem(prev => {
              const next = { ...prev, ...patch }
              triggerSearch(next.title ?? '', next.author ?? '')
              return next
            })
          }}
          onSelectHit={handleSelectHit}
          onSubmit={handleAdd}
          onCancel={() => { setAddMode(null); resetForm() }}
          coverDataUrl={newItemCoverDataUrl}
          onCoverConfirmed={(dataUrl, ocr) => {
            setNewItemCoverDataUrl(dataUrl)
            if (ocr) {
              setOcrResult(ocr)
              setOcrState('done')
              setNewItem(prev => ({
                ...prev,
                title:     !prev.title     && ocr.title     ? ocr.title     : prev.title,
                author:    !prev.author    && ocr.author    ? ocr.author    : prev.author,
                publisher: !prev.publisher && ocr.publisher ? ocr.publisher : prev.publisher,
              }))
            }
          }}
          onOcrFill={() => {
            if (!newItemCoverDataUrl) return
            setOcrState('loading')
            void extractCoverText(newItemCoverDataUrl).then(ocr => {
              setOcrResult(ocr)
              setOcrState('done')
              setNewItem(prev => ({
                ...prev,
                title:     !prev.title     && ocr.title     ? ocr.title     : prev.title,
                author:    !prev.author    && ocr.author    ? ocr.author    : prev.author,
                publisher: !prev.publisher && ocr.publisher ? ocr.publisher : prev.publisher,
              }))
            })
          }}
        />
      )}

      {/* Search + sort row */}
      <div className="flex items-center gap-2">
        {/* Search input */}
        <div className="relative w-56">
          <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder={t('search_placeholder')}
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

        {/* Sort button group */}
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 shrink-0 overflow-visible">
          {([
            { key: 'title',     label: t('sort_title'),   icon: (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
              </svg>
            ), defaultDir: 'asc' as SortDir },
            { key: 'author',    label: t('sort_author'),  icon: (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            ), defaultDir: 'asc' as SortDir },
            { key: 'addedAt',   label: t('sort_added'),   icon: (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z" />
              </svg>
            ), defaultDir: 'desc' as SortDir },
            { key: 'priority',  label: t('sort_priority'), icon: (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h14.25M3 9h9.75M3 13.5h5.25m5.25-.75L17.25 9m0 0L21 12.75M17.25 9v12" />
              </svg>
            ), defaultDir: 'asc' as SortDir },
          ] as { key: WishlistSortKey; label: string; icon: React.ReactNode; defaultDir: SortDir }[]).map(({ key, label, icon, defaultDir }, idx, arr) => {
            const active = sortKey === key
            const isFirst = idx === 0
            const isLast = idx === arr.length - 1
            return (
              <button
                key={key}
                type="button"
                title={`${label}${active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}`}
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
            )
          })}
        </div>

        {/* View mode toggle */}
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 shrink-0 ml-2">
          <button
            type="button"
            title={t('detail_view')}
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
          <button
            type="button"
            title={t('compact_view')}
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
        </div>
      </div>
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {allTags.map(tag => {
            const active = tagFilter.includes(tag)
            const palette = tagColor(tag)
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
              className="px-2 py-0.5 rounded-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              {t('clear_filter')}
            </button>
          )}
        </div>
      )}

      {/* ── Detail mode grid ── */}
      {viewMode === 'detail' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {sortedItems.map(item => {
            const sem = item.isbn ? parseIsbnSem(item.isbn) : null
            const inferredPublisher = item.isbn && !item.publisher ? parseIsbnPublisher(item.isbn) : null
            return (
              <WishlistCard
                key={item.id}
                item={item}
                sem={sem}
                inferredPublisher={inferredPublisher}
                entry={getEntryForItem(priceCache, item)}
                capturingChannels={capturingKeys[buildPricingKey(item)] ?? {}}
                allTags={allTags}
                onCapture={ch => void handleCapture(item, ch)}
                onTagsChange={tags => handleUpdateItemTags(item, tags)}
                onDelete={() => handleDelete(item.id)}
                 onTitleClick={() => {
                  if (item.isbn) {
                    void window.app.openExternal(`https://openlibrary.org/isbn/${item.isbn}`)
                  } else {
                    setToastMsg(t('toast_no_isbn'))
                  }
                }}
                 onZoom={url => setLightboxUrl(url)}
              />
            )
          })}
        </div>
      )}

      {/* ── Compact mode grid with inline expand ── */}
      {viewMode === 'compact' && (
        <div
          ref={gridRef}
          className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2"
        >
          {compactRenderItems.map((renderItem, idx) => {
            if (renderItem.type === 'expanded') {
              const item = renderItem.item
              const sem = item.isbn ? parseIsbnSem(item.isbn) : null
              const inferredPublisher = item.isbn && !item.publisher ? parseIsbnPublisher(item.isbn) : null
              return (
                <div
                  key={`expanded-${item.id}`}
                  className="col-span-full"
                >
                  <div className="max-w-sm w-full">
                    <WishlistCard
                      item={item}
                      sem={sem}
                      inferredPublisher={inferredPublisher}
                      entry={getEntryForItem(priceCache, item)}
                      capturingChannels={capturingKeys[buildPricingKey(item)] ?? {}}
                      allTags={allTags}
                      onCapture={ch => void handleCapture(item, ch)}
                      onTagsChange={tags => handleUpdateItemTags(item, tags)}
                      onDelete={() => handleDelete(item.id)}
                       onTitleClick={() => {
                        if (item.isbn) {
                          void window.app.openExternal(`https://openlibrary.org/isbn/${item.isbn}`)
                        } else {
                          setToastMsg(t('toast_no_isbn'))
                        }
                      }}
                       onZoom={url => setLightboxUrl(url)}
                    />
                  </div>
                </div>
              )
            }

            // Compact card
            const item = renderItem.item
            const isExpanded = expandedId === item.id
            return (
              <div key={`compact-${item.id}-${idx}`} className="flex flex-col cursor-pointer group">
                {/* Cover */}
                <div
                  className={`aspect-[2/3] bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden relative transition-all ${
                    isExpanded ? 'ring-2 ring-blue-500' : 'hover:ring-2 hover:ring-blue-300'
                  }`}
                  onClick={() => setExpandedId(prev => prev === item.id ? null : item.id)}
                >
                  {item.coverUrl ? (
                    <img src={item.coverUrl} alt={item.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300 dark:text-gray-600">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                      </svg>
                    </div>
                  )}
                </div>
                {/* Title */}
                <button
                  type="button"
                  onClick={() => {
                    if (item.isbn) {
                      void window.app.openExternal(`https://openlibrary.org/isbn/${item.isbn}`)
                    } else {
                      setToastMsg(t('toast_no_isbn'))
                    }
                  }}
                  className="mt-1 text-[11px] text-gray-700 dark:text-gray-300 line-clamp-2 leading-snug text-center hover:text-blue-600 dark:hover:text-blue-400 transition-colors px-0.5"
                  title={item.title}
                >
                  {item.title}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {sortedItems.length === 0 && !addMode && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          {t('empty_wishlist')}
        </div>
      )}

      {lightboxUrl && (
        <CoverLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// WishlistAddForm — compact inline form for adding a wishlist item.
// Identical to ManualAddForm in Inventory except no status segmented control.
// ---------------------------------------------------------------------------

type WishlistAddFormProps = {
  item: Partial<WishlistItem>
  coverDataUrl: string | null
  searchHits: DoubanSearchHit[]
  searchState: 'idle' | 'loading' | 'error'
  fillState: 'idle' | 'loading'
  clipStatus: { state: 'idle' | 'loading' | 'success' | 'error'; message?: string }
  ocrResult: OcrResult | null
  ocrState: 'idle' | 'loading' | 'done'
  inventoryTitles: Set<string>
  onItemChange: (patch: Partial<WishlistItem>) => void
  onCoverConfirmed: (dataUrl: string, ocr?: OcrResult) => void
  onOcrFill: () => void
  onSelectHit: (hit: DoubanSearchHit) => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
}

function WishlistAddForm({ item, coverDataUrl, searchHits, searchState, fillState, clipStatus, ocrResult: _ocrResult, ocrState, inventoryTitles, onItemChange, onCoverConfirmed, onOcrFill, onSelectHit, onSubmit, onCancel }: WishlistAddFormProps) {
  const { t } = useLang()
  const inputCls = 'w-full px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-400'
  const isDuplicateTitle = !!(item.title?.trim()) && inventoryTitles.has(item.title.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase())
  const titleInputCls = isDuplicateTitle
    ? 'w-full px-2 py-1 text-sm font-medium rounded border border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 placeholder-amber-400 dark:placeholder-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-400'
    : 'w-full px-2 py-1 text-sm font-medium rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-400'

  const [cropMode, setCropMode] = useState<'file' | 'camera' | null>(null)
  const [pendingFile, setPendingFile] = useState<File | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isbnScanOpen, setIsbnScanOpen] = useState(false)

  // Single status line: clipboard takes priority, then fill state.
  // Meta-filled confirmation only shows after a clipboard import (clipStatus.state === 'success'),
  // not when fields are filled via manual Douban search-as-you-type.
  const statusLine: { text: string; type: 'info' | 'error' | 'success' | 'loading' } | null =
    clipStatus.state === 'loading' ? { text: t('clip_loading'), type: 'loading' } :
    clipStatus.state === 'error'   ? { text: clipStatus.message ?? t('clip_failed'), type: 'error' } :
    fillState === 'loading'        ? { text: t('douban_loading'), type: 'loading' } :
    ocrState === 'loading'         ? { text: t('ocr_cover_loading'), type: 'loading' } :
    clipStatus.state === 'success' ? { text: clipStatus.message ?? t('filled_douban'), type: 'success' } :
    ocrState === 'done'            ? { text: t('filled_ocr'), type: 'success' } :
    null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-3 max-w-xs">
      <form onSubmit={onSubmit} autoComplete="off">
        {/* Row 1: cover preview + fields */}
        <div className="flex gap-3">
          {/* Cover column: thumbnail with overlaid capture buttons */}
          <div className="flex-shrink-0 self-start">
            <div className="relative w-20 h-[7.5rem] rounded-md bg-gray-100 dark:bg-gray-700 overflow-hidden flex items-center justify-center">
              {(coverDataUrl || item.coverUrl) ? (
                <img src={coverDataUrl ?? item.coverUrl} alt="" className="w-full h-full object-contain" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                </svg>
              )}
              {/* Bottom overlay: file + camera + OCR buttons */}
              <div className="absolute bottom-0 inset-x-0 flex justify-center gap-1 py-1 bg-black/40">
                <button
                  type="button"
                   title={t('choose_cover')}
                  onClick={() => fileInputRef.current?.click()}
                  className="p-0.5 rounded text-white/80 hover:text-white transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                  </svg>
                </button>
                <button
                  type="button"
                   title={t('capture_cover')}
                  onClick={() => setCropMode('camera')}
                  className="p-0.5 rounded text-white/80 hover:text-white transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                  </svg>
                </button>
                {(coverDataUrl || item.coverUrl) && (
                  <button
                    type="button"
                     title={t('recognize_text')}
                    onClick={onOcrFill}
                    className="p-0.5 rounded text-white/80 hover:text-white transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6M9 16h4M5 8h14M5 4h14M3 20l4-4m0 0a7 7 0 1 1 9.9-9.9A7 7 0 0 1 7 16Z" />
                    </svg>
                  </button>
                )}
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
          <div className="flex-1 min-w-0 flex flex-col justify-between h-[7.5rem]">
            {/* Title */}
            <div className="relative">
              <input
                type="text"
                required
                placeholder={t('form_title_placeholder')}
                value={item.title ?? ''}
                onChange={e => onItemChange({ title: e.target.value })}
                className={titleInputCls}
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
              autoComplete="new-password"
              placeholder={t('form_author_placeholder')}
              value={item.author ?? ''}
              onChange={e => onItemChange({ author: e.target.value })}
              className={inputCls}
            />

            {/* Publisher */}
            <input
              type="text"
              placeholder={t('form_publisher_placeholder')}
              value={item.publisher ?? ''}
              onChange={e => onItemChange({ publisher: e.target.value })}
              className={inputCls}
            />

            {/* ISBN with scan button */}
            <div className="flex items-center gap-1">
              <input
                type="text"
                placeholder="ISBN"
                value={item.isbn ?? ''}
                onChange={e => onItemChange({ isbn: e.target.value })}
                className={inputCls}
              />
              <button
                type="button"
                title={t('scan_isbn')}
                onClick={() => setIsbnScanOpen(true)}
                className="shrink-0 p-1 rounded border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 hover:border-blue-400 transition-colors bg-white dark:bg-gray-800"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 19.5h.75v.75h-.75v-.75ZM19.5 13.5h.75v.75h-.75v-.75ZM19.5 19.5h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* CoverCropModal */}
        <CoverCropModal
          isOpen={cropMode !== null}
          onClose={() => { setCropMode(null); setPendingFile(undefined) }}
          onConfirm={(dataUrl, ocr) => { onCoverConfirmed(dataUrl, ocr); setCropMode(null); setPendingFile(undefined) }}
          mode={cropMode ?? 'file'}
          initialFile={pendingFile}
        />

        {/* ISBN scan modal — only fills isbn, no Douban lookup */}
        <IsbnScanModal
          isOpen={isbnScanOpen}
          onClose={() => setIsbnScanOpen(false)}
          mode="single"
          onDetected={raw => { onItemChange({ isbn: raw }); setIsbnScanOpen(false) }}
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

        {/* Actions row — no status control for wishlist */}
        <div className="flex items-center justify-end gap-2 mt-1.5">
          {/* Cancel */}
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t('cancel')}
          </button>

          {/* Save */}
          <button
            type="submit"
            disabled={!item.title || !item.author}
            className="px-2 py-0.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('add')}
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// WishlistCard — compact grid card matching Library layout
// ---------------------------------------------------------------------------

function WishlistCard(props: {
  item: WishlistItem
  sem: { language: string; region: string } | null
  inferredPublisher: string | null
  entry?: PriceCacheEntry
  capturingChannels: Record<string, boolean>
  allTags: string[]
  onCapture: (ch: CaptureChannel) => void
  onTagsChange: (tags: string[]) => void
  onDelete: () => void
  onTitleClick: () => void
  onZoom: (url: string) => void
}) {
  const { item, sem, inferredPublisher, entry, capturingChannels, allTags, onCapture, onTagsChange, onDelete, onTitleClick, onZoom } = props
  const { t } = useLang()
  const [priceOpen, setPriceOpen] = useState(false)
  const quotes = getQuotesForRender(entry)
  const bestPrice = quotes.filter(q => q.status === 'ok' && typeof q.priceCny === 'number')
    .sort((a, b) => (a.priceCny as number) - (b.priceCny as number))[0]

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow flex flex-col group">
      {/* Top: A (cover) + B (text) */}
      <div className="flex flex-row h-28">
        {/* A — Cover */}
        <div className="flex-shrink-0 w-20 self-stretch bg-gray-100 dark:bg-gray-700 flex items-center justify-center rounded-tl-xl overflow-hidden relative">
          {item.coverUrl ? (
            <>
              <img src={item.coverUrl} alt={item.title} className="w-full h-full object-contain" />
              <button
                type="button"
                title={t('view_fullsize')}
                className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70 z-10"
                onClick={e => { e.stopPropagation(); onZoom(item.coverUrl!) }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
              </button>
            </>
          ) : (
            <div className="flex items-center justify-center text-gray-300 dark:text-gray-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
          )}
        </div>

        {/* B — Text & tags */}
        <div className="p-3 flex flex-col flex-1 min-w-0">
          {/* Title */}
          <div className="mb-0.5">
            <button
              type="button"
              onClick={onTitleClick}
              className="font-semibold text-sm text-gray-900 dark:text-gray-100 line-clamp-2 leading-snug text-left hover:text-blue-600 dark:hover:text-blue-400 hover:underline transition-colors"
            >
              {item.title}
            </button>
          </div>

          <p className="text-xs text-gray-600 dark:text-gray-400 mb-0.5 truncate">{item.author}</p>
          {(item.publisher || inferredPublisher) && (
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
              {item.publisher ?? <span className="italic">{inferredPublisher}</span>}
            </p>
          )}

          {/* Tag editor */}
          <WishlistTagEditor
            tags={item.tags ?? []}
            allTags={allTags}
            onChange={onTagsChange}
          />
        </div>
      </div>

      {/* C — Full-width bottom bar: ISBN badge + best price + price toggle + delete */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-gray-100 dark:border-gray-700">
        {sem && item.isbn ? (
          <WishlistIsbnBadge isbn={item.isbn} sem={sem} />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">
          {/* Best price summary */}
          {bestPrice && (
            <button
              onClick={() => void window.app.openExternal(bestPrice.url)}
              className={`text-xs font-semibold ${channelColorText(bestPrice.channel)} hover:underline`}
            >
              ¥{(bestPrice.priceCny as number).toFixed(2)}
            </button>
          )}
          {/* Price toggle */}
          <button
            onClick={() => setPriceOpen(o => !o)}
            title={priceOpen ? t('compare_prices') : t('compare_prices')}
            className={`p-1 rounded transition-colors ${priceOpen ? 'text-blue-500' : 'text-gray-300 hover:text-gray-500 dark:hover:text-gray-300'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </button>
          {/* Delete */}
          <button
            onClick={onDelete}
            title={t('delete')}
            className="p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 7-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Collapsible price panel */}
      {priceOpen && (
        <div className="border-t border-gray-100 dark:border-gray-700 px-3 py-2 space-y-1.5">
          {channelOrder.map(ch => {
            const quote = quotes.find(q => q.channel === ch)
            const isCapturing = capturingChannels[ch] === true
            const supported = CAPTURE_SUPPORTED.includes(ch)
            return (
              <ChannelRow
                key={ch}
                channel={ch}
                quote={quote}
                isCapturing={isCapturing}
                captureSupported={supported}
                onCapture={() => onCapture(ch as CaptureChannel)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ChannelRow
// ---------------------------------------------------------------------------

function ChannelRow(props: {
  channel: PriceChannel
  quote?: PriceQuote
  isCapturing: boolean
  captureSupported: boolean
  onCapture: () => void
}) {
  const { channel, quote, isCapturing, captureSupported, onCapture } = props
  const { lang, t } = useLang()
  const hasPrice = quote?.status === 'ok' && typeof quote.priceCny === 'number'

  return (
    <div className="flex items-center gap-2">
      {/* Channel name */}
      <span className="w-10 text-xs text-gray-400 dark:text-gray-500 shrink-0">
        {t(`channel_${channel}` as DictKey)}
      </span>

      {/* Price / status */}
      <div className="flex-1 flex items-baseline gap-1.5">
        {isCapturing ? (
          <span className="text-xs text-gray-400 dark:text-gray-500 italic">{t('price_fetching')}</span>
        ) : hasPrice ? (
          <>
            <button
              onClick={() => void window.app.openExternal(quote!.url)}
              className={`text-sm font-semibold ${channelColorText(channel)} hover:underline leading-none`}
            >
              ¥{(quote!.priceCny as number).toFixed(2)}
            </button>
            {quote!.fetchedAt && (
              <span className="text-[10px] text-gray-300 dark:text-gray-600 leading-none" title={formatExact(quote!.fetchedAt, lang)}>
                {formatFetchedAt(quote!.fetchedAt, t)}
              </span>
            )}
          </>
        ) : quote ? (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {quote.status === 'not_found' ? t('price_not_found') : (quote.message ?? t('price_failed'))}
          </span>
        ) : (
          <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
        )}
      </div>

      {/* Action button */}
      {captureSupported && !isCapturing && (
        <button
          onClick={onCapture}
          title={hasPrice ? t('reprice') : t('get_price')}
          className="p-1 rounded text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0"
        >
          {hasPrice ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
              <path d="M3 21v-5h5"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
            </svg>
          )}
        </button>
      )}
      {!captureSupported && (
        <span className="text-[10px] text-gray-300 dark:text-gray-600 shrink-0">{t('channel_unsupported')}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function channelColorText(ch: PriceChannel): string {
  switch (ch) {
    case 'bookschina': return 'text-emerald-700'
    case 'jd':         return 'text-red-700'
    case 'dangdang':   return 'text-orange-700'
  }
}

/** Return a human-readable relative time string, e.g. "3 天前" / "3d ago" */
function relativeTime(iso: string, t: (key: DictKey, vars?: Record<string, string | number>) => string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1)  return t('rt_just_now')
  if (minutes < 60) return t('rt_minutes', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24)   return t('rt_hours', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30)    return t('rt_days', { n: days })
  const months = Math.floor(days / 30)
  if (months < 12)  return t('rt_months', { n: months })
  const years = Math.floor(days / 365)
  return t('rt_years', { n: years })
}

function formatExact(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

/** Format an ISO timestamp as a compact relative time */
function formatFetchedAt(iso: string, t: (key: DictKey, vars?: Record<string, string | number>) => string): string {
  return relativeTime(iso, t)
}

function getEntryForItem(cache: Record<string, PriceCacheEntry>, item: WishlistItem): PriceCacheEntry | undefined {
  return cache[buildPricingKey(item)]
}

function getQuotesForRender(entry?: PriceCacheEntry): PriceQuote[] {
  if (!entry?.quotes) return []
  return entry.quotes.filter(q => channelOrder.includes(q.channel))
}

function normalizeIsbn(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[^0-9]/g, '').trim()
}

function normalizeKey(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function buildPricingKey(item: WishlistItem): string {
  return normalizeKey(`${item.title}::${item.author}`)
}

function buildPricingInput(item: WishlistItem): PricingInput {
  return {
    key: buildPricingKey(item),
    title: item.title,
    author: item.author,
    isbn: normalizeIsbn(item.isbn) || undefined,
  }
}

function buildPricingInputsForItems(items: WishlistItem[]): PricingInput[] {
  const out: PricingInput[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const input = buildPricingInput(item)
    if (!input.key || !input.title) continue
    if (seen.has(input.key)) continue
    seen.add(input.key)
    out.push(input)
  }
  return out
}

// ---------------------------------------------------------------------------
// WishlistIsbnBadge — shows language · region, click to copy ISBN to clipboard
// ---------------------------------------------------------------------------

function WishlistIsbnBadge(props: { isbn: string; sem: { language: string; region: string } }) {
  const { isbn, sem } = props
  const { t } = useLang()
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
      title={copied ? t('isbn_copied_tip') : t('isbn_copy_tip', { isbn })}
      className="text-xs text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors text-left mt-1 leading-snug"
    >
      {copied ? (
        <span className="text-blue-500">{t('isbn_copied_badge')}</span>
      ) : (
        <span>{sem.language} · {sem.region}</span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// WishlistTagEditor — inline tag chips with add/remove on a wishlist card.
// ---------------------------------------------------------------------------

function WishlistTagEditor({
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
  const listId = useRef(`wl-tag-list-${Math.random().toString(36).slice(2)}`)
  const { t } = useLang()

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
        title={t('add_tag')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
        </svg>
        {t('tag_label')}
      </button>
    )
  }

  return (
    <div className="mt-1.5 flex flex-wrap gap-1 items-center">
      {tags.map(tag => (
        <span
          key={tag}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border ${tagColor(tag).badge}`}
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity leading-none"
            title={t('remove_tag', { tag })}
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
            placeholder={t('tag_input_placeholder')}
            className="w-20 px-1.5 py-0.5 text-xs rounded-full border border-violet-300 dark:border-violet-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
        </>
      ) : (
        <button
          type="button"
          onClick={() => { setAdding(true); setTimeout(() => inputRef.current?.focus(), 0) }}
          title={t('add_tag')}
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
