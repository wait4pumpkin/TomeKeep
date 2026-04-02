import { describe, expect, it } from 'vitest'
import { convertIsbn10ToIsbn13, isValidIsbn10, isValidIsbn13, normalizeIsbn, parseIsbnSemantics } from './isbn'

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

describe('parseIsbnSemantics', () => {
  it('identifies mainland China (978-7)', () => {
    // 9787302580553 — Tsinghua University Press
    const sem = parseIsbnSemantics('9787302580553')
    expect(sem).not.toBeNull()
    expect(sem!.region).toBe('中国大陆')
    expect(sem!.language).toBe('中文')
  })

  it('identifies Taiwan (978-986)', () => {
    // 9789869417754 is a real Taiwan ISBN
    const sem = parseIsbnSemantics('9789869417754')
    expect(sem).not.toBeNull()
    expect(sem!.region).toBe('台湾')
    expect(sem!.language).toBe('中文')
  })

  it('identifies Hong Kong (978-988)', () => {
    // 9789889012345 starts with 978988 → HK group
    // Build with valid checksum: 978988901234? digit 13
    // checksum for 978988901234: weights 1,3,1,3... on first 12 digits
    // 9,7,8,9,8,8,9,0,1,2,3,4 → 9+21+8+27+8+24+9+0+1+6+3+12=128 → 128%10=8 → (10-8)%10=2
    const sem = parseIsbnSemantics('9789889012342')
    expect(sem).not.toBeNull()
    expect(sem!.region).toBe('香港')
    expect(sem!.language).toBe('中文')
  })

  it('identifies English-language area (978-0 and 978-1)', () => {
    // 9780306406157 — a classic valid English ISBN
    const sem0 = parseIsbnSemantics('9780306406157')
    expect(sem0).not.toBeNull()
    expect(sem0!.region).toBe('英语区')
    expect(sem0!.language).toBe('英语')

    // 978-1 group
    const sem1 = parseIsbnSemantics('9781491950357')
    expect(sem1).not.toBeNull()
    expect(sem1!.region).toBe('英语区')
    expect(sem1!.language).toBe('英语')
  })

  it('identifies German-language area (978-3)', () => {
    const sem = parseIsbnSemantics('9783161484100')
    expect(sem).not.toBeNull()
    expect(sem!.region).toBe('德语区')
    expect(sem!.language).toBe('德语')
  })

  it('identifies Japanese publishing (978-4)', () => {
    const sem = parseIsbnSemantics('9784088820125')
    expect(sem).not.toBeNull()
    expect(sem!.region).toBe('日本')
    expect(sem!.language).toBe('日语')
  })

  it('identifies French-language area (978-2)', () => {
    const sem = parseIsbnSemantics('9782070360024')
    expect(sem).not.toBeNull()
    expect(sem!.region).toBe('法语区')
    expect(sem!.language).toBe('法语')
  })

  it('accepts ISBN-10 input (converts to ISBN-13 first)', () => {
    // 316148410X → 9783161484100 → German
    const sem = parseIsbnSemantics('316148410X')
    expect(sem).not.toBeNull()
    expect(sem!.region).toBe('德语区')
    expect(sem!.language).toBe('德语')
  })

  it('returns null for invalid ISBN', () => {
    expect(parseIsbnSemantics('notanisbn')).toBeNull()
    expect(parseIsbnSemantics('')).toBeNull()
  })
})
