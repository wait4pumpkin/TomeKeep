import { describe, expect, it } from 'vitest'
import {
  parseBooksChinaOffersFromSearchHtml,
  parseBooksChinaPriceFromProductHtml,
  parseDangdangOffersFromSearchHtml,
  parseDangdangPriceFromHtml,
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
})
