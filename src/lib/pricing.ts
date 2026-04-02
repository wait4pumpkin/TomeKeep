export type ParseResult<T, E extends string> = { ok: true; value: T } | { ok: false; error: E }

export interface PriceOffer {
  url: string
  priceCny: number
  /** Book title as shown in the search result listing (used for LLM/bigram matching). */
  title?: string
  /** Author as shown in the search result listing. */
  author?: string
}

// ---------------------------------------------------------------------------
// BooksChina
// ---------------------------------------------------------------------------

export function parseBooksChinaOffersFromSearchHtml(html: string, limit: number): PriceOffer[] {
  const offers: PriceOffer[] = []
  const re = /href="(https?:\/\/(?:www|m)\.bookschina\.com\/\d+\.htm|\/\d+\.htm|\/\d+\/)"/g
  for (let m = re.exec(html); m && offers.length < limit; m = re.exec(html)) {
    const raw = m[1]
    const url = raw.startsWith('http') ? raw : `https://www.bookschina.com${raw}`
    const windowText = html.slice(m.index, Math.min(html.length, m.index + 1000))
    const p = windowText.match(/(?:¥|&yen;)\s*([0-9]+(?:\.[0-9]{1,2})?)/)
    if (!p) continue
    const price = Number(p[1])
    if (!Number.isFinite(price) || price <= 0) continue

    // Extract title: BooksChina uses <span class="bookname"> or <a ...>title text</a>
    // near the product URL, or a <p class="title"> / <h3> wrapper.
    let title: string | undefined
    const titleMatch =
      windowText.match(/<span[^>]*class="[^"]*(?:book[-_]?name|title)[^"]*"[^>]*>([\s\S]{1,120}?)<\/span>/i) ??
      windowText.match(/<p[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]{1,120}?)<\/p>/i) ??
      windowText.match(/<h3[^>]*>([\s\S]{1,120}?)<\/h3>/i) ??
      windowText.match(/<a[^>]*href="[^"]*\/\d+\.htm[^"]*"[^>]*>([\s\S]{1,120}?)<\/a>/i)
    if (titleMatch) {
      title = titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || undefined
    }

    // Extract author: BooksChina typically has <span class="author"> or "作者：" label
    let author: string | undefined
    const authorMatch =
      windowText.match(/<span[^>]*class="[^"]*author[^"]*"[^>]*>([\s\S]{1,80}?)<\/span>/i) ??
      windowText.match(/作者[：:]\s*([\S][^<]{0,60})/)
    if (authorMatch) {
      author = authorMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || undefined
    }

    offers.push({ url: normalizeBooksChinaProductUrl(url), priceCny: price, title, author })
  }
  return offers
}

export function parseBooksChinaPriceFromProductHtml(html: string): ParseResult<number, 'not_found' | 'bad_number'> {
  const candidates: string[] = []

  const m1 = html.match(/(?:sellPrice|salePrice|nowPrice)[^0-9]{0,20}([0-9]+(?:\.[0-9]{1,2})?)/i)
  if (m1) candidates.push(m1[1])

  const m2 = html.match(/(?:售价|现价|价格)[\s\S]{0,60}?([0-9]+(?:\.[0-9]{1,2})?)/)
  if (m2) candidates.push(m2[1])

  const m3 = html.match(/￥\s*([0-9]+(?:\.[0-9]{1,2})?)/)
  if (m3) candidates.push(m3[1])

  const jsonld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)
  if (jsonld) {
    try {
      const obj = JSON.parse(jsonld[1])
      const price = obj?.offers?.price ?? obj?.price
      if (typeof price === 'string' || typeof price === 'number') candidates.push(String(price))
    } catch {}
  }

  for (const c of candidates) {
    if (!c) continue
    const n = Number(c)
    if (Number.isFinite(n) && n > 0) return { ok: true, value: n }
  }
  if (candidates.length === 0) return { ok: false, error: 'not_found' }
  return { ok: false, error: 'bad_number' }
}

export function normalizeBooksChinaProductUrl(url: string): string {
  return url.replace(/^https?:\/\/m\.bookschina\.com\//, 'https://www.bookschina.com/')
}

export function encodeBookschinaStp(input: string): string {
  let out = ''
  for (const ch of input) {
    const code = ch.charCodeAt(0)
    if (code <= 0x7f) out += ch
    else out += `%u${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

// ---------------------------------------------------------------------------
// Dangdang
// ---------------------------------------------------------------------------

export function parseDangdangOffersFromSearchHtml(html: string, limit: number): PriceOffer[] {
  const offers: PriceOffer[] = []

  // Each product is rendered as <li ... id="p{PRODUCT_ID}"> in a ul.bigimg list.
  // We split on these li boundaries so each segment contains exactly one product.
  // Fallback: split on the picture-link anchor (class="pic") which is the first
  // product link in each item.
  const liRe = /<li\b[^>]*\bid="p(\d+)"[^>]*>/g
  const liMatches: Array<{ id: string; start: number }> = []
  for (let m = liRe.exec(html); m; m = liRe.exec(html)) {
    liMatches.push({ id: m[1], start: m.index })
  }

  // If no <li id="p..."> found, fall back to anchoring on product href
  const segments: Array<{ url: string; text: string }> = []
  if (liMatches.length > 0) {
    for (let i = 0; i < liMatches.length; i++) {
      const start = liMatches[i].start
      const end = i + 1 < liMatches.length ? liMatches[i + 1].start : Math.min(html.length, start + 4000)
      const text = html.slice(start, end)
      segments.push({ url: `https://product.dangdang.com/${liMatches[i].id}.html`, text })
    }
  } else {
    // Legacy fallback: scan for product hrefs
    const re = /href="(\/\/product\.dangdang\.com\/\d+\.html|https?:\/\/product\.dangdang\.com\/\d+\.html)"/g
    for (let m = re.exec(html); m; m = re.exec(html)) {
      const url = m[1].startsWith('http') ? m[1] : `https:${m[1]}`
      const text = html.slice(m.index, Math.min(html.length, m.index + 2000))
      segments.push({ url, text })
    }
  }

  for (const { url, text } of segments) {
    if (offers.length >= limit) break

    // Price: <span class="search_now_price">&yen;42.50</span>
    const p = text.match(/<span[^>]*class="[^"]*search_now_price[^"]*"[^>]*>\s*(?:¥|&yen;)\s*([0-9]+(?:\.[0-9]{1,2})?)\s*<\/span>/i)
           ?? text.match(/(?:¥|&yen;)\s*([0-9]+(?:\.[0-9]{1,2})?)/)
    if (!p) continue
    const price = Number(p[1])
    if (!Number.isFinite(price) || price <= 0) continue

    // Title: prefer title="" attribute on the itemlist-title anchor, then strip tags from its content.
    // <a name="itemlist-title" title="书名全文" href="...">书名（含高亮font）</a>
    let title: string | undefined
    const titleAttr = text.match(/name="itemlist-title"[^>]*title="([^"]{1,200})"/)
                   ?? text.match(/title="([^"]{1,200})"[^>]*name="itemlist-title"/)
    if (titleAttr) {
      title = titleAttr[1].trim() || undefined
    } else {
      // Fallback: content of <p class="name"> link
      const titleEl =
        text.match(/<p[^>]*class="[^"]*\bname\b[^"]*"[^>]*>[\s\S]{0,200}?<a[^>]*>([\s\S]{1,200}?)<\/a>/i) ??
        text.match(/<a[^>]*name="itemlist-title"[^>]*>([\s\S]{1,200}?)<\/a>/i)
      if (titleEl) {
        title = titleEl[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || undefined
      }
    }

    // Author: <a name="itemlist-author" ...>作者名</a> inside <p class="search_book_author">
    let author: string | undefined
    const authorMatch =
      text.match(/name="itemlist-author"[^>]*>([^<]{1,80})<\/a>/) ??
      text.match(/<a[^>]*dd_name="商品作者"[^>]*>([^<]{1,80})<\/a>/) ??
      text.match(/作者[：:]\s*([\S][^<]{0,60})/)
    if (authorMatch) {
      author = authorMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || undefined
    }

    offers.push({ url, priceCny: price, title, author })
  }
  return offers
}

export function parseDangdangPriceFromHtml(html: string): ParseResult<number, 'not_found' | 'bad_number'> {
  const candidates: string[] = []
  const m1 = html.match(/search_now_price[^0-9]+([0-9]+(?:\.[0-9]{1,2})?)/i)
  if (m1) candidates.push(m1[1])
  const m2 = html.match(/id="dd-price"[^>]*>\s*¥?\s*([0-9]+(?:\.[0-9]{1,2})?)/i)
  if (m2) candidates.push(m2[1])
  const jsonld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)
  if (jsonld) {
    try {
      const obj = JSON.parse(jsonld[1])
      const price = obj?.offers?.price ?? obj?.price
      if (typeof price === 'string' || typeof price === 'number') candidates.push(String(price))
    } catch {}
  }
  for (const c of candidates) {
    if (!c) continue
    const n = Number(c)
    if (Number.isFinite(n) && n > 0) return { ok: true, value: n }
  }
  if (candidates.length === 0) return { ok: false, error: 'not_found' }
  return { ok: false, error: 'bad_number' }
}

// ---------------------------------------------------------------------------
// JD (京东)
// ---------------------------------------------------------------------------

/**
 * Parse product listings from a JD search results page HTML.
 *
 * JD renders search results as <li class="gl-item"> blocks.  The product URL
 * appears as href="//item.jd.com/XXXXXXX.html".  The price is rendered by JS
 * and appears in the DOM as:
 *
 *   <strong class="price J-p-XXXXXXX"><i>¥</i><em>35.90</em></strong>
 *   or a plain text node:  ¥35.90 / &yen;35.90
 *
 * Because the ¥ symbol is often a separate <i> node, we look for the numeric
 * value in <em>/<strong>/<i> elements that follow the product link, as well
 * as the conventional ¥/&yen; text pattern as fallback.
 */
export function parseJdOffersFromSearchHtml(html: string, limit: number): PriceOffer[] {
  const offers: PriceOffer[] = []
  const re = /href="(\/\/item\.jd\.com\/\d+\.html|https?:\/\/item\.jd\.com\/\d+\.html)"/g
  for (let m = re.exec(html); m && offers.length < limit; m = re.exec(html)) {
    const raw = m[1]
    const url = raw.startsWith('http') ? raw : `https:${raw}`
    // Search within the next 1500 chars for a price
    const windowText = html.slice(m.index, Math.min(html.length, m.index + 1500))

    // Pattern 1: ¥ / &yen; followed by number (works when ¥ is in HTML text)
    const p1 = windowText.match(/(?:¥|&yen;)\s*([0-9]+(?:\.[0-9]{1,2})?)/)

    // Pattern 2: price in <em> or <strong> inside a class containing "price"
    // e.g. <strong class="price J-p-12345"><i>¥</i><em>35.90</em></strong>
    const p2 = windowText.match(/class="[^"]*(?:p-price|J-p-)[^"]*"[^>]*>[\s\S]{0,200}?<em[^>]*>([0-9]+(?:\.[0-9]{1,2})?)<\/em>/)

    // Pattern 3: standalone <em> with a bare decimal — less specific, use last
    const p3 = windowText.match(/<em[^>]*>\s*([0-9]+\.[0-9]{1,2})\s*<\/em>/)

    const priceStr = (p1?.[1]) ?? (p2?.[1]) ?? (p3?.[1])
    if (!priceStr) continue
    const price = Number(priceStr)
    if (!Number.isFinite(price) || price <= 0) continue

    // Try to extract a title from the snippet
    const titleMatch = windowText.match(/<em[^>]*>([\s\S]{1,120}?)<\/em>|<span[^>]*class="[^"]*name[^"]*"[^>]*>([\s\S]{1,120}?)<\/span>/)
    const rawTitle = titleMatch ? (titleMatch[1] ?? titleMatch[2] ?? '') : ''
    const title = rawTitle.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || undefined
    offers.push({ url, priceCny: price, title })
  }
  return offers
}

/**
 * Parse the current price from a JD product page HTML.
 * Tries JSON-LD, then common price selectors via regex.
 */
export function parseJdPriceFromProductHtml(html: string): ParseResult<number, 'not_found' | 'bad_number'> {
  const candidates: string[] = []

  // JSON-LD structured data
  const jsonld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)
  if (jsonld) {
    try {
      const obj = JSON.parse(jsonld[1])
      const price = obj?.offers?.price ?? obj?.price
      if (typeof price === 'string' || typeof price === 'number') candidates.push(String(price))
    } catch {}
  }

  // __PRICE_CONF__ embedded JSON (JD sometimes embeds current prices in the HTML)
  const priceConf = html.match(/window\.__PRICE_CONF__\s*=\s*(\{[\s\S]{0,2000}?\})/)
  if (priceConf) {
    try {
      const obj = JSON.parse(priceConf[1])
      for (const v of Object.values(obj)) {
        const entry = v as Record<string, unknown>
        const p = entry?.p
        if (typeof p === 'string' && /^[0-9]+(?:\.[0-9]{1,2})?$/.test(p)) {
          candidates.push(p)
        }
      }
    } catch {}
  }

  // Common inline price patterns
  const m1 = html.match(/class="[^"]*(?:J-p-|p-price|now-price|price-now|current-price)[^"]*"[^>]*>[^<]*?([0-9]+\.[0-9]{1,2})/)
  if (m1) candidates.push(m1[1])

  const m2 = html.match(/id="jd-price"[^>]*>\s*¥?\s*([0-9]+(?:\.[0-9]{1,2})?)/)
  if (m2) candidates.push(m2[1])

  for (const c of candidates) {
    if (!c) continue
    const n = Number(c)
    if (Number.isFinite(n) && n > 0) return { ok: true, value: n }
  }
  if (candidates.length === 0) return { ok: false, error: 'not_found' }
  return { ok: false, error: 'bad_number' }
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export function pickLowestOffer(offers: PriceOffer[]): ParseResult<PriceOffer, 'not_found'> {
  if (offers.length === 0) return { ok: false, error: 'not_found' }
  let best = offers[0]
  for (const o of offers) {
    if (o.priceCny < best.priceCny) best = o
  }
  return { ok: true, value: best }
}

/**
 * Extract the channel-specific product ID from a product page URL.
 *
 * - JD:         https://item.jd.com/1234567.html    → "1234567"
 * - Dangdang:   https://product.dangdang.com/...html → "..."
 * - BooksChina: https://www.bookschina.com/1234.htm  → "1234"
 */
export function extractProductId(url: string): string | undefined {
  // JD
  const jd = url.match(/item\.jd\.com\/(\d+)\.html/)
  if (jd) return jd[1]
  // Dangdang
  const dd = url.match(/product\.dangdang\.com\/(\d+)\.html/)
  if (dd) return dd[1]
  // BooksChina
  const bc = url.match(/(?:www|m)\.bookschina\.com\/(\d+)\.htm/)
  if (bc) return bc[1]
  return undefined
}
