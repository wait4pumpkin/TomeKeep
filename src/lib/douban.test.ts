import { describe, expect, it } from 'vitest'
import { extractDoubanSubjectId, parseDoubanSubjectHtml } from './douban'

describe('douban', () => {
  describe('extractDoubanSubjectId', () => {
    it('accepts subject id digits', () => {
      expect(extractDoubanSubjectId('38210549')).toEqual({ ok: true, value: '38210549' })
    })

    it('extracts id from https URL', () => {
      expect(extractDoubanSubjectId('https://book.douban.com/subject/38210549/')).toEqual({ ok: true, value: '38210549' })
    })

    it('extracts id from schemeless URL', () => {
      expect(extractDoubanSubjectId('book.douban.com/subject/38210549/?foo=bar')).toEqual({ ok: true, value: '38210549' })
    })

    it('rejects non-douban host', () => {
      expect(extractDoubanSubjectId('https://example.com/subject/38210549/')).toEqual({ ok: false, error: 'invalid_url' })
    })
  })

  describe('parseDoubanSubjectHtml', () => {
    it('parses title/author/publisher/cover/isbn13 from minimal html', () => {
      const html = `
        <html>
          <head>
            <meta property="og:image" content="https://img.example/cover.jpg" />
          </head>
          <body>
            <span property="v:itemreviewed">示例书名</span>
            <div id="info">
              <span class="pl">作者</span>: <a href="/author/1">张三</a> / <a href="/author/2">李四</a><br/>
              <span class="pl">出版社:</span> 测试出版社<br/>
              <span class="pl">ISBN:</span> 9783161484100<br/>
            </div>
          </body>
        </html>
      `

      const res = parseDoubanSubjectHtml(html)
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.value.isbn13).toBe('9783161484100')
        expect(res.value.title).toBe('示例书名')
        expect(res.value.author).toBe('张三, 李四')
        expect(res.value.publisher).toBe('测试出版社')
        expect(res.value.coverUrl).toBe('https://img.example/cover.jpg')
      }
    })

    it('returns bad_response when isbn missing', () => {
      const html = `<html><body><span property="v:itemreviewed">X</span></body></html>`
      expect(parseDoubanSubjectHtml(html)).toEqual({ ok: false, error: 'bad_response' })
    })
  })
})
