import { ipcMain, BrowserWindow, session } from 'electron'
import { extractDoubanSubjectId, parseDoubanSubjectHtml, parseDoubanSearchHtml, type DoubanSearchHit } from '../src/lib/douban'
import { parseOpenLibraryBooksApiResponse, type BookMetadata } from '../src/lib/openLibrary'
import { parseIsbnSearchHtml } from '../src/lib/isbnSearch'

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

type LookupIsbnResult =
  | { ok: true; value: BookMetadata }
  | { ok: false; error: 'invalid_isbn' | 'not_found' | 'timeout' | 'network' | 'bad_response' | 'captcha' }

type LookupDoubanResult =
  | { ok: true; value: BookMetadata }
  | { ok: false; error: 'invalid_url' | 'not_found' | 'timeout' | 'network' | 'bad_response' }

export type { DoubanSearchHit }

type SearchDoubanResult =
  | { ok: true; value: DoubanSearchHit[] }
  | { ok: false; error: 'timeout' | 'network' | 'bad_response' }

/**
 * Result from the unified ISBN waterfall (Douban → OpenLibrary → isbnsearch).
 * `source` tells the caller which service succeeded.
 * `doubanUrl` is set when source === 'douban' so the caller can persist it.
 */
export type WaterfallResult =
  | { ok: true; value: BookMetadata; source: 'douban' | 'openlibrary' | 'isbnsearch'; doubanUrl?: string }
  | { ok: false; error: 'not_found' | 'captcha' }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ISBNSEARCH_PARTITION = 'persist:isbnsearch'
const DOUBAN_PARTITION = 'persist:douban'

const DOUBAN_HEADERS = {
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
} as const

/**
 * Fetch a Douban URL using the persistent Electron session so that cookies
 * set after a user login (via meta:login-douban) are automatically included.
 * This bypasses Douban's IP-based bot-detection gate.
 */
async function fetchDouban(url: string, timeoutMs: number): Promise<Response> {
  const ses = session.fromPartition(DOUBAN_PARTITION)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await ses.fetch(url, { headers: { ...DOUBAN_HEADERS }, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch isbnsearch.org using a persistent session partition so cookies survive
 * across calls. After a captcha is solved once in a popup window, subsequent
 * requests use the stored cookies and bypass the captcha.
 */
async function fetchIsbnSearch(isbn13: string): Promise<LookupIsbnResult> {
  const url = `https://isbnsearch.org/isbn/${isbn13}`
  console.log('[isbnsearch] fetching %s', url)

  try {
    const ses = session.fromPartition(ISBNSEARCH_PARTITION)
    const res = await ses.fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    })

    if (res.status === 404) return { ok: false, error: 'not_found' }
    if (!res.ok) return { ok: false, error: 'network' }

    const html = await res.text()
    console.log('[isbnsearch] http=%d html_len=%d', res.status, html.length)

    // Captcha detection: reCAPTCHA present and no book info div found
    const hasCaptcha = /g-recaptcha|recaptcha\.net|grecaptcha/i.test(html)
    const parsed = parseIsbnSearchHtml(isbn13, html)

    if (!parsed.ok) {
      if (hasCaptcha) {
        console.log('[isbnsearch] captcha detected for isbn=%s', isbn13)
        return { ok: false, error: 'captcha' }
      }
      return { ok: false, error: 'not_found' }
    }

    return parsed
  } catch (e) {
    console.error('[isbnsearch] error', e)
    const name = e instanceof DOMException ? e.name : (e instanceof Error ? e.name : '')
    if (name === 'AbortError') return { ok: false, error: 'timeout' }
    return { ok: false, error: 'network' }
  }
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

export function setupMetadata() {
  // ── Douban search ──────────────────────────────────────────────────────────
  ipcMain.handle('meta:search-douban', async (_event, query: string): Promise<SearchDoubanResult> => {
    if (!query || typeof query !== 'string') return { ok: true, value: [] }
    const url = `https://www.douban.com/search?cat=1001&q=${encodeURIComponent(query.trim())}`
    console.log('[meta:search-douban] query=%s url=%s', query, url)
    try {
      const res = await fetchDouban(url, 8000)
      console.log('[meta:search-douban] http=%d', res.status)
      if (!res.ok) return { ok: false, error: 'network' }
      const html = await res.text()
      const hits = parseDoubanSearchHtml(html)
      console.log('[meta:search-douban] hits=%d %o', hits.length, hits)
      return { ok: true, value: hits }
    } catch (e) {
      console.error('[meta:search-douban] error', e)
      const name = e instanceof DOMException ? e.name : ''
      if (name === 'AbortError') return { ok: false, error: 'timeout' }
      return { ok: false, error: 'network' }
    }
  })

  // ── OpenLibrary lookup ─────────────────────────────────────────────────────
  ipcMain.handle('meta:lookup-isbn', async (_event, isbn13: string): Promise<LookupIsbnResult> => {
    if (!isValidIsbn13(isbn13)) return { ok: false, error: 'invalid_isbn' }
    const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&jscmd=data&format=json`
    try {
      const res = await fetchWithTimeout(url, 8000)
      if (!res.ok) return { ok: false, error: 'network' }
      const json = (await res.json()) as unknown
      const parsed = parseOpenLibraryBooksApiResponse(isbn13, json)
      if (!parsed.ok) return parsed.error === 'not_found' ? { ok: false, error: 'not_found' } : { ok: false, error: 'bad_response' }
      return parsed
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      if (name === 'AbortError') return { ok: false, error: 'timeout' }
      return { ok: false, error: 'network' }
    }
  })

  // ── isbnsearch.org lookup (standalone, with cookie persistence) ────────────
  ipcMain.handle('meta:lookup-isbnsearch', async (_event, isbn13: string): Promise<LookupIsbnResult> => {
    if (!isValidIsbn13(isbn13)) return { ok: false, error: 'invalid_isbn' }
    return fetchIsbnSearch(isbn13)
  })

  // ── Douban subject lookup ──────────────────────────────────────────────────
  ipcMain.handle('meta:lookup-douban', async (_event, input: string): Promise<LookupDoubanResult> => {
    if (typeof input !== 'string') return { ok: false, error: 'invalid_url' }

    const subject = extractDoubanSubjectId(input)
    console.log('[meta:lookup-douban] input=%s subjectId=%o', input, subject)
    if (!subject.ok) return { ok: false, error: 'invalid_url' }

    const url = `https://book.douban.com/subject/${subject.value}/`
    console.log('[meta:lookup-douban] fetching %s', url)

    try {
      const res = await fetchDouban(url, 8000)

      if (res.status === 404) return { ok: false, error: 'not_found' }
      if (!res.ok) return { ok: false, error: 'network' }

      const html = await res.text()
      const parsed = parseDoubanSubjectHtml(html)
      console.log('[meta:lookup-douban] http=%d parsed=%o', res.status, parsed)
      if (!parsed.ok) return parsed.error === 'not_found' ? { ok: false, error: 'not_found' } : { ok: false, error: 'bad_response' }
      return parsed
    } catch (e) {
      console.error('[meta:lookup-douban] error', e)
      const name = e instanceof DOMException ? e.name : ''
      if (name === 'AbortError') return { ok: false, error: 'timeout' }
      return { ok: false, error: 'network' }
    }
  })

  // ── Unified waterfall: Douban → OpenLibrary → isbnsearch ──────────────────
  //
  // Runs entirely in the main process — no IPC round-trips between sources.
  // Returns the first successful result along with its source and, for Douban,
  // the canonical subject URL so the renderer can persist it.
  ipcMain.handle('meta:lookup-isbn-waterfall', async (_event, isbn13: string): Promise<WaterfallResult> => {
    if (!isValidIsbn13(isbn13)) return { ok: false, error: 'not_found' }

    // 1. Douban
    try {
      const searchUrl = `https://www.douban.com/search?cat=1001&q=${encodeURIComponent(isbn13)}`
      const searchRes = await fetchDouban(searchUrl, 8000)
      if (searchRes.ok) {
        const searchHtml = await searchRes.text()
        const hits = parseDoubanSearchHtml(searchHtml)
        if (hits.length > 0) {
          const subjectId = hits[0].subjectId
          const subjectUrl = `https://book.douban.com/subject/${subjectId}/`
          const subjectRes = await fetchDouban(subjectUrl, 8000)
          if (subjectRes.ok) {
            const subjectHtml = await subjectRes.text()
            const parsed = parseDoubanSubjectHtml(subjectHtml)
            if (parsed.ok) {
              console.log('[waterfall] douban hit for isbn=%s', isbn13)
              return { ok: true, value: parsed.value, source: 'douban', doubanUrl: subjectUrl }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[waterfall] douban error for isbn=%s: %o', isbn13, e)
    }

    // 2. OpenLibrary
    try {
      const olUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&jscmd=data&format=json`
      const olRes = await fetchWithTimeout(olUrl, 8000)
      if (olRes.ok) {
        const json = (await olRes.json()) as unknown
        const parsed = parseOpenLibraryBooksApiResponse(isbn13, json)
        if (parsed.ok) {
          console.log('[waterfall] openlibrary hit for isbn=%s', isbn13)
          return { ok: true, value: parsed.value, source: 'openlibrary' }
        }
      }
    } catch (e) {
      console.warn('[waterfall] openlibrary error for isbn=%s: %o', isbn13, e)
    }

    // 3. isbnsearch (with cookie persistence)
    const isbnSearchResult = await fetchIsbnSearch(isbn13)
    if (isbnSearchResult.ok) {
      console.log('[waterfall] isbnsearch hit for isbn=%s', isbn13)
      return { ok: true, value: isbnSearchResult.value, source: 'isbnsearch' }
    }
    if (!isbnSearchResult.ok && isbnSearchResult.error === 'captcha') {
      console.log('[waterfall] isbnsearch captcha for isbn=%s', isbn13)
      return { ok: false, error: 'captcha' }
    }

    console.log('[waterfall] all sources failed for isbn=%s', isbn13)
    return { ok: false, error: 'not_found' }
  })

  // ── Douban login ───────────────────────────────────────────────────────────
  //
  // Opens a BrowserWindow on the persist:douban session partition so the user
  // can log in once. Subsequent session.fetch calls from the same partition
  // automatically include the persisted cookies, bypassing bot-detection.
  ipcMain.handle('meta:login-douban', async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const parentWin = BrowserWindow.getAllWindows()[0]
    return new Promise(resolve => {
      const win = new BrowserWindow({
        width: 520,
        height: 720,
        parent: parentWin ?? undefined,
        modal: !!parentWin,
        title: '登录豆瓣',
        webPreferences: {
          partition: DOUBAN_PARTITION,
          nodeIntegration: false,
          contextIsolation: true,
        },
      })

      let resolved = false

      win.webContents.on('did-navigate', (_e, url) => {
        // Treat any navigation away from accounts.douban.com as successful login
        try {
          const u = new URL(url)
          if (u.hostname !== 'accounts.douban.com') {
            if (!resolved) {
              resolved = true
              win.close()
              resolve({ ok: true })
            }
          }
        } catch { /* ignore bad URLs */ }
      })

      win.on('closed', () => {
        if (!resolved) {
          resolved = true
          resolve({ ok: false, error: 'cancelled' })
        }
      })

      void win.loadURL('https://accounts.douban.com/passport/login?source=book')
    })
  })

  // ── Douban session status ──────────────────────────────────────────────────
  ipcMain.handle('meta:douban-status', async (): Promise<{ loggedIn: boolean }> => {
    const ses = session.fromPartition(DOUBAN_PARTITION)
    const cookies = await ses.cookies.get({ domain: '.douban.com' })
    // 'dbcl2' is Douban's primary auth cookie (present when logged in)
    const loggedIn = cookies.some(c => c.name === 'dbcl2')
    return { loggedIn }
  })

  // ── Captcha resolver: opens a small modal window for user to solve ─────────
  //
  // Opens isbnsearch.org in a persistent-session BrowserWindow (same partition
  // as fetchIsbnSearch so cookies are shared). After the user solves the captcha
  // the page navigates to the real book page — we detect this via did-finish-load,
  // check for .bookinfo, scrape the HTML, and resolve the promise.
  // If the user closes the window without solving, resolves with not_found.
  ipcMain.handle('meta:resolve-captcha', async (_event, isbn13: string): Promise<
    | { ok: true; value: BookMetadata }
    | { ok: false; error: 'not_found' }
  > => {
    const parentWin = BrowserWindow.getAllWindows()[0]

    return new Promise(resolve => {
      const captchaWin = new BrowserWindow({
        width: 520,
        height: 640,
        parent: parentWin ?? undefined,
        modal: !!parentWin,
        title: '验证 isbnsearch.org — 请完成人机验证',
        webPreferences: {
          partition: ISBNSEARCH_PARTITION,
          nodeIntegration: false,
          contextIsolation: true,
        },
      })

      let resolved = false

      let parsing = false
      const tryParse = async (trigger: string) => {
        if (resolved) return
        if (parsing) return   // avoid concurrent scrapes
        parsing = true
        try {
          const url = captchaWin.webContents.getURL()
          const html: string = await captchaWin.webContents.executeJavaScript(
            'document.documentElement.outerHTML'
          )
          console.log(
            '[resolve-captcha] %s isbn=%s url=%s html_len=%d',
            trigger, isbn13, url, html.length
          )
          const parsed = parseIsbnSearchHtml(isbn13, html)
          if (parsed.ok) {
            resolved = true
            captchaWin.close()
            console.log('[resolve-captcha] success isbn=%s coverUrl=%s', isbn13, parsed.value.coverUrl)
            resolve({ ok: true, value: parsed.value })
          } else {
            console.log('[resolve-captcha] not yet resolved isbn=%s (captcha still showing?)', isbn13)
          }
        } catch (e) {
          // executeJavaScript can fail if window is mid-navigation; ignore
          console.log('[resolve-captcha] executeJavaScript error isbn=%s: %o', isbn13, e)
        } finally {
          parsing = false
        }
      }

      captchaWin.webContents.on('did-finish-load', () => {
        void tryParse('did-finish-load')
      })

      // Also try on did-stop-loading which fires even when did-finish-load is
      // suppressed by the page (e.g. after a captcha redirect with client-side nav)
      captchaWin.webContents.on('did-stop-loading', () => {
        void tryParse('did-stop-loading')
      })

      captchaWin.on('closed', () => {
        if (!resolved) {
          console.log('[resolve-captcha] window closed without solving for isbn=%s', isbn13)
          resolve({ ok: false, error: 'not_found' })
        }
      })

      void captchaWin.loadURL(`https://isbnsearch.org/isbn/${isbn13}`)
    })
  })
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function isValidIsbn13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false
  if (!value.startsWith('978') && !value.startsWith('979')) return false
  const digits = value.split('').map(d => Number(d))
  const checkDigit = digits[12]
  const sum = digits.slice(0, 12).reduce((acc, d, idx) => acc + d * (idx % 2 === 0 ? 1 : 3), 0)
  const expected = (10 - (sum % 10)) % 10
  return checkDigit === expected
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
