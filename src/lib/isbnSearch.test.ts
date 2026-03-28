import { describe, it, expect } from 'vitest'
import { isIsbndbPlaceholderUrl, parseIsbnSearchHtml } from './isbnSearch'

describe('isIsbndbPlaceholderUrl', () => {
  it('identifies ISBN-derived placeholder URLs', () => {
    expect(isIsbndbPlaceholderUrl('https://images.isbndb.com/covers/78/81/9780099558781.jpg')).toBe(true)
    expect(isIsbndbPlaceholderUrl('https://images.isbndb.com/covers/00/01/9780000000001.jpg')).toBe(true)
  })

  it('passes numeric-ID real cover URLs', () => {
    expect(isIsbndbPlaceholderUrl('https://images.isbndb.com/covers/11676643482223.jpg')).toBe(false)
    expect(isIsbndbPlaceholderUrl('https://images.isbndb.com/covers/98765432109876.jpg')).toBe(false)
  })

  it('passes non-isbndb URLs', () => {
    expect(isIsbndbPlaceholderUrl('https://img1.doubanio.com/view/subject/l/public/s1234567.jpg')).toBe(false)
    expect(isIsbndbPlaceholderUrl('https://covers.openlibrary.org/b/isbn/9780099558781-L.jpg')).toBe(false)
  })
})

describe('parseIsbnSearchHtml', () => {
  const isbn = '9780099558781'

  it('returns not_found for captcha page (no bookinfo)', () => {
    const html = '<html><body><div class="g-recaptcha"></div></body></html>'
    expect(parseIsbnSearchHtml(isbn, html)).toEqual({ ok: false, error: 'not_found' })
  })

  it('parses title, author, publisher from bookinfo div', () => {
    const html = `
      <div id="book">
        <div class="image"><img src="https://images.isbndb.com/covers/11676643482223.jpg" /></div>
        <div class="bookinfo">
          <h1>A Gentleman in Moscow</h1>
          <p><b>Author:</b> Amor Towles</p>
          <p><b>Publisher:</b> Penguin, 2017</p>
        </div>
      </div>`
    const res = parseIsbnSearchHtml(isbn, html)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.title).toBe('A Gentleman in Moscow')
    expect(res.value.author).toBe('Amor Towles')
    expect(res.value.publisher).toBe('Penguin')
    expect(res.value.coverUrl).toBe('https://images.isbndb.com/covers/11676643482223.jpg')
  })

  it('strips placeholder cover URL from bookinfo result', () => {
    const html = `
      <div id="book">
        <div class="image"><img src="https://images.isbndb.com/covers/78/81/9780099558781.jpg" /></div>
        <div class="bookinfo"><h1>A Gentleman in Moscow</h1></div>
      </div>`
    const res = parseIsbnSearchHtml(isbn, html)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.coverUrl).toBeUndefined()
  })

  it('finds real cover URL via fallback scan when div structure differs', () => {
    const html = `
      <div class="bookinfo"><h1>Some Book</h1></div>
      <img src="https://images.isbndb.com/covers/99887766554433.jpg" />`
    const res = parseIsbnSearchHtml(isbn, html)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.coverUrl).toBe('https://images.isbndb.com/covers/99887766554433.jpg')
  })
})
