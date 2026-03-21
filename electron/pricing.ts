import { BrowserWindow, ipcMain } from 'electron'
import { encode as iconvEncode } from 'iconv-lite'
import type { StoreChannel } from './stores'
import { getStoresPartition } from './stores'
import { getDb, type PriceCacheEntry, type PriceQuote } from './db'
import { resolveCapturePreloadPath } from './preloadPath'
import type { CapturePayload } from './capture-preload'

export type CaptureChannel = Extract<StoreChannel, 'jd' | 'dangdang' | 'bookschina'>

export interface PricingInput {
  key: string
  title: string
  author?: string
  isbn?: string
}

export type OpenCaptureResult =
  | { ok: true; quote: PriceQuote }
  | { ok: false; reason: 'cancelled' | 'error' | 'bad_request' }

const TTL_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Channel search URL builders
// ---------------------------------------------------------------------------

function buildJdSearchUrl(title: string): string {
  const t = title.trim()
  const keyword = t.startsWith('书') ? t : `书 ${t}`
  return `https://search.jd.com/Search?keyword=${encodeURIComponent(keyword)}&wtype=1&enc=utf-8`
}

function buildDangdangSearchUrl(title: string): string {
  const t = title.trim()
  // Dangdang's search backend expects GBK-encoded percent-encoding.
  // Using UTF-8 (encodeURIComponent) results in mojibake in the search box
  // and an empty result list.
  const gbkBuf: Buffer = iconvEncode(t, 'GBK')
  const pct = Array.from(gbkBuf as Uint8Array)
    .map((b: number) => '%' + b.toString(16).toUpperCase().padStart(2, '0'))
    .join('')
  return `https://search.dangdang.com/?key=${pct}&act=input&category_path=01.00.00.00.00.00&medium=01&type=01.00.00.00.00.00`
}

function buildBooksChinaSearchUrl(title: string): string {
  const t = title.trim()
  // BooksChina search uses JS escape()-style encoding (%uXXXX for non-ASCII).
  // sCate=1 scopes the search to book title.
  let stp = ''
  for (const ch of t) {
    const code = ch.charCodeAt(0)
    if (code <= 0x7f) stp += ch
    else stp += '%u' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return `https://www.bookschina.com/book_find2/?stp=${stp}&sCate=1`
}

function buildSearchUrl(channel: CaptureChannel, title: string): string {
  switch (channel) {
    case 'jd': return buildJdSearchUrl(title)
    case 'dangdang': return buildDangdangSearchUrl(title)
    case 'bookschina': return buildBooksChinaSearchUrl(title)
  }
}

// ---------------------------------------------------------------------------
// Allowed product-page host per channel (for URL validation)
// ---------------------------------------------------------------------------

const ALLOWED_PRODUCT_HOSTS: Record<CaptureChannel, RegExp> = {
  jd: /^item\.jd\.com$/,
  dangdang: /^product\.dangdang\.com$/,
  bookschina: /^(?:www|m)\.bookschina\.com$/,
}

function isAllowedProductUrl(channel: CaptureChannel, url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return ALLOWED_PRODUCT_HOSTS[channel].test(host)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

function validateCapturePayload(
  raw: unknown,
  expectedChannel: CaptureChannel,
): { ok: true; payload: CapturePayload } | { ok: false } {
  if (typeof raw !== 'object' || raw === null) return { ok: false }
  const p = raw as Record<string, unknown>
  if (p.channel !== expectedChannel) return { ok: false }
  if (typeof p.url !== 'string' || !isAllowedProductUrl(expectedChannel, p.url)) return { ok: false }
  const price = typeof p.priceCny === 'number' ? p.priceCny : parseFloat(String(p.priceCny))
  if (!isFinite(price) || price <= 0) return { ok: false }
  return { ok: true, payload: { channel: expectedChannel, url: p.url, priceCny: price } }
}

// ---------------------------------------------------------------------------
// Capture window
// ---------------------------------------------------------------------------

function openCaptureWindow(
  channel: CaptureChannel,
  searchUrl: string,
): Promise<OpenCaptureResult> {
  return new Promise(resolve => {
    let settled = false
    function settle(result: OpenCaptureResult) {
      if (settled) return
      settled = true
      resolve(result)
    }

    let win: BrowserWindow | null = null
    try {
      win = new BrowserWindow({
        width: 1200,
        height: 860,
        title: `TomeKeep 采价 — ${{ jd: '京东', dangdang: '当当', bookschina: '中图网' }[channel] ?? channel}`,
        webPreferences: {
          partition: getStoresPartition(),
          preload: resolveCapturePreloadPath(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false, // required for preload to work with contextBridge
        },
      })
    } catch (e) {
      settle({ ok: false, reason: 'error' })
      return
    }

    // Intercept all new-window opens (target="_blank", window.open, etc.)
    // and navigate in the same window so the capture-preload stays active.
    win.webContents.setWindowOpenHandler(({ url }) => {
      // Let the current window navigate to the target URL instead of
      // spawning a new BrowserWindow that would lack the capture-preload.
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.loadURL(url).catch(() => {})
      }, 0)
      return { action: 'deny' }
    })

    // Listen for result from capture-preload
    const onResult = (_event: Electron.IpcMainEvent, raw: unknown) => {
      const validated = validateCapturePayload(raw, channel)
      if (!validated.ok) {
        settle({ ok: false, reason: 'error' })
        cleanup()
        return
      }
      const { payload } = validated
      const fetchedAt = new Date().toISOString()
      const quote: PriceQuote = {
        channel: payload.channel,
        currency: 'CNY',
        url: payload.url,
        fetchedAt,
        status: 'ok',
        priceCny: payload.priceCny,
        source: 'manual',
      }
      // settle BEFORE cleanup() — win.destroy() synchronously fires 'closed'
      // which would otherwise win the race and settle with 'cancelled' first.
      settle({ ok: true, quote })
      cleanup()
    }

    const onCancel = () => {
      settle({ ok: false, reason: 'cancelled' })
      cleanup()
    }

    function cleanup() {
      ipcMain.removeListener('capture:result', onResult)
      ipcMain.removeListener('capture:cancel', onCancel)
      if (win && !win.isDestroyed()) win.destroy()
      win = null
    }

    ipcMain.once('capture:result', onResult)
    ipcMain.once('capture:cancel', onCancel)

    win.on('closed', () => {
      settle({ ok: false, reason: 'cancelled' })
      ipcMain.removeListener('capture:result', onResult)
      ipcMain.removeListener('capture:cancel', onCancel)
    })

    // BooksChina's /book_find2/ checks the Referer header and returns 403
    // when navigated to directly.  Work around by loading the homepage first,
    // then performing a same-origin JS redirect so the browser supplies a
    // valid Referer automatically.
    if (channel === 'bookschina') {
      win.webContents.once('did-finish-load', () => {
        if (win && !win.isDestroyed()) {
          win.webContents
            .executeJavaScript(`location.href = ${JSON.stringify(searchUrl)}`)
            .catch(() => {})
        }
      })
      win.loadURL('https://www.bookschina.com/').catch(() => {
        cleanup()
        settle({ ok: false, reason: 'error' })
      })
    } else {
      win.loadURL(searchUrl).catch(() => {
        cleanup()
        settle({ ok: false, reason: 'error' })
      })
    }
  })
}

// ---------------------------------------------------------------------------
// IPC setup
// ---------------------------------------------------------------------------

export function setupPricing() {
  // Read cached prices for given keys
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

  // Open a capture window for a single channel
  ipcMain.handle(
    'pricing:open-capture',
    async (
      _event,
      input: PricingInput & { channel: CaptureChannel },
    ): Promise<OpenCaptureResult> => {
      if (!input || typeof input !== 'object') return { ok: false, reason: 'bad_request' }

      const key = normalizeKey(input.key)
      const title = normalizeTitle(input.title)
      const channel = input.channel

      if (!key || !title || !channel) return { ok: false, reason: 'bad_request' }
      if (!Object.keys(ALLOWED_PRODUCT_HOSTS).includes(channel)) return { ok: false, reason: 'bad_request' }

      const searchUrl = buildSearchUrl(channel, title)
      const result = await openCaptureWindow(channel, searchUrl)

      if (result.ok) {
        const db = getDb()
        const now = new Date()
        const existing = db.data.priceCache[key] as PriceCacheEntry | undefined

        // Merge quote into existing entry, or create a new entry
        const updatedQuotes: PriceQuote[] = existing
          ? existing.quotes.filter(q => q.channel !== channel).concat(result.quote)
          : [result.quote]

        const entry: PriceCacheEntry = {
          key,
          query: { title: input.title, author: input.author, isbn: input.isbn },
          quotes: updatedQuotes,
          updatedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
        }
        db.data.priceCache[key] = entry
        await db.write()

        return { ok: true, quote: result.quote }
      }

      return result
    },
  )
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function normalizeTitle(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeKey(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
