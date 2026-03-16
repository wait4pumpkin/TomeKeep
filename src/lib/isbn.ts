export type NormalizedIsbn =
  | { kind: 'isbn13'; normalized: string }
  | { kind: 'isbn10'; normalized: string }

export type NormalizeIsbnResult =
  | { ok: true; value: NormalizedIsbn }
  | { ok: false; error: 'empty' | 'not_isbn' | 'invalid_checksum' }

export function normalizeIsbn(raw: string): NormalizeIsbnResult {
  const input = raw.trim()
  if (!input) return { ok: false, error: 'empty' }

  const digitsOnly = (input.match(/\d/g) ?? []).join('')
  const maybeIsbn10Chars = (input.toUpperCase().match(/[0-9X]/g) ?? []).join('')

  const isbn13Candidate =
    findIsbn13Candidate(digitsOnly) ??
    findIsbn13Candidate((input.match(/97[89]\d{10}/g) ?? [])[0] ?? '') ??
    null

  if (isbn13Candidate) {
    if (!isbn13Candidate.startsWith('978') && !isbn13Candidate.startsWith('979')) {
      return { ok: false, error: 'not_isbn' }
    }
    if (!isValidIsbn13(isbn13Candidate)) return { ok: false, error: 'invalid_checksum' }
    return { ok: true, value: { kind: 'isbn13', normalized: isbn13Candidate } }
  }

  const isbn10Candidate = findIsbn10Candidate(maybeIsbn10Chars)
  if (isbn10Candidate) {
    if (!isValidIsbn10(isbn10Candidate)) return { ok: false, error: 'invalid_checksum' }
    return { ok: true, value: { kind: 'isbn10', normalized: isbn10Candidate } }
  }

  return { ok: false, error: 'not_isbn' }
}

export function toIsbn13(value: NormalizedIsbn): string | null {
  if (value.kind === 'isbn13') return value.normalized
  return convertIsbn10ToIsbn13(value.normalized)
}

export function isValidIsbn13(isbn13: string): boolean {
  if (!/^\d{13}$/.test(isbn13)) return false
  const digits = isbn13.split('').map(d => Number(d))
  const checkDigit = digits[12]
  const sum = digits.slice(0, 12).reduce((acc, d, idx) => acc + d * (idx % 2 === 0 ? 1 : 3), 0)
  const expected = (10 - (sum % 10)) % 10
  return checkDigit === expected
}

export function isValidIsbn10(isbn10: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn10)) return false
  const chars = isbn10.split('')
  const digits = chars.map((c, idx) => {
    if (idx === 9 && c === 'X') return 10
    return Number(c)
  })
  const sum = digits.reduce((acc, d, idx) => acc + d * (10 - idx), 0)
  return sum % 11 === 0
}

export function convertIsbn10ToIsbn13(isbn10: string): string | null {
  if (!isValidIsbn10(isbn10)) return null
  const core = `978${isbn10.slice(0, 9)}`
  const digits = core.split('').map(d => Number(d))
  const sum = digits.reduce((acc, d, idx) => acc + d * (idx % 2 === 0 ? 1 : 3), 0)
  const checkDigit = (10 - (sum % 10)) % 10
  return `${core}${checkDigit}`
}

function findIsbn13Candidate(digitsOnly: string): string | null {
  if (/^\d{13}$/.test(digitsOnly)) return digitsOnly
  const match = digitsOnly.match(/97[89]\d{10}/)
  return match?.[0] ?? null
}

function findIsbn10Candidate(chars: string): string | null {
  if (/^\d{9}[\dX]$/.test(chars)) return chars
  const match = chars.match(/\d{9}[\dX]/)
  return match?.[0] ?? null
}
