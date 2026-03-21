import { useEffect, useState } from 'react'
import type { PriceCacheEntry, PriceChannel, PriceQuote, WishlistItem } from '../../electron/db'
import type { CaptureChannel, PricingInput } from '../../electron/pricing'
import { AddFormCard } from '../components/AddFormCard'
import { DoubanFillField } from '../components/DoubanFillField'

const channelOrder: PriceChannel[] = ['jd', 'bookschina', 'dangdang']

const channelLabel: Record<PriceChannel, string> = {
  bookschina: '中图网',
  jd: '京东',
  dangdang: '当当',
}

const channelBadge: Record<PriceChannel, string> = {
  bookschina: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  jd: 'border-red-200 bg-red-50 text-red-700',
  dangdang: 'border-orange-200 bg-orange-50 text-orange-700',
}

// Channels that have capture support in this release
const CAPTURE_SUPPORTED: PriceChannel[] = ['jd', 'dangdang', 'bookschina']

export function Wishlist() {
  const [items, setItems] = useState<WishlistItem[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const [newItem, setNewItem] = useState<Partial<WishlistItem>>({ priority: 'medium' })
  const [priceCache, setPriceCache] = useState<Record<string, PriceCacheEntry>>({})
  // key -> channel -> whether capture window is open
  const [capturingKeys, setCapturingKeys] = useState<Record<string, Record<string, boolean>>>({})

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

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newItem.title || !newItem.author) return

    const itemToAdd = {
      ...newItem,
      id: crypto.randomUUID(),
      addedAt: new Date().toISOString(),
    } as WishlistItem

    await window.db.addWishlistItem(itemToAdd)
    setNewItem({ priority: 'medium' })
    setIsAdding(false)
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Wishlist</h2>
        <button
          onClick={() => setIsAdding(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Add Item
        </button>
      </div>

      {isAdding && (
        <AddFormCard
          title="Add to Wishlist"
          onSubmit={handleAdd}
          onCancel={() => setIsAdding(false)}
          submitLabel="Save"
          cancelLabel="Cancel"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              required
              value={newItem.title || ''}
              onChange={e => setNewItem({ ...newItem, title: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Author</label>
            <input
              type="text"
              required
              value={newItem.author || ''}
              onChange={e => setNewItem({ ...newItem, author: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ISBN</label>
            <input
              type="text"
              value={newItem.isbn || ''}
              onChange={e => setNewItem({ ...newItem, isbn: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
            <select
              value={newItem.priority}
              onChange={e => setNewItem({ ...newItem, priority: e.target.value as WishlistItem['priority'] })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <DoubanFillField
            onApply={meta => {
              setNewItem(prev => ({
                ...prev,
                isbn: prev.isbn?.trim() ? prev.isbn : meta.isbn13,
                title: prev.title?.trim() ? prev.title : meta.title ?? prev.title,
                author: prev.author?.trim() ? prev.author : meta.author ?? prev.author,
              }))
            }}
          />
        </AddFormCard>
      )}

      <div className="space-y-4">
        {items.map(item => (
          <div
            key={item.id}
            className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex items-start justify-between hover:shadow-md transition-shadow"
          >
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h3 className="font-semibold text-lg text-gray-900">{item.title}</h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  item.priority === 'high' ? 'bg-red-100 text-red-800' :
                  item.priority === 'medium' ? 'bg-blue-100 text-blue-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {item.priority}
                </span>
              </div>
              <p className="text-gray-600">{item.author}</p>
              <p className="text-sm text-gray-400 font-mono mt-1">{item.isbn}</p>
            </div>

            <div className="flex items-start gap-4">
              <PricePanel
                item={item}
                entry={getEntryForItem(priceCache, item)}
                capturingChannels={capturingKeys[buildPricingKey(item)] ?? {}}
                onCapture={ch => void handleCapture(item, ch)}
              />
              <button
                onClick={() => handleDelete(item.id)}
                className="text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {items.length === 0 && !isAdding && (
        <div className="text-center py-12 text-gray-500">
          Your wishlist is empty.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PricePanel
// ---------------------------------------------------------------------------

function PricePanel(props: {
  item: WishlistItem
  entry?: PriceCacheEntry
  capturingChannels: Record<string, boolean>
  onCapture: (ch: CaptureChannel) => void
}) {
  const quotes = getQuotesForRender(props.entry)

  return (
    <div className="w-[380px] border border-gray-200 rounded-lg p-3 bg-white">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-gray-700">比价</div>
      </div>

      <div className="space-y-2">
        {channelOrder.map(ch => {
          const quote = quotes.find(q => q.channel === ch)
          const isCapturing = props.capturingChannels[ch] === true
          const supported = CAPTURE_SUPPORTED.includes(ch)
          return (
            <ChannelRow
              key={ch}
              channel={ch}
              quote={quote}
              isCapturing={isCapturing}
              captureSupported={supported}
              onCapture={() => props.onCapture(ch as CaptureChannel)}
            />
          )
        })}
      </div>
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

  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`px-2 py-0.5 text-xs rounded border flex-shrink-0 ${channelBadge[channel]}`}>
        {channelLabel[channel]}
      </span>

      <div className="flex items-center gap-2 ml-auto">
        {isCapturing ? (
          <span className="text-sm text-gray-400">采价中…</span>
        ) : (
          <div className="flex flex-col items-end">
            <QuoteDisplay channel={channel} quote={quote} />
            {quote?.status === 'ok' && quote.fetchedAt && (
              <span className="text-[10px] text-gray-300 leading-tight">
                {formatFetchedAt(quote.fetchedAt)}
              </span>
            )}
          </div>
        )}

        {captureSupported && !isCapturing && (
          <button
            onClick={onCapture}
            title={quote?.status === 'ok' ? '重新采价' : '去采价'}
            className="p-1 text-gray-400 rounded hover:text-gray-600 hover:bg-gray-100 flex-shrink-0"
          >
            {quote?.status === 'ok' ? (
              // Refresh icon
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                <path d="M3 21v-5h5"/>
              </svg>
            ) : (
              // Search icon
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
            )}
          </button>
        )}

        {!captureSupported && (
          <span className="text-xs text-gray-300">暂未支持</span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// QuoteDisplay: shows price (linked) or error state
// ---------------------------------------------------------------------------

function QuoteDisplay(props: { channel: PriceChannel; quote?: PriceQuote }) {
  const { quote } = props
  if (!quote) {
    return <span className="text-sm text-gray-400">—</span>
  }

  if (quote.status === 'ok' && typeof quote.priceCny === 'number') {
    return (
      <button
        onClick={() => void window.app.openExternal(quote.url)}
        className={`text-sm font-semibold ${channelColorText(props.channel)} hover:underline`}
        title={quote.url}
      >
        ¥{quote.priceCny.toFixed(2)}
      </button>
    )
  }

  // Error / not-found states — show a small open link
  return (
    <span className="text-sm text-gray-400" title={quote.message}>
      {quote.status === 'not_found' ? '未找到' : (quote.message ?? '失败')}
    </span>
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
