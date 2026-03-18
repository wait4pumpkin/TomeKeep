import { describe, expect, it } from 'vitest'
import {
  parseBooksChinaPriceFromProductHtml,
  parseBooksChinaProductUrlFromSearchHtml,
  parseDangdangPriceFromHtml,
  parseDangdangProductUrlFromSearchHtml,
  parseJdPriceApiJson,
  parseJdSkusFromSearchHtml,
  parseJdSkuFromSearchHtml,
} from './pricing'

describe('pricing', () => {
  it('parses jd sku from search html', () => {
    const html = `<a href="//item.jd.com/100012043978.html" target="_blank">X</a>`
    expect(parseJdSkuFromSearchHtml(html)).toEqual({ ok: true, value: '100012043978' })
  })

  it('parses jd skus from skuId json', () => {
    const html = `{"skuId":123,"name":"a"}{"skuId":"456","name":"b"}`
    expect(parseJdSkusFromSearchHtml(html, 10)).toEqual(['123', '456'])
  })

  it('parses jd price api json', () => {
    const json = [{ id: 'J_1', p: '29.90' }]
    expect(parseJdPriceApiJson(json)).toEqual({ ok: true, value: 29.9 })
  })

  it('parses booksChina product url from search html', () => {
    const html = `<a href="/1234567.htm">book</a>`
    expect(parseBooksChinaProductUrlFromSearchHtml(html)).toEqual({ ok: true, value: 'https://m.bookschina.com/1234567.htm' })
  })

  it('parses booksChina price from product html', () => {
    const html = `<div class="sellPrice">￥39.80</div>`
    const res = parseBooksChinaPriceFromProductHtml(html)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toBe(39.8)
  })

  it('parses dangdang product url from search html', () => {
    const html = `<a href="//product.dangdang.com/123456789.html">book</a>`
    expect(parseDangdangProductUrlFromSearchHtml(html)).toEqual({
      ok: true,
      value: 'https://product.dangdang.com/123456789.html',
    })
  })

  it('parses dangdang price from product html', () => {
    const html = `<span id="dd-price">¥29.90</span>`
    const res = parseDangdangPriceFromHtml(html)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toBe(29.9)
  })
})
