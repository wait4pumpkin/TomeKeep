import { useEffect, useState } from 'react'
import type { PriceCacheEntry, PriceChannel, PriceQuote, WishlistItem } from '../../electron/db'
import type { PricingInput } from '../../electron/pricing'
import { AddFormCard } from '../components/AddFormCard'
import { DoubanFillField } from '../components/DoubanFillField'

const channelOrder: PriceChannel[] = ['bookschina', 'jd', 'dangdang']

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

export function Wishlist() {
  const [items, setItems] = useState<WishlistItem[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const [newItem, setNewItem] = useState<Partial<WishlistItem>>({ priority: 'medium' })
  const [priceCache, setPriceCache] = useState<Record<string, PriceCacheEntry>>({})
  const [loadingKeys, setLoadingKeys] = useState<Record<string, boolean>>({})
  const [bookschinaLoggedIn, setBookschinaLoggedIn] = useState<boolean | null>(null)
  const [jdLoggedIn, setJdLoggedIn] = useState<boolean | null>(null)
  const [dangdangLoggedIn, setDangdangLoggedIn] = useState<boolean | null>(null)

  async function refreshLoginStatuses() {
    const [jdStatus, dangdangStatus, bookschinaStatus] = await Promise.all([
      window.stores.getStatus('jd'),
      window.stores.getStatus('dangdang'),
      window.stores.getStatus('bookschina'),
    ])
    setJdLoggedIn(jdStatus.loggedIn)
    setDangdangLoggedIn(dangdangStatus.loggedIn)
    setBookschinaLoggedIn(bookschinaStatus.loggedIn)
  }

  async function openLoginAndPoll(channel: 'jd' | 'dangdang' | 'bookschina') {
    await window.stores.openLogin(channel)
    for (let i = 0; i < 30; i++) {
      await new Promise<void>(r => setTimeout(r, 2000))
      const status = await window.stores.getStatus(channel)
      if (channel === 'jd') setJdLoggedIn(status.loggedIn)
      if (channel === 'dangdang') setDangdangLoggedIn(status.loggedIn)
      if (channel === 'bookschina') setBookschinaLoggedIn(status.loggedIn)
      if (status.loggedIn) break
    }
  }

  async function loadWishlist() {
    const data = await window.db.getWishlist()
    setItems(data)
  }

  useEffect(() => {
    let cancelled = false
    async function init() {
      await refreshLoginStatuses()
      if (cancelled) return

      const data = await window.db.getWishlist()
      if (cancelled) return
      setItems(data)

      const inputs = buildPricingInputsForItems(data)
      const keys = inputs.map(i => i.key)
      if (keys.length === 0) return

      const cached = await window.pricing.get(keys)
      if (cancelled) return
      setPriceCache(prev => ({ ...prev, ...cached }))

      const missingInputs = inputs.filter(i => !cached[i.key])
      if (missingInputs.length > 0) void refreshPrices(missingInputs, false)
    }
    void init()
    return () => {
      cancelled = true
    }
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

    void refreshPrices([buildPricingInput(itemToAdd)], true)
  }

  async function handleDelete(id: string) {
    if (confirm('Remove from wishlist?')) {
      await window.db.deleteWishlistItem(id)
      loadWishlist()
    }
  }

  async function refreshPrices(inputs: PricingInput[], force: boolean) {
    const uniqueInputs = uniquePricingInputs(inputs)
    if (uniqueInputs.length === 0) return

    setLoadingKeys(prev => Object.fromEntries([...Object.entries(prev), ...uniqueInputs.map(i => [i.key, true])]))
    try {
      const res = await window.pricing.refresh(uniqueInputs, { force })
      if (res.ok) setPriceCache(prev => ({ ...prev, ...res.entries }))
    } finally {
      setLoadingKeys(prev => {
        const next = { ...prev }
        for (const i of uniqueInputs) next[i.key] = false
        return next
      })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Wishlist</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void openLoginAndPoll('jd')}
            className="px-4 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors"
          >
            登录京东
          </button>
          <button
            onClick={() => {
              void window.stores.clearCookies('jd').then(() => setJdLoggedIn(false))
            }}
            className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors"
          >
            清除京东登录
          </button>
          {jdLoggedIn !== null && (
            <span className={`text-sm ${jdLoggedIn ? 'text-red-700' : 'text-gray-500'}`}>
              京东：{jdLoggedIn ? '已登录' : '未登录'}
            </span>
          )}

          <button
            onClick={() => void openLoginAndPoll('dangdang')}
            className="px-4 py-2 bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 transition-colors"
          >
            登录当当
          </button>
          <button
            onClick={() => {
              void window.stores.clearCookies('dangdang').then(() => setDangdangLoggedIn(false))
            }}
            className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors"
          >
            清除当当登录
          </button>
          {dangdangLoggedIn !== null && (
            <span className={`text-sm ${dangdangLoggedIn ? 'text-orange-700' : 'text-gray-500'}`}>
              当当：{dangdangLoggedIn ? '已登录' : '未登录'}
            </span>
          )}

          <button
            onClick={() => void openLoginAndPoll('bookschina')}
            className="px-4 py-2 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors"
          >
            登录中图网
          </button>
          <button
            onClick={() => {
              void window.stores.clearCookies('bookschina').then(() => setBookschinaLoggedIn(false))
            }}
            className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors"
          >
            清除中图网登录
          </button>
          {bookschinaLoggedIn !== null && (
            <span className={`text-sm ${bookschinaLoggedIn ? 'text-emerald-700' : 'text-gray-500'}`}>
              中图网：{bookschinaLoggedIn ? '已登录' : '未登录'}
            </span>
          )}
          <button
            onClick={() => void refreshPrices(buildPricingInputsForItems(items), true)}
            className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors"
          >
            刷新全部
          </button>
          <button
            onClick={() => setIsAdding(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Add Item
          </button>
        </div>
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
                loading={isLoadingForItem(loadingKeys, item)}
                onRefresh={() => {
                  void refreshPrices([buildPricingInput(item)], true)
                }}
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

function PricePanel(props: {
  item: WishlistItem
  entry?: PriceCacheEntry
  loading: boolean
  onRefresh: () => void
}) {
  const quotes = getQuotesForRender(props.entry)
  const updatedAt = props.entry?.updatedAt

  return (
    <div className="w-[360px] border border-gray-200 rounded-lg p-3 bg-white">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-gray-700">比价</div>
        <button
          onClick={props.onRefresh}
          className="px-2 py-1 text-xs bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100"
        >
          刷新
        </button>
      </div>

      <div className="space-y-2">
        {channelOrder.map(ch => {
          const quote = quotes.find(q => q.channel === ch)
          const display = getQuoteDisplay(ch, quote, props.loading, props.item)
          return (
            <div key={ch} className="flex items-center justify-between gap-2">
              <span className={`px-2 py-0.5 text-xs rounded border ${channelBadge[ch]}`}>{channelLabel[ch]}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void window.app.openExternal(display.url)}
                  className={`text-sm font-semibold ${display.valueClass} ${display.clickable ? 'hover:underline' : 'cursor-default'}`}
                  disabled={!display.clickable}
                >
                  {display.valueText}
                </button>

                {display.action && (
                  <button
                    onClick={display.action}
                    className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                  >
                    {display.actionLabel}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {updatedAt && <div className="mt-2 text-xs text-gray-400">更新时间：{new Date(updatedAt).toLocaleString()}</div>}
    </div>
  )
}

function getEntryForItem(cache: Record<string, PriceCacheEntry>, item: WishlistItem): PriceCacheEntry | undefined {
  return cache[buildPricingKey(item)]
}

function isLoadingForItem(loading: Record<string, boolean>, item: WishlistItem): boolean {
  return loading[buildPricingKey(item)] === true
}

function getQuotesForRender(entry?: PriceCacheEntry): PriceQuote[] {
  if (!entry?.quotes) return []
  return entry.quotes.filter(q => channelOrder.includes(q.channel))
}

function getQuoteDisplay(
  ch: PriceChannel,
  quote: PriceQuote | undefined,
  loading: boolean,
  item: WishlistItem,
): {
  url: string
  valueText: string
  valueClass: string
  clickable: boolean
  action?: () => void
  actionLabel?: string
} {
  const url = quote?.url ?? buildSearchUrl(ch, item.title)
  if (loading) return { url, valueText: '查询中…', valueClass: 'text-gray-400', clickable: false }
  if (!quote) {
    return {
      url,
      valueText: '—',
      valueClass: 'text-gray-400',
      clickable: false,
      action: () => void window.app.openExternal(url),
      actionLabel: '搜索',
    }
  }

  if (quote.status === 'ok' && typeof quote.priceCny === 'number') {
    return { url, valueText: `¥${quote.priceCny.toFixed(2)}`, valueClass: channelColorText(ch), clickable: true }
  }

  if (quote.status === 'needs_login') {
    return {
      url,
      valueText: '需要登录',
      valueClass: 'text-amber-700',
      clickable: true,
      action: () => void window.stores.openLogin(ch),
      actionLabel: '登录',
    }
  }

  if (quote.status === 'blocked') {
    if (ch === 'bookschina' || ch === 'jd') {
      return {
        url,
        valueText: quote.message ?? '受限',
        valueClass: 'text-amber-700',
        clickable: true,
        action: () => void window.stores.openPage(url),
        actionLabel: '去验证',
      }
    }
    return {
      url,
      valueText: quote.message ?? '受限',
      valueClass: 'text-amber-700',
      clickable: true,
      action: () => void window.app.openExternal(url),
      actionLabel: '打开',
    }
  }

  if (quote.status === 'not_found') {
    return { url, valueText: '未找到', valueClass: 'text-gray-500', clickable: true, action: () => void window.app.openExternal(url), actionLabel: '搜索' }
  }

  return {
    url,
    valueText: quote.message ?? '失败',
    valueClass: 'text-gray-500',
    clickable: true,
    action: () => void window.app.openExternal(url),
    actionLabel: '打开',
  }
}

function channelColorText(ch: PriceChannel): string {
  switch (ch) {
    case 'bookschina':
      return 'text-emerald-700'
    case 'jd':
      return 'text-red-700'
    case 'dangdang':
      return 'text-orange-700'
  }
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
  return { key: buildPricingKey(item), title: item.title, author: item.author, isbn: normalizeIsbn(item.isbn) || undefined }
}

function buildPricingInputsForItems(items: WishlistItem[]): PricingInput[] {
  return uniquePricingInputs(items.map(buildPricingInput))
}

function uniquePricingInputs(inputs: PricingInput[]): PricingInput[] {
  const out: PricingInput[] = []
  const seen = new Set<string>()
  for (const input of inputs) {
    if (!input.key || !input.title) continue
    if (seen.has(input.key)) continue
    seen.add(input.key)
    out.push(input)
  }
  return out
}

function encodeBookschinaStp(input: string): string {
  let out = ''
  for (const ch of input) {
    const code = ch.charCodeAt(0)
    if (code <= 0x7f) out += ch
    else out += `%u${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

function buildSearchUrl(channel: PriceChannel, title: string): string {
  const q = encodeURIComponent(title)
  switch (channel) {
    case 'bookschina':
      return `https://www.bookschina.com/book_find2/?stp=${encodeBookschinaStp(title)}&sCate=0`
    case 'jd':
      return `https://search.jd.com/Search?keyword=${encodeURIComponent(title.trim().startsWith('书') ? title.trim() : `书 ${title.trim()}`)}&wtype=1&enc=utf-8`
    case 'dangdang':
      return `https://search.dangdang.com/?key=${q}&act=input`
  }
}
