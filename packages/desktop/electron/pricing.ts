import { BrowserWindow, ipcMain } from 'electron'
import { encode as iconvEncode } from 'iconv-lite'
import type { StoreChannel } from './stores'
import { getStoresPartition } from './stores'
import { getDb, type PriceCacheEntry, type PriceQuote } from './db'
import { resolveCapturePreloadPath } from './preloadPath'
import type { CapturePayload } from './capture-preload'
import {
  parseJdOffersFromSearchHtml,
  parseDangdangOffersFromSearchHtml,
  parseBooksChinaOffersFromSearchHtml,
  parseJdPriceFromProductHtml,
  parseDangdangPriceFromHtml,
  parseBooksChinaPriceFromProductHtml,
  pickLowestOffer,
  extractProductId,
} from '@tomekeep/shared'
import { filterMatchingOffers } from './ollama'

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

// Progress event emitted via 'pricing:auto-progress' to the renderer
export interface AutoCaptureProgressEvent {
  key: string
  channel: CaptureChannel
  status: 'started' | 'ok' | 'not_found' | 'needs_login' | 'blocked' | 'error'
  quote?: PriceQuote
}

const TTL_MS = 24 * 60 * 60 * 1000
// Maximum number of search-result candidates to consider per channel
const SEARCH_RESULT_LIMIT = 8
// How long (ms) to wait for a CAPTCHA/login window to be closed by the user
const LOGIN_RESOLVE_TIMEOUT_MS = 5 * 60 * 1000

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

    // Back / Forward keyboard navigation inside the capture window.
    // Handles:
    //   macOS  : Cmd+[ (back), Cmd+] (forward)
    //   Win/Lin: Alt+Left (back), Alt+Right (forward)
    win.webContents.on('before-input-event', (_e, input) => {
      if (!win || win.isDestroyed()) return
      if (input.type !== 'keyDown') return
      const wc = win.webContents
      const isMac = process.platform === 'darwin'
      const isBack = isMac
        ? input.meta && input.key === '['
        : input.alt && input.key === 'ArrowLeft'
      const isForward = isMac
        ? input.meta && input.key === ']'
        : input.alt && input.key === 'ArrowRight'
      if (isBack && wc.navigationHistory.canGoBack()) {
        wc.navigationHistory.goBack()
      } else if (isForward && wc.navigationHistory.canGoForward()) {
        wc.navigationHistory.goForward()
      }
    })

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
// Auto-capture: headless per-channel fetch
// ---------------------------------------------------------------------------

/**
 * Fetch the HTML of `url` using a hidden BrowserWindow that shares the
 * persisted store session (so cookies are in effect).  Returns the outer HTML
 * of the page once it has finished loading.
 *
 * If the page redirects to a login / CAPTCHA wall, `onBlockDetected` is
 * called with the BrowserWindow so the caller can show it to the user.
 * The promise resolves once the window is dismissed (user closes or solves it)
 * or after LOGIN_RESOLVE_TIMEOUT_MS.
 */
async function headlessFetch(
  url: string,
  channel: CaptureChannel,
  onBlockDetected?: (win: BrowserWindow) => void,
): Promise<{ html: string; finalUrl: string } | null> {
  return new Promise(resolve => {
    let win: BrowserWindow | null = null
    let settled = false

    function finish(result: { html: string; finalUrl: string } | null) {
      if (settled) return
      settled = true
      if (win && !win.isDestroyed()) win.destroy()
      win = null
      resolve(result)
    }

    try {
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          partition: getStoresPartition(),
          contextIsolation: true,
          nodeIntegration: false,
          javascript: true,
        },
      })
    } catch {
      resolve(null)
      return
    }

    // Timeout fallback
    const timeout = setTimeout(() => finish(null), 30_000)

    /**
     * Handler that fires once the *target* page has finished loading.
     * For BooksChina this is registered after the homepage redirect; for all
     * other channels it is registered before `loadURL`.
     */
    const onTargetLoaded = async () => {
      clearTimeout(timeout)
      if (!win || win.isDestroyed()) { finish(null); return }
      try {
        const finalUrl: string = win.webContents.getURL()

        const html: string = await win.webContents.executeJavaScript(
          'document.documentElement.outerHTML'
        )

        // Detect login/CAPTCHA walls by checking for known redirect patterns
        const isBlocked = isLoginOrCaptchaPage(channel, finalUrl, html)
        if (isBlocked) {
          if (onBlockDetected && win && !win.isDestroyed()) {
            win.show()
            onBlockDetected(win)
            const resolveTimer = setTimeout(() => finish(null), LOGIN_RESOLVE_TIMEOUT_MS)
            win.once('closed', () => {
              clearTimeout(resolveTimer)
              win = null
              headlessFetch(url, channel, onBlockDetected)
                .then(result => finish(result))
                .catch(() => finish(null))
            })
            return
          }
          finish(null)
          return
        }

        finish({ html, finalUrl })
      } catch {
        finish(null)
      }
    }

    win.webContents.once('did-fail-load', () => {
      clearTimeout(timeout)
      finish(null)
    })

    // For BooksChina, navigate via homepage to set correct Referer, then
    // register the main handler only after the redirect is issued so that
    // onTargetLoaded fires on the *target* page, not the homepage.
    if (channel === 'bookschina') {
      win.webContents.once('did-finish-load', async () => {
        if (!win || win.isDestroyed()) { finish(null); return }
        try {
          win.webContents.once('did-finish-load', onTargetLoaded)
          await win.webContents.executeJavaScript(`location.href = ${JSON.stringify(url)}`)
        } catch { finish(null) }
      })
      win.loadURL('https://www.bookschina.com/').catch(() => finish(null))
    } else {
      win.webContents.once('did-finish-load', onTargetLoaded)
      win.loadURL(url).catch(() => finish(null))
    }
  })
}

/**
 * Fetch JD search results using in-page DOM extraction.
 *
 * JD's search page is a React SPA. Product data is rendered into DOM nodes
 * that use obfuscated CSS module class names and do NOT use conventional
 * href="//item.jd.com/NNNN.html" links.  Instead, each product card has a
 * data-sku="NNNN" attribute on the wrapper element.
 *
 * This function loads the page in a hidden window, waits for the product cards
 * to render, then uses executeJavaScript to read the structured data directly
 * from the live DOM — avoiding fragile regex parsing of serialized HTML.
 */
async function jdSearchFetch(
  searchUrl: string,
  onBlockDetected?: (win: BrowserWindow) => void,
): Promise<{ offers: import('@tomekeep/shared').PriceOffer[]; finalUrl: string } | null> {
  return new Promise(resolve => {
    let win: BrowserWindow | null = null
    let settled = false

    function finish(result: { offers: import('@tomekeep/shared').PriceOffer[]; finalUrl: string } | null) {
      if (settled) return
      settled = true
      if (win && !win.isDestroyed()) win.destroy()
      win = null
      resolve(result)
    }

    try {
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          partition: getStoresPartition(),
          contextIsolation: true,
          nodeIntegration: false,
          javascript: true,
        },
      })
    } catch {
      resolve(null)
      return
    }

    const timeout = setTimeout(() => finish(null), 35_000)

    win.webContents.once('did-finish-load', async () => {
      clearTimeout(timeout)
      if (!win || win.isDestroyed()) { finish(null); return }
      try {
        const finalUrl: string = win.webContents.getURL()

        // Detect login/CAPTCHA wall (passport redirect or risk-handler challenge page)
        if (/passport\.jd\.com|cfe\.m\.jd\.com/.test(finalUrl)) {
          if (onBlockDetected && win && !win.isDestroyed()) {
            win.show()
            onBlockDetected(win)
            const resolveTimer = setTimeout(() => finish(null), LOGIN_RESOLVE_TIMEOUT_MS)
            win.once('closed', () => {
              clearTimeout(resolveTimer)
              win = null
              jdSearchFetch(searchUrl, onBlockDetected).then(finish).catch(() => finish(null))
            })
            return
          }
          finish(null)
          return
        }

        // Poll for product cards (data-sku attributes) to appear — the React
        // app needs time to fetch and render the product list after page load.
        const deadline = Date.now() + 15_000
        const pollInterval = 500
        await new Promise<void>(res => {
          const check = async () => {
            if (!win || win.isDestroyed()) { res(); return }
            try {
              const count: number = await win.webContents.executeJavaScript(
                `document.querySelectorAll('[data-sku]').length`
              )
              if (count > 0) {
                // Give prices another moment to populate
                await new Promise(r => setTimeout(r, 600))
                res(); return
              }
              if (Date.now() >= deadline) { res(); return }
            } catch { res(); return }
            setTimeout(check, pollInterval)
          }
          setTimeout(check, pollInterval)
        })
        if (!win || win.isDestroyed()) { finish(null); return }

        // Extract offer data directly from the live DOM
        const offersJson: string = await win.webContents.executeJavaScript(`
          (() => {
            const LIMIT = ${SEARCH_RESULT_LIMIT};
            const cards = Array.from(document.querySelectorAll('[data-sku]')).slice(0, LIMIT * 2);
            const results = [];
            for (const card of cards) {
              if (results.length >= LIMIT) break;
              const sku = card.dataset.sku;
              if (!sku) continue;
              const url = 'https://item.jd.com/' + sku + '.html';

              // Price: the price container uses a CSS module class containing "_price_"
              // The integer and decimal parts are in separate <span> nodes.
              // Read textContent of the price container and parse the number.
              let priceCny = 0;
              const priceEl = card.querySelector('[class*="_price_"]');
              if (priceEl) {
                const raw = priceEl.textContent.replace(/[^0-9.]/g, '');
                priceCny = parseFloat(raw) || 0;
              }
              if (priceCny <= 0) continue;

              // Title: prefer the title="" attribute on the card wrapper div,
              // which contains the full untruncated product name.
              let title = '';
              const titleEl = card.querySelector('[title]');
              if (titleEl) title = titleEl.getAttribute('title') || '';
              if (!title) {
                const textEl = card.querySelector('[class*="_text_"]');
                if (textEl) title = textEl.textContent.trim();
              }
              title = title.replace(/\\s+/g, ' ').trim();

              results.push({ url, priceCny, title: title || undefined });
            }
            return JSON.stringify(results);
          })()
        `)
        const offers = JSON.parse(offersJson) as import('@tomekeep/shared').PriceOffer[]
        finish({ offers, finalUrl })
      } catch {
        finish(null)
      }
    })

    win.webContents.once('did-fail-load', () => {
      clearTimeout(timeout)
      finish(null)
    })

    win.loadURL(searchUrl).catch(() => finish(null))
  })
}


/**
 * Fetch BooksChina search results using in-page DOM extraction.
 *
 * BooksChina's search page mixes books and merchandise in the same HTML, and
 * the page structure varies.  Using regex on serialised HTML risks picking up
 * wrong product blocks (keychains, bags, etc.).  Instead we load the page in a
 * hidden window (via the homepage Referer trick) and read the live DOM, where
 * books are in well-structured list items.
 *
 * BooksChina search results are rendered as:
 *   <ul class="search_list"> or a similar book-list container
 *   Each book is an <li> with a product link <a href="/NNNNN.htm">,
 *   a title span/div, a price element and sometimes an author span.
 */
async function booksChinaSearchFetch(
  searchUrl: string,
  onBlockDetected?: (win: BrowserWindow) => void,
): Promise<{ offers: import('@tomekeep/shared').PriceOffer[]; finalUrl: string } | null> {
  return new Promise(resolve => {
    let win: BrowserWindow | null = null
    let settled = false

    function finish(result: { offers: import('@tomekeep/shared').PriceOffer[]; finalUrl: string } | null) {
      if (settled) return
      settled = true
      if (win && !win.isDestroyed()) win.destroy()
      win = null
      resolve(result)
    }

    try {
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          partition: getStoresPartition(),
          contextIsolation: true,
          nodeIntegration: false,
          javascript: true,
        },
      })
    } catch {
      resolve(null)
      return
    }

    const timeout = setTimeout(() => finish(null), 35_000)

    // After homepage loads, redirect to the search URL (sets correct Referer)
    win.webContents.once('did-finish-load', async () => {
      if (!win || win.isDestroyed()) { finish(null); return }
      try {
        // Register handler for when the search page finishes loading
        win.webContents.once('did-finish-load', async () => {
          clearTimeout(timeout)
          if (!win || win.isDestroyed()) { finish(null); return }
          try {
            const finalUrl: string = win.webContents.getURL()

            if (isLoginOrCaptchaPage('bookschina', finalUrl, '')) {
              if (onBlockDetected && win && !win.isDestroyed()) {
                win.show()
                onBlockDetected(win)
                const resolveTimer = setTimeout(() => finish(null), LOGIN_RESOLVE_TIMEOUT_MS)
                win.once('closed', () => {
                  clearTimeout(resolveTimer)
                  win = null
                  booksChinaSearchFetch(searchUrl, onBlockDetected).then(finish).catch(() => finish(null))
                })
                return
              }
              finish(null)
              return
            }

            // Wait briefly for any JS rendering
            await new Promise(r => setTimeout(r, 1000))
            if (!win || win.isDestroyed()) { finish(null); return }

            // Extract book offers from live DOM.
            // BooksChina search page structure (observed):
            //   Product links: <a href="/NNNNN.htm"> or <a href="https://www.bookschina.com/NNNNN.htm">
            //   Each product block contains title, author, price.
            //
            // Strategy: collect all anchor elements that look like book product pages,
            // then for each find the nearest price and title text within the same
            // parent container.
            const offersJson: string = await win.webContents.executeJavaScript(`
              (() => {
                const LIMIT = ${SEARCH_RESULT_LIMIT};
                const seen = new Set();
                const results = [];

                // Find all links to book product pages: /NNNNN.htm
                const anchors = Array.from(document.querySelectorAll('a[href]'));
                for (const a of anchors) {
                  if (results.length >= LIMIT) break;
                  const href = a.getAttribute('href') || '';
                  const m = href.match(/(?:https?:\\/\\/(?:www|m)\\.bookschina\\.com)?\\/([0-9]{5,9})\\.htm(?:l?)(?:[?#]|$)/);
                  if (!m) continue;
                  const pid = m[1];
                  if (seen.has(pid)) continue;
                  seen.add(pid);

                  const url = 'https://www.bookschina.com/' + pid + '.htm';

                  // Walk up the DOM to find the product card container.
                  // Look for a parent <li> or <div> that's not too far up.
                  let container = a.parentElement;
                  for (let i = 0; i < 5 && container; i++) {
                    const tag = container.tagName.toLowerCase();
                    if (tag === 'li' || tag === 'tr') break;
                    // Stop if we've hit a list wrapper (likely the whole search results)
                    if (container.children.length > 12) break;
                    container = container.parentElement;
                  }
                  if (!container) container = a.parentElement;

                  // Find price within container: look for ¥ or yuan symbol text
                  let priceCny = 0;
                  const allText = container ? container.querySelectorAll('*') : [];
                  for (const el of allText) {
                    if (el.children.length > 0) continue; // leaf nodes only
                    const t = el.textContent || '';
                    const pm = t.match(/[¥￥]\\s*([0-9]+(?:\\.[0-9]{1,2})?)/);
                    if (pm) { priceCny = parseFloat(pm[1]) || 0; if (priceCny > 0) break; }
                  }
                  if (priceCny <= 0) {
                    // Try looking at the anchor's own text or nearby sibling
                    const pt = (a.textContent || '').match(/[¥￥]\\s*([0-9]+(?:\\.[0-9]{1,2})?)/);
                    if (pt) priceCny = parseFloat(pt[1]) || 0;
                  }
                  if (priceCny <= 0) continue;

                  // Extract title: prefer the anchor's title attribute, then text of
                  // an element with class containing 'book_title', 'title', or 'bookname',
                  // then the anchor text itself.
                  let title = a.getAttribute('title') || '';
                  if (!title) {
                    const titleEl = container
                      ? (container.querySelector('[class*="book_title"],[class*="bookname"],[class*="title"]'))
                      : null;
                    if (titleEl) title = (titleEl.textContent || '').trim();
                  }
                  if (!title) title = (a.textContent || '').trim();
                  title = title.replace(/\\s+/g, ' ').trim();

                  // Extract author: element with class containing 'author' or text after 作者
                  let author = '';
                  if (container) {
                    const authorEl = container.querySelector('[class*="author"]');
                    if (authorEl) {
                      author = (authorEl.textContent || '').replace(/^作者[：:]+/, '').trim();
                    }
                    if (!author) {
                      const allInner = Array.from(container.querySelectorAll('*'));
                      for (const el of allInner) {
                        if (el.children.length > 0) continue;
                        const t = el.textContent || '';
                        const am = t.match(/作者[：:]\\s*([^\\s]{1,30})/);
                        if (am) { author = am[1].trim(); break; }
                      }
                    }
                  }

                  results.push({
                    url,
                    priceCny,
                    title: title || undefined,
                    author: author || undefined,
                  });
                }
                return JSON.stringify(results);
              })()
            `)
            const offers = JSON.parse(offersJson) as import('@tomekeep/shared').PriceOffer[]
            finish({ offers, finalUrl })
          } catch {
            finish(null)
          }
        })

        win.webContents.once('did-fail-load', () => {
          clearTimeout(timeout)
          finish(null)
        })

        await win.webContents.executeJavaScript(`location.href = ${JSON.stringify(searchUrl)}`)
      } catch { finish(null) }
    })

    win.webContents.once('did-fail-load', () => {
      clearTimeout(timeout)
      finish(null)
    })

    win.loadURL('https://www.bookschina.com/').catch(() => finish(null))
  })
}

function isLoginOrCaptchaPage(channel: CaptureChannel, url: string, _html: string): boolean {
  switch (channel) {
    case 'jd':
      // Only treat as blocked when JD actually redirects to passport.jd.com.
      // Do NOT inspect HTML for login class names — search result pages can
      // legitimately contain login-related strings while the user is logged in.
      return /passport\.jd\.com/.test(url)
    case 'dangdang':
      return /passport\.dangdang\.com|login\.dangdang\.com/.test(url)
    case 'bookschina':
      return /login\.bookschina\.com|captcha/i.test(url)
  }
}

/** Parse search-result HTML for the given channel, returning up to SEARCH_RESULT_LIMIT offers. */
function parseSearchOffers(channel: CaptureChannel, html: string) {
  switch (channel) {
    case 'jd':        return parseJdOffersFromSearchHtml(html, SEARCH_RESULT_LIMIT)
    case 'dangdang':  return parseDangdangOffersFromSearchHtml(html, SEARCH_RESULT_LIMIT)
    case 'bookschina': return parseBooksChinaOffersFromSearchHtml(html, SEARCH_RESULT_LIMIT)
  }
}

/** Parse a product-page HTML to extract the current price. */
function parseProductPrice(channel: CaptureChannel, html: string) {
  switch (channel) {
    case 'jd':        return parseJdPriceFromProductHtml(html)
    case 'dangdang':  return parseDangdangPriceFromHtml(html)
    case 'bookschina': return parseBooksChinaPriceFromProductHtml(html)
  }
}

/**
 * Auto-capture price for a single channel.
 *
 * Flow:
 *   1. If an existing quote has a productId, navigate directly to the product
 *      page to refresh the price (skip search + matching).
 *   2. Otherwise: fetch search results → LLM/bigram filter → pick lowest price.
 *   3. On login/CAPTCHA wall: show window for user, then continue after close.
 *
 * Emits progress events via `webContents.send('pricing:auto-progress', ...)`.
 */
async function autoCaptureChannel(
  channel: CaptureChannel,
  input: PricingInput,
  existingQuote: PriceQuote | undefined,
  sender: Electron.WebContents,
): Promise<PriceQuote> {
  const key = normalizeKey(input.key)

  function emitProgress(status: AutoCaptureProgressEvent['status'], quote?: PriceQuote) {
    if (!sender.isDestroyed()) {
      sender.send('pricing:auto-progress', { key, channel, status, quote } satisfies AutoCaptureProgressEvent)
    }
  }

  emitProgress('started')

  const searchUrl = buildSearchUrl(channel, input.title)
  const now = new Date()

  try {
    // ── Fast path: existing productId → refresh price directly ──────────────
    if (existingQuote?.productId) {
      const productUrl = existingQuote.url
      const fetched = await headlessFetch(productUrl, channel, win => {
        win.setTitle(`TomeKeep 采价 — ${channelLabel(channel)} — 请完成登录/验证后关闭此窗口`)
      })
      if (fetched) {
        const priceResult = parseProductPrice(channel, fetched.html)
        if (priceResult.ok) {
          const quote: PriceQuote = {
            channel,
            currency: 'CNY',
            url: fetched.finalUrl,
            fetchedAt: now.toISOString(),
            status: 'ok',
            priceCny: priceResult.value,
            productId: existingQuote.productId,
            source: 'auto',
          }
          emitProgress('ok', quote)
          return quote
        }
        // Product page returned but price not found → may be delisted
        const quote: PriceQuote = {
          channel,
          currency: 'CNY',
          url: productUrl,
          fetchedAt: now.toISOString(),
          status: 'not_found',
          productId: existingQuote.productId,
          source: 'auto',
        }
        emitProgress('not_found', quote)
        return quote
      }
      // Fall through to search flow if direct fetch failed
    }

    // ── Search flow ──────────────────────────────────────────────────────────
    // JD and BooksChina require live DOM extraction via executeJavaScript.
    // JD is a React SPA with obfuscated class names.
    // BooksChina mixes books and merchandise in the same HTML; DOM extraction
    // with targeted selectors is more reliable than regex parsing.
    // Dangdang still uses headlessFetch + HTML regex (works reliably).
    let rawOffers: import('@tomekeep/shared').PriceOffer[]
    let searchResultUrl: string

    if (channel === 'jd') {
      const jdResult = await jdSearchFetch(searchUrl, win => {
        win.setTitle(`TomeKeep 采价 — 京东 — 请完成登录/验证后关闭此窗口`)
      })
      if (!jdResult) {
        const quote: PriceQuote = {
          channel, currency: 'CNY', url: searchUrl,
          fetchedAt: now.toISOString(), status: 'error',
          source: 'auto', message: 'headless fetch failed',
        }
        emitProgress('error', quote)
        return quote
      }
      rawOffers = jdResult.offers
      searchResultUrl = jdResult.finalUrl
    } else if (channel === 'bookschina') {
      const bcResult = await booksChinaSearchFetch(searchUrl, win => {
        win.setTitle(`TomeKeep 采价 — 中图网 — 请完成登录/验证后关闭此窗口`)
      })
      if (!bcResult) {
        const quote: PriceQuote = {
          channel, currency: 'CNY', url: searchUrl,
          fetchedAt: now.toISOString(), status: 'error',
          source: 'auto', message: 'headless fetch failed',
        }
        emitProgress('error', quote)
        return quote
      }
      rawOffers = bcResult.offers
      searchResultUrl = bcResult.finalUrl
      console.log(`[autoCaptureChannel:bookschina] DOM rawOffers=${rawOffers.length} finalUrl=${searchResultUrl}`)
    } else {
      const searchFetched = await headlessFetch(searchUrl, channel, win => {
        win.setTitle(`TomeKeep 采价 — ${channelLabel(channel)} — 请完成登录/验证后关闭此窗口`)
      })
      if (!searchFetched) {
        const quote: PriceQuote = {
          channel, currency: 'CNY', url: searchUrl,
          fetchedAt: now.toISOString(), status: 'error',
          source: 'auto', message: 'headless fetch failed',
        }
        emitProgress('error', quote)
        return quote
      }
      rawOffers = parseSearchOffers(channel, searchFetched.html)
      searchResultUrl = searchFetched.finalUrl
      console.log(`[autoCaptureChannel:${channel}] rawOffers=${rawOffers.length} finalUrl=${searchResultUrl}`)
    }

    if (rawOffers.length === 0) {
      console.log(`[autoCaptureChannel:${channel}] no rawOffers`)
      const quote: PriceQuote = {
        channel, currency: 'CNY', url: searchResultUrl,
        fetchedAt: now.toISOString(), status: 'not_found', source: 'auto',
      }
      emitProgress('not_found', quote)
      return quote
    }

    // LLM/bigram matching → pick lowest price
    const matched = await filterMatchingOffers(rawOffers, input.title, input.author)
    console.log(`[autoCaptureChannel:${channel}] matched=${matched.length}/${rawOffers.length} title="${input.title}"`)
    if (matched.length > 0) {
      console.log(`[autoCaptureChannel:${channel}] top matches:`, matched.slice(0, 3).map(o => ({ title: o.title, price: o.priceCny, url: o.url })))
    }

    if (matched.length === 0) {
      const quote: PriceQuote = {
        channel, currency: 'CNY', url: searchResultUrl,
        fetchedAt: now.toISOString(), status: 'not_found', source: 'auto',
      }
      emitProgress('not_found', quote)
      return quote
    }

    const bestResult = pickLowestOffer(matched)
    if (!bestResult.ok) {
      const quote: PriceQuote = {
        channel, currency: 'CNY', url: searchResultUrl,
        fetchedAt: now.toISOString(), status: 'not_found', source: 'auto',
      }
      emitProgress('not_found', quote)
      return quote
    }

    const best = bestResult.value
    const productId = extractProductId(best.url)

    const quote: PriceQuote = {
      channel,
      currency: 'CNY',
      url: best.url,
      fetchedAt: now.toISOString(),
      status: 'ok',
      priceCny: best.priceCny,
      productId,
      source: 'auto',
    }
    emitProgress('ok', quote)
    return quote
  } catch (err) {
    const quote: PriceQuote = {
      channel, currency: 'CNY', url: searchUrl,
      fetchedAt: now.toISOString(), status: 'error',
      source: 'auto', message: String((err as Error).message ?? err),
    }
    emitProgress('error', quote)
    return quote
  }
}

function channelLabel(ch: CaptureChannel): string {
  return { jd: '京东', dangdang: '当当', bookschina: '中图网' }[ch] ?? ch
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

  // Auto-capture all channels concurrently
  ipcMain.handle(
    'pricing:auto-capture-all',
    async (event, input: PricingInput): Promise<void> => {
      if (!input || typeof input !== 'object') return
      const key = normalizeKey(input.key)
      const title = normalizeTitle(input.title)
      if (!key || !title) return

      const sender = event.sender
      const db = getDb()
      const existing = db.data.priceCache[key] as PriceCacheEntry | undefined

      const channels: CaptureChannel[] = ['jd', 'dangdang', 'bookschina']

      // Run all three channels concurrently
      const quoteResults = await Promise.all(
        channels.map(ch => {
          const existingQuote = existing?.quotes.find(q => q.channel === ch)
          return autoCaptureChannel(ch, { ...input, key }, existingQuote, sender)
        })
      )

      // Merge results into priceCache
      const now = new Date()
      const existingQuotes: PriceQuote[] = existing?.quotes ?? []
      const updatedQuotes: PriceQuote[] = [
        ...existingQuotes.filter(q => !channels.includes(q.channel as CaptureChannel)),
        ...quoteResults,
      ]

      const entry: PriceCacheEntry = {
        key,
        query: { title: input.title, author: input.author, isbn: input.isbn },
        quotes: updatedQuotes,
        updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
      }
      db.data.priceCache[key] = entry
      await db.write()
    },
  )

  // Remove manual flag: change source from 'manual' to 'auto' without re-fetching
  ipcMain.handle(
    'pricing:remove-manual-flag',
    async (_event, key: string, channel: CaptureChannel): Promise<void> => {
      if (typeof key !== 'string' || !key) return
      const normKey = normalizeKey(key)
      const db = getDb()
      const entry = db.data.priceCache[normKey] as PriceCacheEntry | undefined
      if (!entry) return
      let changed = false
      for (const q of entry.quotes) {
        if (q.channel === channel && q.source === 'manual') {
          q.source = 'auto'
          changed = true
        }
      }
      if (changed) {
        entry.updatedAt = new Date().toISOString()
        await db.write()
      }
    },
  )

  // Auto-capture a single channel
  ipcMain.handle(
    'pricing:auto-capture-channel',
    async (event, input: PricingInput, channel: CaptureChannel): Promise<void> => {
      if (!input || typeof input !== 'object') return
      if (!channel) return
      const key = normalizeKey(input.key)
      const title = normalizeTitle(input.title)
      if (!key || !title) return

      const sender = event.sender
      const db = getDb()
      const existing = db.data.priceCache[key] as PriceCacheEntry | undefined
      const existingQuote = existing?.quotes.find(q => q.channel === channel)

      const quote = await autoCaptureChannel(channel, { ...input, key }, existingQuote, sender)

      // Merge result into priceCache (preserve other channels).
      // Re-read the cache entry here — after the async capture — so concurrent
      // channel captures don't overwrite each other's results.
      const now = new Date()
      const afterCapture = db.data.priceCache[key] as PriceCacheEntry | undefined
      const existingQuotes: PriceQuote[] = afterCapture?.quotes ?? []
      const updatedQuotes: PriceQuote[] = [
        ...existingQuotes.filter(q => q.channel !== channel),
        quote,
      ]

      const entry: PriceCacheEntry = {
        key,
        query: { title: input.title, author: input.author, isbn: input.isbn },
        quotes: updatedQuotes,
        updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
      }
      db.data.priceCache[key] = entry
      await db.write()
    },
  )

  // Refresh a manually-captured channel: re-fetch the product page (by productId URL)
  // and update the price, keeping source='manual'. If the product page no longer
  // has a price (delisted), saves a not_found quote with the productId preserved.
  // Emits the same auto-progress events so the spinner in the UI works.
  ipcMain.handle(
    'pricing:refresh-manual-channel',
    async (event, input: PricingInput, channel: CaptureChannel): Promise<void> => {
      if (!input || typeof input !== 'object') return
      if (!channel) return
      const key = normalizeKey(input.key)
      if (!key) return

      const sender = event.sender
      const db = getDb()
      const existing = db.data.priceCache[key] as PriceCacheEntry | undefined
      const existingQuote = existing?.quotes.find(q => q.channel === channel)

      // Can only refresh if there's an existing productId to hit directly
      if (!existingQuote?.productId) return

      function emitProgress(status: AutoCaptureProgressEvent['status'], quote?: PriceQuote) {
        if (!sender.isDestroyed()) {
          sender.send('pricing:auto-progress', { key, channel, status, quote } satisfies AutoCaptureProgressEvent)
        }
      }

      emitProgress('started')

      const now = new Date()
      const productUrl = existingQuote.url

      const fetched = await headlessFetch(productUrl, channel, win => {
        win.setTitle(`TomeKeep 采价 — ${channelLabel(channel)} — 请完成登录/验证后关闭此窗口`)
      })

      let quote: PriceQuote
      if (fetched) {
        const priceResult = parseProductPrice(channel, fetched.html)
        if (priceResult.ok) {
          quote = {
            channel,
            currency: 'CNY',
            url: fetched.finalUrl,
            fetchedAt: now.toISOString(),
            status: 'ok',
            priceCny: priceResult.value,
            productId: existingQuote.productId,
            source: 'manual',
          }
          emitProgress('ok', quote)
        } else {
          // Product page loaded but no price → likely delisted
          quote = {
            channel,
            currency: 'CNY',
            url: productUrl,
            fetchedAt: now.toISOString(),
            status: 'not_found',
            productId: existingQuote.productId,
            source: 'manual',
          }
          emitProgress('not_found', quote)
        }
      } else {
        // Fetch failed entirely
        quote = {
          channel,
          currency: 'CNY',
          url: productUrl,
          fetchedAt: now.toISOString(),
          status: 'error',
          source: 'manual',
          message: 'headless fetch failed',
        }
        emitProgress('error', quote)
      }

      // Merge result into priceCache (preserve other channels).
      // Re-read the cache entry here — after the async fetch — so concurrent
      // channel captures don't overwrite each other's results.
      const afterFetch = db.data.priceCache[key] as PriceCacheEntry | undefined
      const existingQuotes: PriceQuote[] = afterFetch?.quotes ?? []
      const updatedQuotes: PriceQuote[] = [
        ...existingQuotes.filter(q => q.channel !== channel),
        quote,
      ]

      const entry: PriceCacheEntry = {
        key,
        query: { title: input.title, author: input.author, isbn: input.isbn },
        quotes: updatedQuotes,
        updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
      }
      db.data.priceCache[key] = entry
      await db.write()
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
