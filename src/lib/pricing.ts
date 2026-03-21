export type ParseResult<T, E extends string> = { ok: true; value: T } | { ok: false; error: E }

export interface PriceOffer {
  url: string
  priceCny: number
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
    const windowText = html.slice(m.index, Math.min(html.length, m.index + 800))
    const p = windowText.match(/(?:¥|&yen;)\s*([0-9]+(?:\.[0-9]{1,2})?)/)
    if (!p) continue
    const price = Number(p[1])
    if (!Number.isFinite(price) || price <= 0) continue
    offers.push({ url: normalizeBooksChinaProductUrl(url), priceCny: price })
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

  const value = candidates.find(Boolean)
  if (!value) return { ok: false, error: 'not_found' }

  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'bad_number' }
  return { ok: true, value: n }
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
  const re = /href="(\/\/product\.dangdang\.com\/\d+\.html|https?:\/\/product\.dangdang\.com\/\d+\.html)"/g
  for (let m = re.exec(html); m && offers.length < limit; m = re.exec(html)) {
    const url = m[1].startsWith('http') ? m[1] : `https:${m[1]}`
    const windowText = html.slice(m.index, Math.min(html.length, m.index + 900))
    const p = windowText.match(/(?:¥|&yen;)\s*([0-9]+(?:\.[0-9]{1,2})?)/)
    if (!p) continue
    const price = Number(p[1])
    if (!Number.isFinite(price) || price <= 0) continue
    offers.push({ url, priceCny: price })
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
  const value = candidates.find(Boolean)
  if (!value) return { ok: false, error: 'not_found' }
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'bad_number' }
  return { ok: true, value: n }
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
