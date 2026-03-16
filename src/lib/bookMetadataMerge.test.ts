import { describe, expect, it } from 'vitest'
import { mergeBookDraftWithMetadata } from './bookMetadataMerge'

describe('bookMetadataMerge', () => {
  it('does not overwrite existing title/author', () => {
    const draft = { title: 'My Title', author: 'Me', status: 'unread' }
    const meta = { isbn13: '9783161484100', title: 'Auto Title', author: 'Auto Author' }
    const merged = mergeBookDraftWithMetadata(draft, meta)
    expect(merged.title).toBe('My Title')
    expect(merged.author).toBe('Me')
    expect(merged.isbn).toBe('9783161484100')
  })

  it('fills missing fields', () => {
    const draft = { isbn: undefined, status: 'unread' }
    const meta = { isbn13: '9783161484100', title: 'Auto Title', author: 'Auto Author', publisher: 'Pub', coverUrl: 'x' }
    const merged = mergeBookDraftWithMetadata(draft, meta)
    expect(merged.title).toBe('Auto Title')
    expect(merged.author).toBe('Auto Author')
    expect(merged.publisher).toBe('Pub')
    expect(merged.coverUrl).toBe('x')
  })
})
