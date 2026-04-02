import { describe, expect, it } from 'vitest'
import {
  parseBooksChinaOffersFromSearchHtml,
  parseBooksChinaPriceFromProductHtml,
  parseDangdangOffersFromSearchHtml,
  parseDangdangPriceFromHtml,
  parseJdOffersFromSearchHtml,
  parseJdPriceFromProductHtml,
  extractProductId,
} from './pricing'

describe('pricing', () => {
  it('parses booksChina price from product html', () => {
    const html = `<div class="sellPrice">￥39.80</div>`
    const res = parseBooksChinaPriceFromProductHtml(html)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toBe(39.8)
  })

  it('parses booksChina offers from search html with ¥ symbol', () => {
    const html = `<a href="/1234567.htm">书名</a> <span class="price">¥39.80</span>`
    const offers = parseBooksChinaOffersFromSearchHtml(html, 10)
    expect(offers).toHaveLength(1)
    expect(offers[0].priceCny).toBe(39.8)
  })

  it('parses booksChina offers from search html with &yen; entity', () => {
    const html = `<a href="/1234567.htm">书名</a> <span class="price">&yen;39.80</span>`
    const offers = parseBooksChinaOffersFromSearchHtml(html, 10)
    expect(offers).toHaveLength(1)
    expect(offers[0].priceCny).toBe(39.8)
  })

  it('extracts title and author from booksChina search result', () => {
    const html =
      `<a href="/1234567.htm">irrelevant link</a>` +
      `<span class="bookname">三体全集</span>` +
      `<span class="author">刘慈欣</span>` +
      `<span class="price">¥55.00</span>`
    const offers = parseBooksChinaOffersFromSearchHtml(html, 10)
    expect(offers).toHaveLength(1)
    expect(offers[0].title).toBe('三体全集')
    expect(offers[0].author).toBe('刘慈欣')
  })

  it('parses dangdang price from product html', () => {
    const html = `<span id="dd-price">¥29.90</span>`
    const res = parseDangdangPriceFromHtml(html)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toBe(29.9)
  })

  it('parses dangdang offers from search html with ¥ symbol', () => {
    const html = `<a href="//product.dangdang.com/23579654.html">书名</a><span class="price">¥44.70</span>`
    const offers = parseDangdangOffersFromSearchHtml(html, 10)
    expect(offers).toHaveLength(1)
    expect(offers[0].priceCny).toBe(44.7)
  })

  it('parses dangdang offers from search html with &yen; entity', () => {
    const html = `<a href="//product.dangdang.com/23579654.html">书名</a><span class="now_price">&yen;44.70</span>`
    const offers = parseDangdangOffersFromSearchHtml(html, 10)
    expect(offers).toHaveLength(1)
    expect(offers[0].priceCny).toBe(44.7)
  })

  it('extracts title and author from dangdang search result via real page structure', () => {
    // Reflects actual Dangdang search page HTML: <li id="p{ID}"> container,
    // title via name="itemlist-title" title attr, price via span.search_now_price,
    // author via name="itemlist-author"
    const html =
      `<li class="line1" id="p23579654">` +
      `<a class="pic" href="//product.dangdang.com/23579654.html" name="itemlist-picture">img</a>` +
      `<p class="name"><a name="itemlist-title" title="三体" href="//product.dangdang.com/23579654.html">三体</a></p>` +
      `<p class="price"><span class="search_now_price">&yen;44.70</span></p>` +
      `<p class="search_book_author"><span><a name="itemlist-author" href="#">刘慈欣</a></span></p>` +
      `</li>`
    const offers = parseDangdangOffersFromSearchHtml(html, 10)
    expect(offers).toHaveLength(1)
    expect(offers[0].title).toBe('三体')
    expect(offers[0].author).toBe('刘慈欣')
  })

  // ── JD ──────────────────────────────────────────────────────────────────

  it('parses JD price from product html via JSON-LD', () => {
    const html = `<script type="application/ld+json">{"@type":"Product","offers":{"price":"59.90"}}</script>`
    const res = parseJdPriceFromProductHtml(html)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toBe(59.9)
  })

  it('parses JD price from product html via jd-price id', () => {
    const html = `<span id="jd-price">¥49.00</span>`
    const res = parseJdPriceFromProductHtml(html)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toBe(49.0)
  })

  it('parses JD offers from search html with ¥ symbol', () => {
    const html = `<a href="//item.jd.com/10086123.html"><em>三体</em></a><span class="price">¥59.90</span>`
    const offers = parseJdOffersFromSearchHtml(html, 10)
    expect(offers).toHaveLength(1)
    expect(offers[0].priceCny).toBe(59.9)
    expect(offers[0].url).toBe('https://item.jd.com/10086123.html')
  })

  it('parses JD offers from search html with &yen; entity', () => {
    const html = `<a href="//item.jd.com/10086123.html">三体</a><span class="price">&yen;59.90</span>`
    const offers = parseJdOffersFromSearchHtml(html, 10)
    expect(offers).toHaveLength(1)
    expect(offers[0].priceCny).toBe(59.9)
  })

  it('respects limit in parseJdOffersFromSearchHtml', () => {
    const item = `<a href="//item.jd.com/111.html">A</a><span>¥10.00</span>`
    const html = item.repeat(5)
    const offers = parseJdOffersFromSearchHtml(html, 3)
    expect(offers).toHaveLength(3)
  })

  // ── extractProductId ────────────────────────────────────────────────────

  it('extracts JD product id from URL', () => {
    expect(extractProductId('https://item.jd.com/1234567.html')).toBe('1234567')
  })

  it('extracts Dangdang product id from URL', () => {
    expect(extractProductId('https://product.dangdang.com/23579654.html')).toBe('23579654')
  })

  it('extracts BooksChina product id from URL', () => {
    expect(extractProductId('https://www.bookschina.com/8888888.htm')).toBe('8888888')
    expect(extractProductId('https://m.bookschina.com/8888888.htm')).toBe('8888888')
  })

  it('returns undefined for unknown URL', () => {
    expect(extractProductId('https://example.com/product/123')).toBeUndefined()
  })
})
