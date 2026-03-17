import { ipcMain } from 'electron'
import { extractDoubanSubjectId, parseDoubanSubjectHtml } from '../src/lib/douban'
import { parseOpenLibraryBooksApiResponse, type BookMetadata } from '../src/lib/openLibrary'

type LookupIsbnResult =
  | { ok: true; value: BookMetadata }
  | { ok: false; error: 'invalid_isbn' | 'not_found' | 'timeout' | 'network' | 'bad_response' }

type LookupDoubanResult =
  | { ok: true; value: BookMetadata }
  | { ok: false; error: 'invalid_url' | 'not_found' | 'timeout' | 'network' | 'bad_response' }

export function setupMetadata() {
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

  ipcMain.handle('meta:lookup-douban', async (_event, input: string): Promise<LookupDoubanResult> => {
    if (typeof input !== 'string') return { ok: false, error: 'invalid_url' }

    const subject = extractDoubanSubjectId(input)
    if (!subject.ok) return { ok: false, error: 'invalid_url' }

    const url = `https://book.douban.com/subject/${subject.value}/`

    try {
      const res = await fetchWithTimeout(url, 8000, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      })

      if (res.status === 404) return { ok: false, error: 'not_found' }
      if (!res.ok) return { ok: false, error: 'network' }

      const html = await res.text()
      const parsed = parseDoubanSubjectHtml(html)
      if (!parsed.ok) return parsed.error === 'not_found' ? { ok: false, error: 'not_found' } : { ok: false, error: 'bad_response' }
      return parsed
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      if (name === 'AbortError') return { ok: false, error: 'timeout' }
      return { ok: false, error: 'network' }
    }
  })
}

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
