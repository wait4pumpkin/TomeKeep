import { describe, it, expect } from 'vitest'
import { normalizeAuthor } from './author'

describe('normalizeAuthor', () => {
  it('adds space after ASCII square-bracket prefix', () => {
    expect(normalizeAuthor('[美]阿瑟·克拉克')).toBe('[美] 阿瑟·克拉克')
  })

  it('adds space after fullwidth square-bracket prefix', () => {
    expect(normalizeAuthor('【英】道格拉斯·亚当斯')).toBe('【英】 道格拉斯·亚当斯')
  })

  it('adds space after ASCII parenthesis prefix', () => {
    expect(normalizeAuthor('(日)村上春树')).toBe('(日) 村上春树')
  })

  it('adds space after fullwidth parenthesis prefix', () => {
    expect(normalizeAuthor('（法）加缪')).toBe('（法） 加缪')
  })

  it('preserves existing single space', () => {
    expect(normalizeAuthor('[美] 阿瑟·克拉克')).toBe('[美] 阿瑟·克拉克')
  })

  it('collapses multiple spaces after prefix to one', () => {
    expect(normalizeAuthor('[美]  阿瑟·克拉克')).toBe('[美] 阿瑟·克拉克')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeAuthor('  阿瑟·克拉克  ')).toBe('阿瑟·克拉克')
  })

  it('collapses internal whitespace', () => {
    expect(normalizeAuthor('阿瑟  克拉克')).toBe('阿瑟 克拉克')
  })

  it('handles plain name without prefix', () => {
    expect(normalizeAuthor('余华')).toBe('余华')
  })

  it('normalizes each segment in a multi-author string', () => {
    expect(normalizeAuthor('[美]阿瑟·克拉克, [英]道格拉斯·亚当斯')).toBe(
      '[美] 阿瑟·克拉克, [英] 道格拉斯·亚当斯',
    )
  })

  it('handles slash-separated authors', () => {
    expect(normalizeAuthor('[美]阿瑟·克拉克/[英]道格拉斯·亚当斯')).toBe(
      '[美] 阿瑟·克拉克, [英] 道格拉斯·亚当斯',
    )
  })

  it('returns empty string for empty input', () => {
    expect(normalizeAuthor('')).toBe('')
  })

  it('does not alter two-character nationality prefixes', () => {
    expect(normalizeAuthor('[美国]阿瑟·克拉克')).toBe('[美国] 阿瑟·克拉克')
  })
})
