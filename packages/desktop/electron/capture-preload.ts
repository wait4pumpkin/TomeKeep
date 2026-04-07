/// <reference lib="dom" />
import { ipcRenderer } from 'electron'

// ---------------------------------------------------------------------------
// Types (kept minimal to avoid importing from main-process files)
// ---------------------------------------------------------------------------

type CaptureChannel = 'jd' | 'dangdang' | 'bookschina'

export interface CapturePayload {
  channel: CaptureChannel
  url: string
  priceCny: number
}

// ---------------------------------------------------------------------------
// IPC helpers — called directly from preload (no contextBridge needed because
// all overlay logic runs inside the preload, not in the page's JS context)
// ---------------------------------------------------------------------------

function submitCapture(payload: CapturePayload) {
  ipcRenderer.send('capture:result', payload)
}

function cancelCapture() {
  ipcRenderer.send('capture:cancel')
}

// ---------------------------------------------------------------------------
// Dangdang product-page detection helpers
// ---------------------------------------------------------------------------

function isDangdangProductPage(url: string): { matched: true } | { matched: false } {
  // Matches: https://product.dangdang.com/12345678.html
  if (/^https?:\/\/product\.dangdang\.com\/\d+\.html/.test(url)) return { matched: true }
  return { matched: false }
}

// ---------------------------------------------------------------------------
// Price extraction for Dangdang: server-rendered, so DOM is ready immediately
// ---------------------------------------------------------------------------

function extractDangdangPrice(): number | null {
  try {
    // Primary: #dd-price — strip leading ¥ symbol element and read text
    const ddPrice = document.querySelector('#dd-price')
    if (ddPrice) {
      // Clone to remove child <span class="yen"> without mutating the DOM
      const clone = ddPrice.cloneNode(true) as Element
      clone.querySelectorAll('.yen').forEach(el => el.remove())
      const text = clone.textContent?.trim() ?? ''
      const n = parseFloat(text)
      if (isFinite(n) && n > 0) return n
    }

    // Fallback: #original-price (cover/list price)
    const origPrice = document.querySelector('#original-price')
    if (origPrice) {
      const clone = origPrice.cloneNode(true) as Element
      clone.querySelectorAll('.yen').forEach(el => el.remove())
      const text = clone.textContent?.trim() ?? ''
      const n = parseFloat(text)
      if (isFinite(n) && n > 0) return n
    }
  } catch { /* page may not be ready */ }

  return null
}

// ---------------------------------------------------------------------------
// BooksChina product-page detection helpers
// ---------------------------------------------------------------------------

function isBooksChinaProductPage(url: string): { matched: true } | { matched: false } {
  // Matches: https://www.bookschina.com/1234567.htm
  //          https://m.bookschina.com/1234567.htm
  if (/^https?:\/\/(?:www|m)\.bookschina\.com\/\d+\.htm/.test(url)) return { matched: true }
  return { matched: false }
}

// ---------------------------------------------------------------------------
// Price extraction for BooksChina: server-rendered, price in .sellPrice span
// ---------------------------------------------------------------------------

function extractBooksChinaPrice(): number | null {
  try {
    // Primary: .sellPrice — strip the child <i> yen symbol, read text
    const el = document.querySelector('.sellPrice')
    if (el) {
      const clone = el.cloneNode(true) as Element
      clone.querySelectorAll('i').forEach(i => i.remove())
      const text = clone.textContent?.trim() ?? ''
      const n = parseFloat(text)
      if (isFinite(n) && n > 0) return n
    }

    // Fallback: .salePrice (used in related-book cards, may appear on page)
    const saleEl = document.querySelector('.salePrice')
    if (saleEl) {
      const text = (saleEl.textContent ?? '').replace(/[^0-9.]/g, '')
      const n = parseFloat(text)
      if (isFinite(n) && n > 0) return n
    }

    // Fallback: ld+json structured data
    const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    for (const s of ldScripts) {
      try {
        const obj = JSON.parse(s.textContent ?? '')
        const p = obj?.offers?.price ?? obj?.price
        if (p !== undefined) {
          const n = parseFloat(String(p))
          if (isFinite(n) && n > 0) return n
        }
      } catch { /* skip */ }
    }
  } catch { /* page may not be ready */ }

  return null
}

// ---------------------------------------------------------------------------
// JD product-page detection helpers
// ---------------------------------------------------------------------------

function isJdProductPage(url: string): { matched: true; sku: string } | { matched: false } {
  // Matches: https://item.jd.com/1234567.html
  const m = url.match(/^https?:\/\/item\.jd\.com\/(\d+)\.html/)
  if (m) return { matched: true, sku: m[1] }
  return { matched: false }
}

// ---------------------------------------------------------------------------
// Price extraction: try multiple strategies, return null if all fail
// ---------------------------------------------------------------------------

function extractJdPrice(sku: string): number | null {
  try {
    // Strategy 1: window.__PRICE_CONF__ (JD sometimes embeds this)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    if (w.__PRICE_CONF__) {
      const pc = w.__PRICE_CONF__
      const p = pc?.['J_' + sku]?.p ?? pc?.p
      const n = typeof p === 'string' ? parseFloat(p) : typeof p === 'number' ? p : NaN
      if (isFinite(n) && n > 0) return n
    }

    // Strategy 2: .J-p-<sku> element (classic JD price node)
    const priceEl = document.querySelector(`.J-p-${sku}`) ?? document.querySelector(`[data-sku="${sku}"] .p-price`)
    if (priceEl) {
      const text = priceEl.textContent ?? ''
      const m = text.match(/([0-9]+(?:\.[0-9]{1,2})?)/)
      if (m) {
        const n = parseFloat(m[1])
        if (isFinite(n) && n > 0) return n
      }
    }

    // Strategy 3: common price selectors on item page
    const selectors = [
      '.price-box .price',
      '#pricec .p-price strong',
      '.J_price strong',
      '[class*="price-now"]',
      '[class*="now-price"]',
      '.p-current-price',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (!el) continue
      const text = el.textContent ?? ''
      const m = text.match(/([0-9]+(?:\.[0-9]{1,2})?)/)
      if (m) {
        const n = parseFloat(m[1])
        if (isFinite(n) && n > 0) return n
      }
    }

    // Strategy 4: ld+json structured data
    const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    for (const s of ldScripts) {
      try {
        const obj = JSON.parse(s.textContent ?? '')
        const p = obj?.offers?.price ?? obj?.price
        if (p !== undefined) {
          const n = parseFloat(String(p))
          if (isFinite(n) && n > 0) return n
        }
      } catch { /* skip */ }
    }
  } catch { /* page may not be ready */ }

  return null
}

// ---------------------------------------------------------------------------
// Overlay UI
// ---------------------------------------------------------------------------

const OVERLAY_ID = 'tomekeep-capture-overlay'

function removeOverlay() {
  document.getElementById(OVERLAY_ID)?.remove()
}

function injectOverlay(channel: CaptureChannel, url: string, prefilledPrice: number | null) {
  removeOverlay()

  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  overlay.style.cssText = [
    'position: fixed',
    'bottom: 24px',
    'right: 24px',
    'z-index: 2147483647',
    'background: #fff',
    'border: 1.5px solid #e0e0e0',
    'border-radius: 12px',
    'box-shadow: 0 4px 24px rgba(0,0,0,0.15)',
    'padding: 16px 20px',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'font-size: 14px',
    'color: #1a1a1a',
    'min-width: 240px',
    'max-width: 320px',
  ].join(';')

  const channelLabel: Record<CaptureChannel, string> = { jd: '京东', dangdang: '当当', bookschina: '中图网' }

  // Build overlay UI via DOM API (avoids innerHTML / XSS risk)
  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;'
  const headerTitle = document.createElement('span')
  headerTitle.style.cssText = 'font-weight:600;font-size:15px;'
  headerTitle.textContent = '保存到 TomeKeep'
  const closeBtn = document.createElement('button')
  closeBtn.id = 'tk-close'
  closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:18px;color:#999;line-height:1;padding:0 0 0 8px;'
  closeBtn.textContent = '×'
  header.appendChild(headerTitle)
  header.appendChild(closeBtn)

  const channelRow = document.createElement('div')
  channelRow.style.cssText = 'margin-bottom:8px;'
  const channelBadge = document.createElement('span')
  channelBadge.style.cssText = 'display:inline-block;padding:2px 8px;border-radius:4px;background:#fff1f0;color:#c0392b;font-size:12px;font-weight:500;'
  channelBadge.textContent = channelLabel[channel]
  channelRow.appendChild(channelBadge)

  const priceRow = document.createElement('div')
  priceRow.style.cssText = 'margin-bottom:10px;'
  const priceLabel = document.createElement('label')
  priceLabel.style.cssText = 'display:block;font-size:12px;color:#666;margin-bottom:4px;'
  priceLabel.textContent = '价格（元）'
  const priceInput = document.createElement('input')
  priceInput.id = 'tk-price'
  priceInput.type = 'number'
  priceInput.step = '0.01'
  priceInput.min = '0.01'
  priceInput.value = prefilledPrice !== null ? prefilledPrice.toFixed(2) : ''
  priceInput.placeholder = '请输入价格'
  priceInput.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid #d0d0d0;border-radius:6px;font-size:14px;outline:none;'
  const priceHint = document.createElement('div')
  priceHint.style.cssText = prefilledPrice !== null
    ? 'font-size:11px;color:#52c41a;margin-top:3px;'
    : 'font-size:11px;color:#faad14;margin-top:3px;'
  priceHint.textContent = prefilledPrice !== null ? '已自动识别价格' : '未能自动识别，请手动输入'
  priceRow.appendChild(priceLabel)
  priceRow.appendChild(priceInput)
  priceRow.appendChild(priceHint)

  const btnRow = document.createElement('div')
  btnRow.style.cssText = 'display:flex;gap:8px;'
  const confirmBtn = document.createElement('button')
  confirmBtn.id = 'tk-confirm'
  confirmBtn.style.cssText = 'flex:1;padding:8px 0;background:#c0392b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;'
  confirmBtn.textContent = '确认保存'
  const cancelBtn = document.createElement('button')
  cancelBtn.id = 'tk-cancel'
  cancelBtn.style.cssText = 'flex:1;padding:8px 0;background:#f5f5f5;color:#555;border:none;border-radius:6px;cursor:pointer;font-size:14px;'
  cancelBtn.textContent = '取消'
  btnRow.appendChild(confirmBtn)
  btnRow.appendChild(cancelBtn)

  const errorDiv = document.createElement('div')
  errorDiv.id = 'tk-error'
  errorDiv.style.cssText = 'margin-top:8px;font-size:12px;color:#e74c3c;display:none;'

  overlay.appendChild(header)
  overlay.appendChild(channelRow)
  overlay.appendChild(priceRow)
  overlay.appendChild(btnRow)
  overlay.appendChild(errorDiv)

  // Defensive guard: body should always exist here (we wait for it via
  // whenDomReady), but guard anyway to avoid a silent crash.
  if (!document.body) return
  document.body.appendChild(overlay)

  // Focus price input if no prefilled price
  if (priceInput && prefilledPrice === null) priceInput.focus()

  function showError(msg: string) {
    errorDiv.textContent = msg
    errorDiv.style.display = 'block'
  }

  closeBtn.addEventListener('click', () => {
    removeOverlay()
    cancelCapture()
  })

  cancelBtn.addEventListener('click', () => {
    removeOverlay()
    cancelCapture()
  })

  confirmBtn.addEventListener('click', () => {
    const raw = priceInput.value.trim()
    const price = parseFloat(raw)
    if (!isFinite(price) || price <= 0) {
      showError('请输入有效的价格（大于 0）')
      return
    }
    const payload: CapturePayload = { channel, url, priceCny: price }
    submitCapture(payload)
    removeOverlay()
  })
}

// ---------------------------------------------------------------------------
// Navigation listener: detect JD product pages and show overlay
// ---------------------------------------------------------------------------

/**
 * Wait for document.body to exist (preload runs at document_start, before
 * <body> is parsed), then call the callback.  If body is already present,
 * calls immediately (synchronously).
 */
function whenBodyReady(fn: () => void) {
  if (document.body) {
    fn()
    return
  }
  // Use a MutationObserver on <html> / document to detect body insertion
  const obs = new MutationObserver(() => {
    if (document.body) {
      obs.disconnect()
      fn()
    }
  })
  obs.observe(document.documentElement, { childList: true, subtree: false })
}

/**
 * Wait for DOMContentLoaded (or fire immediately if already past that point),
 * then wait for body, then call fn.
 */
function whenDomReady(fn: () => void) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => whenBodyReady(fn), { once: true })
  } else {
    whenBodyReady(fn)
  }
}

function handleNavigation(url: string) {
  const bcResult = isBooksChinaProductPage(url)
  if (bcResult.matched) {
    // BooksChina is server-rendered — price nodes exist in the initial HTML.
    whenDomReady(() => {
      const price = extractBooksChinaPrice()
      injectOverlay('bookschina', url, price)
    })
    return
  }

  const ddResult = isDangdangProductPage(url)
  if (ddResult.matched) {
    // Dangdang is server-rendered — price nodes exist in the initial HTML.
    // Still wait for DOM ready in case preload fires before parsing completes.
    whenDomReady(() => {
      const price = extractDangdangPrice()
      injectOverlay('dangdang', url, price)
    })
    return
  }

  const jdResult = isJdProductPage(url)
  if (jdResult.matched) {
    const sku = jdResult.sku
    // Wait for DOM to be ready, then give the page an extra moment for price
    // nodes to be rendered by JS (JD detail pages hydrate asynchronously).
    whenDomReady(() => {
      // First attempt immediately after DOM ready
      const priceImmediate = extractJdPrice(sku)
      if (priceImmediate !== null) {
        injectOverlay('jd', url, priceImmediate)
        return
      }
      // Price not yet available — retry after 1.5 s to allow JS hydration
      setTimeout(() => {
        const price = extractJdPrice(sku)
        injectOverlay('jd', url, price)
      }, 1500)
    })
    return
  }

  // Not a recognised product page — remove any existing overlay
  removeOverlay()
}

// Initial check on load (covers full-page navigations)
handleNavigation(window.location.href)

// React to SPA navigation (history.pushState / replaceState / popstate)
window.addEventListener('popstate', () => handleNavigation(window.location.href))

const _origPush = history.pushState.bind(history)
history.pushState = function (...args) {
  _origPush(...args)
  handleNavigation(window.location.href)
}

const _origReplace = history.replaceState.bind(history)
history.replaceState = function (...args) {
  _origReplace(...args)
  handleNavigation(window.location.href)
}
