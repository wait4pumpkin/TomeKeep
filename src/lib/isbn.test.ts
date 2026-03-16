import { describe, expect, it } from 'vitest'
import { convertIsbn10ToIsbn13, isValidIsbn10, isValidIsbn13, normalizeIsbn } from './isbn'

describe('isbn', () => {
  it('validates ISBN-13 checksum', () => {
    expect(isValidIsbn13('9783161484100')).toBe(true)
    expect(isValidIsbn13('9783161484101')).toBe(false)
  })

  it('validates ISBN-10 checksum', () => {
    expect(isValidIsbn10('316148410X')).toBe(true)
    expect(isValidIsbn10('3161484100')).toBe(false)
  })

  it('normalizes from decorated strings', () => {
    const r1 = normalizeIsbn('ISBN 978-3-16-148410-0')
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(r1.value.kind).toBe('isbn13')
      expect(r1.value.normalized).toBe('9783161484100')
    }

    const r2 = normalizeIsbn(' 316-148410-X ')
    expect(r2.ok).toBe(true)
    if (r2.ok) {
      expect(r2.value.kind).toBe('isbn10')
      expect(r2.value.normalized).toBe('316148410X')
    }
  })

  it('converts ISBN-10 to ISBN-13 for lookup', () => {
    expect(convertIsbn10ToIsbn13('316148410X')).toBe('9783161484100')
  })
})
