import { describe, expect, it } from 'vitest'
import { parseOpenLibraryBooksApiResponse } from './openLibrary'

describe('openLibrary', () => {
  it('parses title/author/publisher/cover from Books API response', () => {
    const isbn13 = '9783161484100'
    const data = {
      [`ISBN:${isbn13}`]: {
        title: 'Example Title',
        authors: [{ name: 'Alice' }, { name: 'Bob' }],
        publishers: [{ name: 'Pub House' }],
        cover: { large: 'https://covers.openlibrary.org/b/id/1-L.jpg' },
      },
    }

    const res = parseOpenLibraryBooksApiResponse(isbn13, data)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.isbn13).toBe(isbn13)
      expect(res.value.title).toBe('Example Title')
      expect(res.value.author).toBe('Alice, Bob')
      expect(res.value.publisher).toBe('Pub House')
      expect(res.value.coverUrl).toContain('openlibrary.org')
    }
  })

  it('returns not_found when record missing', () => {
    const res = parseOpenLibraryBooksApiResponse('9783161484100', {})
    expect(res).toEqual({ ok: false, error: 'not_found' })
  })
})

