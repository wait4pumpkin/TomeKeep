import { useEffect, useRef, useState } from 'react'
import type { PriceCacheEntry, PriceChannel, PriceQuote, WishlistItem } from '../../electron/db'
import type { DoubanSearchHit } from '../../electron/metadata'
import type { CaptureChannel, PricingInput } from '../../electron/pricing'
import { mergeBookDraftWithMetadata } from '../lib/bookMetadataMerge'
import { parseIsbnSemantics as parseIsbnSem, parseIsbnPublisher } from '../lib/isbn'

const channelOrder: PriceChannel[] = ['jd', 'bookschina', 'dangdang']

const channelLabel: Record<PriceChannel, string> = {
  bookschina: '中图网',
  jd: '京东',
  dangdang: '当当',
}

// Channels that have capture support in this release
const CAPTURE_SUPPORTED: PriceChannel[] = ['jd', 'dangdang', 'bookschina']

export function Wishlist() {
  const [items, setItems] = useState<WishlistItem[]>([])
  const [addMode, setAddMode] = useState<null | 'manual'>(null)
  const [newItem, setNewItem] = useState<Partial<WishlistItem>>({})
  const [priceCache, setPriceCache] = useState<Record<string, PriceCacheEntry>>({})
  // key -> channel -> whether capture window is open
  const [capturingKeys, setCapturingKeys] = useState<Record<string, Record<string, boolean>>>({})

  // Dropdown
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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

  async function loadWishlist() {
    const data = await window.db.getWishlist()
    setItems(data)
    return data
  }

  useEffect(() => {
    let cancelled = false
    async function init() {
      const data = await window.db.getWishlist()
      if (cancelled) return
      setItems(data)

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

  function resetForm() {
    setNewItem({})
    setSearchHits([])
    setSearchState('idle')
    setFillState('idle')
    setClipStatus({ state: 'idle' })
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newItem.title || !newItem.author) return

    const id = crypto.randomUUID()

    // Download cover to local storage before saving the record
    let coverUrl = newItem.coverUrl
    if (coverUrl && !coverUrl.startsWith('app://')) {
      coverUrl = await window.covers.saveCover(id, coverUrl)
    }

    const itemToAdd = {
      ...newItem,
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
    if (confirm('Remove from wishlist?')) {
      await window.db.deleteWishlistItem(id)
      void loadWishlist()
    }
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
      setClipStatus({ state: 'error', message: '无法读取剪贴板，请检查权限。' })
      setAddMode('manual')
      return
    }
    if (!text) {
      setClipStatus({ state: 'error', message: '剪贴板为空。' })
      setAddMode('manual')
      return
    }

    // Only handle Douban URLs here; plain text falls through to manual form
    const isDouban = /book\.douban\.com\/subject\/\d+/i.test(text)
    if (isDouban) {
      const res = await window.meta.lookupDouban(text)
      if (res.ok) {
        setNewItem(prev => mergeBookDraftWithMetadata(prev, res.value) as Partial<WishlistItem>)
        setClipStatus({ state: 'success', message: '已从豆瓣填充元信息。' })
      } else {
        setClipStatus({ state: 'error', message: '解析豆瓣链接失败，请手动填写。' })
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
          Wishlist
          {items.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-400 dark:text-gray-500">{items.length}</span>
          )}
        </h2>
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            title="Add to Wishlist"
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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
                剪贴板导入
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

      {showForm && (
        <WishlistAddForm
          item={newItem}
          searchHits={searchHits}
          searchState={searchState}
          fillState={fillState}
          clipStatus={clipStatus}
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
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {items.map(item => {
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
              onCapture={ch => void handleCapture(item, ch)}
              onDelete={() => handleDelete(item.id)}
            />
          )
        })}
      </div>

      {items.length === 0 && !addMode && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          Your wishlist is empty.
        </div>
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
  searchHits: DoubanSearchHit[]
  searchState: 'idle' | 'loading' | 'error'
  fillState: 'idle' | 'loading'
  clipStatus: { state: 'idle' | 'loading' | 'success' | 'error'; message?: string }
  onItemChange: (patch: Partial<WishlistItem>) => void
  onSelectHit: (hit: DoubanSearchHit) => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
}

function WishlistAddForm({ item, searchHits, searchState, fillState, clipStatus, onItemChange, onSelectHit, onSubmit, onCancel }: WishlistAddFormProps) {
  const inputCls = 'w-full px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500'

  const metaFilled = !!(item.coverUrl || item.isbn || item.publisher)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-3 max-w-xs">
      {/* Clipboard status banner */}
      {clipStatus.state !== 'idle' && (
        <p className={`text-xs mb-2 px-0.5 ${clipStatus.state === 'error' ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
          {clipStatus.state === 'loading' ? '正在从剪贴板导入…' : clipStatus.message}
        </p>
      )}

      <form onSubmit={onSubmit}>
        {/* Row 1: cover preview + fields */}
        <div className="flex gap-3">
          {/* Cover thumbnail */}
          <div className="flex-shrink-0 w-12 h-16 rounded-md bg-gray-100 dark:bg-gray-700 overflow-hidden flex items-center justify-center">
            {item.coverUrl ? (
              <img src={item.coverUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
              </svg>
            )}
          </div>

          {/* Input fields */}
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Title */}
            <div className="relative">
              <input
                type="text"
                required
                placeholder="书名 *"
                value={item.title ?? ''}
                onChange={e => onItemChange({ title: e.target.value })}
                className={inputCls}
                autoFocus
              />
              {/* Search indicator */}
              {searchState === 'loading' && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
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
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-700 last:border-0"
                    >
                      {hit.coverUrl ? (
                        <img src={hit.coverUrl} alt="" className="w-7 h-9 object-cover rounded flex-shrink-0" />
                      ) : (
                        <div className="w-7 h-9 rounded bg-gray-100 dark:bg-gray-700 flex-shrink-0" />
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
              value={item.author ?? ''}
              onChange={e => onItemChange({ author: e.target.value })}
              className={inputCls}
            />
          </div>
        </div>

        {/* Fill loading indicator */}
        {fillState === 'loading' && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 flex items-center gap-1.5">
            <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            正在从豆瓣获取详情…
          </p>
        )}

        {/* Metadata filled confirmation */}
        {metaFilled && fillState === 'idle' && (
          <p className="text-xs text-green-600 dark:text-green-400 mt-2">已从豆瓣填充元信息</p>
        )}

        {/* Actions row — no status control for wishlist */}
        <div className="flex items-center justify-end gap-2 mt-3">
          {/* Cancel */}
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            取消
          </button>

          {/* Save */}
          <button
            type="submit"
            disabled={!item.title || !item.author}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            添加
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
  onCapture: (ch: CaptureChannel) => void
  onDelete: () => void
}) {
  const { item, sem, inferredPublisher, entry, capturingChannels, onCapture, onDelete } = props
  const [priceOpen, setPriceOpen] = useState(false)
  const quotes = getQuotesForRender(entry)
  const bestPrice = quotes.filter(q => q.status === 'ok' && typeof q.priceCny === 'number')
    .sort((a, b) => (a.priceCny as number) - (b.priceCny as number))[0]

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow flex flex-col">
      {/* Top: cover + info */}
      <div className="flex flex-row flex-1">
        {/* Cover */}
        <div className="flex-shrink-0 w-20 bg-gray-100 dark:bg-gray-700 self-stretch flex items-center justify-center rounded-l-xl overflow-hidden">
          {item.coverUrl ? (
            <img src={item.coverUrl} alt={item.title} className="w-full h-full object-contain" />
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
          {/* Title */}
          <div className="mb-0.5">
            <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 line-clamp-2 leading-snug">
              {item.title}
            </span>
          </div>

          <p className="text-xs text-gray-600 dark:text-gray-400 mb-0.5 truncate">{item.author}</p>
          {(item.publisher || inferredPublisher) && (
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
              {item.publisher ?? <span className="italic">{inferredPublisher}</span>}
            </p>
          )}

          <div className="flex-1" />

          {/* Bottom row: ISBN badge + best price + price toggle + delete */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50 dark:border-gray-700 gap-1">
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
                title="比价"
                className={`p-1 rounded transition-colors ${priceOpen ? 'text-blue-500' : 'text-gray-300 hover:text-gray-500 dark:hover:text-gray-300'}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </button>
              {/* Delete */}
              <button
                onClick={onDelete}
                title="移除"
                className="p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19 7-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
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
  const hasPrice = quote?.status === 'ok' && typeof quote.priceCny === 'number'

  return (
    <div className="flex items-center gap-2">
      {/* Channel name */}
      <span className="w-10 text-xs text-gray-400 dark:text-gray-500 shrink-0">
        {channelLabel[channel]}
      </span>

      {/* Price / status */}
      <div className="flex-1 flex items-baseline gap-1.5">
        {isCapturing ? (
          <span className="text-xs text-gray-400 dark:text-gray-500 italic">采价中…</span>
        ) : hasPrice ? (
          <>
            <button
              onClick={() => void window.app.openExternal(quote!.url)}
              className={`text-sm font-semibold ${channelColorText(channel)} hover:underline leading-none`}
            >
              ¥{(quote!.priceCny as number).toFixed(2)}
            </button>
            {quote!.fetchedAt && (
              <span className="text-[10px] text-gray-300 dark:text-gray-600 leading-none">
                {formatFetchedAt(quote!.fetchedAt)}
              </span>
            )}
          </>
        ) : quote ? (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {quote.status === 'not_found' ? '未找到' : (quote.message ?? '失败')}
          </span>
        ) : (
          <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
        )}
      </div>

      {/* Action button */}
      {captureSupported && !isCapturing && (
        <button
          onClick={onCapture}
          title={hasPrice ? '重新采价' : '去采价'}
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
        <span className="text-[10px] text-gray-300 dark:text-gray-600 shrink-0">暂不支持</span>
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

/** Format an ISO timestamp as a compact local date+time, e.g. "3/21 19:30" */
function formatFetchedAt(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  if (sameYear) {
    return d.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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
      className="text-xs text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors text-left mt-1 leading-snug"
    >
      {copied ? (
        <span className="text-blue-500">已复制 ✓</span>
      ) : (
        <span>{sem.language} · {sem.region}</span>
      )}
    </button>
  )
}
