import { describe, expect, it } from 'vitest'
import { extractDoubanSubjectId, parseDoubanSubjectHtml, parseDoubanSearchHtml } from './douban'

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

  describe('parseDoubanSearchHtml', () => {
    // Mirrors the actual HTML structure returned by https://www.douban.com/search?cat=1001&q=<isbn>
    const REAL_SEARCH_HTML = `
<div class="result-list">
  <div class="result">
    <div class="pic">
      <a class="nbg" href="https://www.douban.com/link2/?url=https%3A%2F%2Fbook.douban.com%2Fsubject%2F26987895%2F&amp;query=9787108057587&amp;cat_id=1001&amp;type=search&amp;pos=0" target="_blank" onclick="moreurl(this,{i: '0', query: '9787108057587', from: 'dou_search_book', sid: 26987895, qcat: '1001'})" title="我在伊朗长大" ><img src="https://img2.doubanio.com/view/subject/s/public/s29378051.jpg"></a>
    </div>
    <div class="content">
      <div class="title">
        <h3>
          <span>[书籍]</span>&nbsp;<a href="https://www.douban.com/link2/?url=https%3A%2F%2Fbook.douban.com%2Fsubject%2F26987895%2F&amp;query=9787108057587&amp;cat_id=1001&amp;type=search&amp;pos=0" target="_blank" onclick="moreurl(this,{i: '0'})">我在伊朗长大 </a>
        </h3>
        <div class="rating-info">
          <span class="subject-cast">玛赞·莎塔碧 / 马爱农 / 生活·读书·新知三联书店 / 2017</span>
        </div>
      </div>
    </div>
  </div>
</div>`

    it('parses subjectId, title, author, coverUrl from real-structure HTML', () => {
      const hits = parseDoubanSearchHtml(REAL_SEARCH_HTML)
      expect(hits.length).toBe(1)
      expect(hits[0].subjectId).toBe('26987895')
      expect(hits[0].title).toBe('我在伊朗长大')
      expect(hits[0].author).toBe('玛赞·莎塔碧')
      expect(hits[0].coverUrl).toBe('https://img2.doubanio.com/view/subject/s/public/s29378051.jpg')
    })

    it('returns empty array when no result blocks present', () => {
      expect(parseDoubanSearchHtml('<html><body>no results</body></html>')).toEqual([])
    })

    it('skips blocks without a recognisable subject ID', () => {
      const html = `
<div class="result">
  <div class="title"><h3><a>Some Book</a></h3></div>
</div>`
      expect(parseDoubanSearchHtml(html)).toEqual([])
    })

    it('decodes HTML entities in title', () => {
      const html = `
<div class="result">
  <div class="pic"><a onclick="moreurl(this,{sid: 12345})"></a></div>
  <div class="title"><h3><a>Good &amp; Evil</a></h3></div>
</div>`
      const hits = parseDoubanSearchHtml(html)
      expect(hits.length).toBe(1)
      expect(hits[0].title).toBe('Good & Evil')
    })
  })
})
