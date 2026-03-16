import { ipcMain } from 'electron'
import { parseOpenLibraryBooksApiResponse, type BookMetadata } from '../src/lib/openLibrary'

type LookupResult =
  | { ok: true; value: BookMetadata }
  | { ok: false; error: 'invalid_isbn' | 'not_found' | 'timeout' | 'network' | 'bad_response' }

export function setupMetadata() {
  ipcMain.handle('meta:lookup-isbn', async (_event, isbn13: string): Promise<LookupResult> => {
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

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
