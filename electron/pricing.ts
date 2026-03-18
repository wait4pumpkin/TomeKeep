import { BrowserWindow, ipcMain, session } from 'electron'
import type { StoreChannel } from './stores'
import { getStoresPartition } from './stores'
import { getDb, type PriceCacheEntry, type PriceQuote } from './db'
import {
  encodeBookschinaStp,
  normalizeBooksChinaProductUrl,
  parseBooksChinaOffersFromSearchHtml,
  parseDangdangOffersFromSearchHtml,
  parseJdPricesApiJson,
  parseJdSkusFromSearchHtml,
  pickLowestOffer,
} from '../src/lib/pricing'

type PricingChannel = StoreChannel

export interface PricingInput {
  key: string
  title: string
  author?: string
  isbn?: string
}

type RefreshResult = { ok: true; entries: Record<string, PriceCacheEntry> } | { ok: false; error: 'bad_request' }

const TTL_MS = 24 * 60 * 60 * 1000

const channels: PricingChannel[] = ['bookschina', 'jd', 'dangdang']

export function setupPricing() {
  ipcMain.handle('pricing:get', async (_event, keys: string[]): Promise<Record<string, PriceCacheEntry>> => {
    const db = getDb()
    const out: Record<string, PriceCacheEntry> = {}
    for (const k of keys) {
      const key = normalizeKey(k)
      const entry = db.data.priceCache[key] as PriceCacheEntry | undefined
      if (entry) out[key] = entry
    }
    return out
  })

  ipcMain.handle(
    'pricing:refresh',
    async (_event, inputs: PricingInput[], opts?: { force?: boolean }): Promise<RefreshResult> => {
      if (!Array.isArray(inputs)) return { ok: false, error: 'bad_request' }
      const db = getDb()
      const out: Record<string, PriceCacheEntry> = {}

      for (const input of inputs) {
        if (!input || typeof input !== 'object') continue
        const key = normalizeKey((input as PricingInput).key)
        const title = normalizeTitle((input as PricingInput).title)
        if (!key || !title) continue
        const author = normalizeTitle((input as PricingInput).author)
        const isbn = normalizeIsbn((input as PricingInput).isbn)
        const entry = await refreshKey(db.data.priceCache[key] as PriceCacheEntry | undefined, { key, title, author, isbn }, opts?.force === true)
        db.data.priceCache[key] = entry
        out[key] = entry
      }
      await db.write()
      return { ok: true, entries: out }
    },
  )
}

function normalizeIsbn(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[^0-9]/g, '').trim()
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeKey(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function isExpired(entry: PriceCacheEntry): boolean {
  return Date.now() > new Date(entry.expiresAt).getTime()
}

async function refreshKey(existing: PriceCacheEntry | undefined, input: PricingInput, force: boolean): Promise<PriceCacheEntry> {
  if (!force && existing && !isExpired(existing)) return existing

  const ses = session.fromPartition(getStoresPartition())
  const fetchedAt = new Date().toISOString()

  const quotes = await Promise.all(channels.map(ch => fetchQuoteForChannel(ses, ch, input, fetchedAt)))
  const updatedAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString()
  return { key: input.key, query: { title: input.title, author: input.author, isbn: input.isbn }, quotes, updatedAt, expiresAt }
}

async function fetchQuoteForChannel(
  ses: Electron.Session,
  channel: PricingChannel,
  input: PricingInput,
  fetchedAt: string,
): Promise<PriceQuote> {
  if (channel === 'jd') return await fetchJdQuote(ses, input, fetchedAt)
  if (channel === 'bookschina') return await fetchBooksChinaQuote(ses, input, fetchedAt)
  return await fetchDangdangQuote(ses, input, fetchedAt)
}

function buildSearchUrl(channel: PricingChannel, title: string): string {
  const q = encodeURIComponent(title)
  switch (channel) {
    case 'bookschina':
      return `https://www.bookschina.com/book_find2/?stp=${encodeBookschinaStp(title)}&sCate=0`
    case 'jd':
      return `https://search.jd.com/Search?keyword=${encodeURIComponent(jdKeyword(title))}&wtype=1&enc=utf-8`
    case 'dangdang':
      return `https://search.dangdang.com/?key=${q}&act=input`
  }
}

async function fetchJdQuote(ses: Electron.Session, input: PricingInput, fetchedAt: string): Promise<PriceQuote> {
  const searchUrl = buildSearchUrl('jd', input.title)
  const searchRes = await fetchText(ses, searchUrl, 8000)
  if (!searchRes.ok) return { channel: 'jd', currency: 'CNY', url: searchUrl, fetchedAt, status: searchRes.status, message: searchRes.message }

  if (isJdLoginHtml(searchRes.value)) {
    return { channel: 'jd', currency: 'CNY', url: searchUrl, fetchedAt, status: 'needs_login', message: '需要登录/验证后再查询' }
  }

  let skus = parseJdSkusFromSearchHtml(searchRes.value, 20)
  if (skus.length === 0) {
    if (isJdRiskHtml(searchRes.value)) {
      return { channel: 'jd', currency: 'CNY', url: searchUrl, fetchedAt, status: 'blocked', message: '需要在京东窗口完成验证后再刷新' }
    }
    skus = await renderJdSearchSkus(searchUrl, 20)
    if (skus.length === 0) {
      return { channel: 'jd', currency: 'CNY', url: searchUrl, fetchedAt, status: 'not_found', message: '未解析到商品（可能需要渲染/页面结构变化）' }
    }
  }

  const skuIdsParam = skus.map(s => `J_${encodeURIComponent(s)}`).join(',')
  const priceUrl = `https://p.3.cn/prices/mgets?skuIds=${skuIdsParam}`

  const priceRes = await fetchJson(ses, priceUrl, 8000)
  if (!priceRes.ok) return { channel: 'jd', currency: 'CNY', url: searchUrl, fetchedAt, status: priceRes.status, message: priceRes.message }

  const parsed = parseJdPricesApiJson(priceRes.value)
  if (!parsed.ok) return { channel: 'jd', currency: 'CNY', url: searchUrl, fetchedAt, status: 'error', message: '价格解析失败' }

  let bestSku: string | null = null
  let bestPrice = Number.POSITIVE_INFINITY
  for (const sku of skus) {
    const p = parsed.value[`J_${sku}`]
    if (typeof p !== 'number') continue
    if (p < bestPrice) {
      bestPrice = p
      bestSku = sku
    }
  }
  if (!bestSku || !Number.isFinite(bestPrice)) return { channel: 'jd', currency: 'CNY', url: searchUrl, fetchedAt, status: 'not_found', message: '未找到价格' }

  const productUrl = `https://item.jd.com/${bestSku}.html`
  return { channel: 'jd', currency: 'CNY', url: productUrl, fetchedAt, status: 'ok', priceCny: bestPrice }
}

async function fetchBooksChinaQuote(ses: Electron.Session, input: PricingInput, fetchedAt: string): Promise<PriceQuote> {
  const searchUrl = buildSearchUrl('bookschina', input.title)
  const searchRes = await fetchText(ses, searchUrl, 8000)
  if (!searchRes.ok) {
    return {
      channel: 'bookschina',
      currency: 'CNY',
      url: searchUrl,
      fetchedAt,
      status: searchRes.status,
      message: searchRes.message,
    }
  }

  const offers = parseBooksChinaOffersFromSearchHtml(searchRes.value, 30)
  const best = pickLowestOffer(offers)
  if (!best.ok) return { channel: 'bookschina', currency: 'CNY', url: searchUrl, fetchedAt, status: 'not_found', message: '未找到商品' }
  return {
    channel: 'bookschina',
    currency: 'CNY',
    url: normalizeBooksChinaProductUrl(best.value.url),
    fetchedAt,
    status: 'ok',
    priceCny: best.value.priceCny,
  }
}

async function fetchDangdangQuote(ses: Electron.Session, input: PricingInput, fetchedAt: string): Promise<PriceQuote> {
  const searchUrl = buildSearchUrl('dangdang', input.title)
  const searchRes = await fetchText(ses, searchUrl, 8000)
  if (!searchRes.ok) {
    return { channel: 'dangdang', currency: 'CNY', url: searchUrl, fetchedAt, status: searchRes.status, message: searchRes.message }
  }

  const offers = parseDangdangOffersFromSearchHtml(searchRes.value, 40)
  const best = pickLowestOffer(offers)
  if (!best.ok) return { channel: 'dangdang', currency: 'CNY', url: searchUrl, fetchedAt, status: 'not_found', message: '未找到商品' }
  return { channel: 'dangdang', currency: 'CNY', url: best.value.url, fetchedAt, status: 'ok', priceCny: best.value.priceCny }
}

type FetchFailStatus = 'needs_login' | 'blocked' | 'error'
type FetchResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: FetchFailStatus; message: string }

async function fetchText(ses: Electron.Session, url: string, timeoutMs: number): Promise<FetchResult<string>> {
  const res = await fetchWithTimeout(ses, url, timeoutMs, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
  })
  if (!res.ok) return res
  const text = await res.value.text()

  if (/验证码|robot|访问过于频繁|forbidden/i.test(text)) {
    return { ok: false, status: 'blocked', message: '可能触发验证/限制' }
  }
  return { ok: true, value: text }
}

async function fetchJson(ses: Electron.Session, url: string, timeoutMs: number): Promise<FetchResult<unknown>> {
  const res = await fetchWithTimeout(ses, url, timeoutMs, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
  })
  if (!res.ok) return res
  try {
    const json = (await res.value.json()) as unknown
    return { ok: true, value: json }
  } catch {
    return { ok: false, status: 'error', message: '响应解析失败' }
  }
}

async function fetchWithTimeout(
  ses: Electron.Session,
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<FetchResult<Response>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await ses.fetch(url, { ...init, signal: controller.signal, redirect: 'follow' })
    if (isLoginUrl(res.url)) return { ok: false, status: 'needs_login', message: '需要登录' }
    if (res.status === 401 || res.status === 403) return { ok: false, status: 'blocked', message: '访问被拒绝' }
    if (res.status === 429) return { ok: false, status: 'blocked', message: '请求过于频繁' }
    if (!res.ok) return { ok: false, status: 'error', message: `请求失败(${res.status})` }
    return { ok: true, value: res }
  } catch (e) {
    const name = e instanceof DOMException ? e.name : ''
    if (name === 'AbortError') return { ok: false, status: 'error', message: '请求超时' }
    return { ok: false, status: 'error', message: '网络错误' }
  } finally {
    clearTimeout(timer)
  }
}

function isLoginUrl(url: string): boolean {
  return /passport|login/i.test(url)
}

function jdKeyword(title: string): string {
  const t = title.trim()
  return t.startsWith('书') ? t : `书 ${t}`
}

function isJdLoginHtml(html: string): boolean {
  return html.includes('京东不会以任何理由要求您转账') && (html.includes('密码登录') || html.includes('短信登录') || html.includes('扫码登录'))
}

function isJdRiskHtml(html: string): boolean {
  return /安全验证|完成手机号验证|请完成验证|滑块|验证|风险|网络安全法/i.test(html)
}

async function renderJdSearchSkus(url: string, limit: number): Promise<string[]> {
  let win: BrowserWindow | null = null
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: getStoresPartition(),
        sandbox: true,
      },
    })

    const done = new Promise<string[]>(resolve => {
      const pick = async () => {
        try {
          const skus = await win?.webContents.executeJavaScript(
            `(() => {
              const els = Array.from(document.querySelectorAll('[data-sku]'))
              const out = []
              const seen = new Set()
              for (const el of els) {
                const v = el.getAttribute('data-sku')
                if (!v || seen.has(v)) continue
                seen.add(v)
                out.push(v)
                if (out.length >= ${limit}) break
              }
              return out
            })()`,
            true,
          )
          resolve(Array.isArray(skus) ? (skus as unknown[]).filter(s => typeof s === 'string') as string[] : [])
        } catch {
          resolve([])
        }
      }

      win?.webContents.on('did-finish-load', () => {
        setTimeout(() => void pick(), 1200)
      })
    })

    const timeout = new Promise<string[]>(resolve => setTimeout(() => resolve([]), 10000))
    await win.loadURL(url)
    return await Promise.race([done, timeout])
  } catch {
    return []
  } finally {
    if (win) win.destroy()
  }
}
