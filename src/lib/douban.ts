import { normalizeIsbn, toIsbn13 } from './isbn'
import type { BookMetadata } from './openLibrary'

export type DoubanSubjectIdResult =
  | { ok: true; value: string }
  | { ok: false; error: 'invalid_url' }

export type DoubanParseResult =
  | { ok: true; value: BookMetadata }
  | { ok: false; error: 'not_found' | 'bad_response' }

export type DoubanSearchHit = {
  subjectId: string
  title: string
  author?: string
  coverUrl?: string
}

export function extractDoubanSubjectId(input: string): DoubanSubjectIdResult {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'invalid_url' }

  if (/^\d+$/.test(raw)) return { ok: true, value: raw }

  const normalized =
    raw.startsWith('//') ? `https:${raw}` :
    raw.startsWith('book.douban.com/') ? `https://${raw}` :
    raw

  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    return { ok: false, error: 'invalid_url' }
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'invalid_url' }
  if (url.hostname !== 'book.douban.com') return { ok: false, error: 'invalid_url' }

  const m = url.pathname.match(/^\/subject\/(\d+)\/?$/)
  if (!m) return { ok: false, error: 'invalid_url' }
  return { ok: true, value: m[1] }
}

export function parseDoubanSubjectHtml(html: string): DoubanParseResult {
  const title =
    readFirstMatchText(html, /<span[^>]*\bproperty=["']v:itemreviewed["'][^>]*>([^<]+)<\/span>/i) ??
    readFirstMetaContent(html, 'og:title') ??
    readFirstMatchText(html, /<title[^>]*>([^<]+)<\/title>/i)

  const coverUrl =
    readFirstMetaContent(html, 'og:image') ??
    readFirstMatchText(html, /<div[^>]*\bid=["']mainpic["'][^>]*>[\s\S]*?<img[^>]*\bsrc=["']([^"']+)["']/i)

  // Extract the full #info div content, correctly handling nested <div> elements
  // inside it (e.g. series links). A naive lazy match stops at the first </div>.
  const info = extractDivById(html, 'info')
  const authorRaw = info ? extractInfoValue(info, '作者') : null
  const publisher = info ? extractInfoValue(info, '出版社') : null
  const isbnRaw = info ? extractInfoValue(info, 'ISBN') : null

  const isbn13 = isbnRaw ? normalizeToIsbn13(isbnRaw) : null
  // A missing or non-standard ISBN (e.g. old Chinese book numbers like "10188-216")
  // must NOT prevent parsing — the page still has title, author, cover etc.
  // Callers that require an ISBN (e.g. waterfall by ISBN) will handle isbn13 === null.
  if (!isbn13 && !title) return { ok: false, error: 'bad_response' }

  return {
    ok: true,
    value: {
      isbn13: isbn13 ?? undefined,
      title: title ? normalizeTitle(title) : undefined,
      author: authorRaw ? normalizePeopleList(authorRaw) : undefined,
      publisher: publisher ? normalizeWhitespace(publisher) : undefined,
      coverUrl: coverUrl ? normalizeWhitespace(coverUrl) : undefined,
    },
  }
}

function normalizeToIsbn13(raw: string): string | null {
  const parsed = normalizeIsbn(raw)
  if (!parsed.ok) return null
  return toIsbn13(parsed.value)
}

/**
 * Extract the full inner HTML of the first <div id="<id>"> element, correctly
 * handling any nested <div> elements inside it (a simple lazy regex would stop
 * at the first inner </div>).
 */
function extractDivById(html: string, id: string): string | null {
  // Find the opening tag
  const openRe = new RegExp(`<div[^>]*\\bid=["']${escapeRegExp(id)}["'][^>]*>`, 'i')
  const openM = openRe.exec(html)
  if (!openM) return null

  let pos = openM.index + openM[0].length
  let depth = 1

  while (pos < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', pos)
    const nextClose = html.indexOf('</div', pos)

    if (nextClose === -1) break

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      pos = nextOpen + 4 // skip past '<div'
    } else {
      depth--
      if (depth === 0) {
        return html.slice(openM.index + openM[0].length, nextClose)
      }
      pos = nextClose + 6 // skip past '</div'
    }
  }

  return null
}

function readFirstMetaContent(html: string, property: string): string | null {
  // Match <meta> tags regardless of attribute order (property before or after content)
  const escaped = escapeRegExp(property)
  const rePropertyFirst = new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i')
  const reContentFirst  = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, 'i')
  return readFirstMatchText(html, rePropertyFirst) ?? readFirstMatchText(html, reContentFirst)
}

function extractInfoValue(infoHtml: string, label: string): string | null {
  const re = new RegExp(
    `<span[^>]*class=["']pl["'][^>]*>\\s*${escapeRegExp(label)}\\s*:?\\s*<\\/span>\\s*:?\\s*([\\s\\S]*?)(?:<br\\s*\\/?>|$)`,
    'i',
  )
  const raw = readFirstMatchText(infoHtml, re)
  if (!raw) return null
  const cleaned = cleanupInfoValue(normalizeWhitespace(stripTags(raw)))
  return cleaned ? cleaned : null
}

function cleanupInfoValue(input: string): string {
  return input.replace(/^[:：]\s*/u, '').trim()
}

function readFirstMatchText(html: string, re: RegExp): string | null {
  const m = html.match(re)
  if (!m) return null
  return decodeHtmlEntities(m[1]).trim() || null
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, ' ')
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

function normalizePeopleList(input: string): string {
  const parts = input
    .split(/[/／,，]/g)
    .map(x => normalizeWhitespace(x))
    .filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return parts.join(', ')
}

function normalizeTitle(input: string): string {
  const v = normalizeWhitespace(input)
  return v
    .replace(/\s*\(豆瓣\)\s*$/u, '')
    .replace(/\s*-\s*豆瓣\s*$/u, '')
    .trim()
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Parse Douban search results page HTML into a list of book hits.
 * Handles the redirect-URL link format and nested title/h3 structure
 * that Douban's actual search pages use.
 */
export function parseDoubanSearchHtml(html: string): DoubanSearchHit[] {
  const hits: DoubanSearchHit[] = []

  // Split on <div class="result"> boundaries — each chunk is one result block
  const parts = html.split(/<div[^>]+class=["'][^"']*\bresult\b[^"']*["'][^>]*>/)
  // parts[0] is everything before the first result; parts[1..] are result blocks
  for (let i = 1; i < parts.length && hits.length < 8; i++) {
    const chunk = parts[i]

    // Subject ID from onclick: sid: 26987895
    // Also accept direct book.douban.com/subject/<id>/ links as fallback
    const sidM = chunk.match(/\bsid[：:\s]+(\d+)/)
    const linkM = chunk.match(/book\.douban\.com\/subject\/(\d+)/)
    const subjectId = sidM?.[1] ?? linkM?.[1] ?? null
    if (!subjectId) continue

    // Title: inside <div class="title"> ... <a ...>TITLE</a>
    // Actual structure: <div class="title"><h3><span>...</span><a ...>TITLE</a></h3>...
    const titleM = chunk.match(/<div[^>]+class=["'][^"']*\btitle\b[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/)
    const title = titleM ? decodeHtmlEntities(titleM[1].trim()) : null
    if (!title) continue

    // Author/cast: <span class="subject-cast">作者 / 出版社 / 年份</span>
    const castM = chunk.match(/<span[^>]+class=["']subject-cast["'][^>]*>([^<]+)<\/span>/)
    const cast = castM ? castM[1].trim() : undefined
    const author = cast ? decodeHtmlEntities(cast.split('/')[0].trim()) || undefined : undefined

    // Cover thumbnail
    const imgM = chunk.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/)
    const coverUrl = imgM ? imgM[1].trim() : undefined

    hits.push({ subjectId, title, author, coverUrl })
  }

  return hits
}
