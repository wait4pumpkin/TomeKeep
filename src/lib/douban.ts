import { normalizeIsbn, toIsbn13 } from './isbn'
import type { BookMetadata } from './openLibrary'

export type DoubanSubjectIdResult =
  | { ok: true; value: string }
  | { ok: false; error: 'invalid_url' }

export type DoubanParseResult =
  | { ok: true; value: BookMetadata }
  | { ok: false; error: 'not_found' | 'bad_response' }

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

  const info = readFirstMatchText(html, /<div[^>]*\bid=["']info["'][^>]*>([\s\S]*?)<\/div>/i)
  const authorRaw = info ? extractInfoValue(info, '作者') : null
  const publisher = info ? extractInfoValue(info, '出版社') : null
  const isbnRaw = info ? extractInfoValue(info, 'ISBN') : null

  const isbn13 = isbnRaw ? normalizeToIsbn13(isbnRaw) : null
  if (!isbn13) return { ok: false, error: 'bad_response' }

  return {
    ok: true,
    value: {
      isbn13,
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

function readFirstMetaContent(html: string, property: string): string | null {
  const re = new RegExp(`<meta[^>]+property=["']${escapeRegExp(property)}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i')
  return readFirstMatchText(html, re)
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
