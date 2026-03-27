/**
 * One-shot script: find ISBN-only books in db.json and repair them
 * using the same waterfall as onMobileScanDetected:
 *   1. Douban search → Douban detail
 *   2. OpenLibrary
 *   3. isbnsearch.org
 *
 * Run with: node scripts/fix-isbn-only-books.mjs
 */

import fs from 'fs'
import https from 'https'
import path from 'path'
import os from 'os'

const DB_PATH = path.join(os.homedir(), 'Library/Application Support/TomeKeep/db.json')

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...headers,
    }
    const req = https.get(url, { headers: defaultHeaders }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location, headers).then(resolve).catch(reject)
      }
      let data = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Parsers (mirrors src/lib/*.ts)
// ---------------------------------------------------------------------------

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
}

function parseDoubanSearchHtml(html) {
  const hits = []
  const itemRe = /<div class="subject-item">([\s\S]*?)<\/div>\s*<\/div>/g
  let m
  while ((m = itemRe.exec(html)) !== null) {
    const block = m[1]
    const idM = block.match(/\/subject\/(\d+)\//)
    const titleM = block.match(/<a[^>]+title="([^"]+)"/)
    const authorM = block.match(/著者[：:]\s*([^<\n]+)/) ?? block.match(/<span class="author"[^>]*>\s*([^<]+)/)
    if (idM && titleM) {
      hits.push({ subjectId: idM[1], title: titleM[1].trim(), author: authorM?.[1]?.trim() })
    }
  }
  // Broader fallback: grab any subject IDs with associated titles from og or li.subject-item
  if (hits.length === 0) {
    const re2 = /href="https?:\/\/book\.douban\.com\/subject\/(\d+)\/"[^>]*title="([^"]+)"/g
    while ((m = re2.exec(html)) !== null) {
      hits.push({ subjectId: m[1], title: m[2].trim() })
    }
  }
  return hits
}

function parseDoubanSubjectHtml(html) {
  const title =
    (html.match(/<span[^>]*property=["']v:itemreviewed["'][^>]*>([^<]+)<\/span>/i) ??
     html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ??
     html.match(/<title[^>]*>([^<]+)<\/title>/i))?.[1]?.trim()

  if (!title) return null

  const authorM = html.match(/<span[^>]*class=["'][^"']*author[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)
    ?? html.match(/作者[：:]\s*<\/span>([\s\S]*?)<\/span>/i)
  const author = authorM ? stripTags(authorM[1]).trim().replace(/\s+/g, ' ') : undefined

  const publisherM = html.match(/出版社[：:]\s*<\/span>\s*<a[^>]*>([^<]+)<\/a>/i)
    ?? html.match(/出版社[：:].*?<a[^>]*>([^<]+)<\/a>/i)
  const publisher = publisherM ? publisherM[1].trim() : undefined

  const coverM = html.match(/<img[^>]+rel=["']v:photo["'][^>]+src=["']([^"']+)["']/i)
    ?? html.match(/<img[^>]+id=["']book-cover-section["'][^>]+src=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
  const coverUrl = coverM?.[1]?.trim()

  return { title, author, publisher, coverUrl }
}

function parseOpenLibrary(isbn13, json) {
  const key = `ISBN:${isbn13}`
  const record = json[key]
  if (!record) return null
  const title = record.title?.trim() || undefined
  const authors = Array.isArray(record.authors) ? record.authors.map(a => a.name).filter(Boolean).join(', ') : undefined
  const publishers = Array.isArray(record.publishers) ? record.publishers.map(p => p.name).filter(Boolean).join(', ') : undefined
  const cover = record.cover
  const coverUrl = cover?.large || cover?.medium || cover?.small || undefined
  return { title, author: authors || undefined, publisher: publishers || undefined, coverUrl }
}

function parseIsbnSearch(isbn13, html) {
  const titleM = html.match(/<div[^>]+class="bookinfo"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const title = titleM ? stripTags(titleM[1]).trim() : undefined
  if (!title) return null

  const authorM = html.match(/Author:\s*<\/(?:b|strong)>\s*([\s\S]*?)<\/p>/i)
    ?? html.match(/Author:\s*([\s\S]*?)<\/p>/i)
  const author = authorM ? stripTags(authorM[1]).trim() : undefined

  const publisherM = html.match(/Publisher:\s*<\/(?:b|strong)>\s*([\s\S]*?)<\/p>/i)
    ?? html.match(/Publisher:\s*([\s\S]*?)<\/p>/i)
  const publisherRaw = publisherM ? stripTags(publisherM[1]).trim() : undefined
  const publisher = publisherRaw ? publisherRaw.replace(/,\s*\d{4}.*$/, '').trim() : undefined

  const coverM = html.match(/<div[^>]+class="image"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i)
  const coverUrl = coverM ? coverM[1].trim() : undefined

  return { title, author: author || undefined, publisher: publisher || undefined, coverUrl }
}

// ---------------------------------------------------------------------------
// Lookup waterfall
// ---------------------------------------------------------------------------

async function lookupDouban(isbn13) {
  console.log(`  [douban] searching ${isbn13}`)
  try {
    const searchUrl = `https://www.douban.com/search?cat=1001&q=${isbn13}`
    const searchRes = await fetchUrl(searchUrl, { 'Accept-Language': 'zh-CN,zh;q=0.9' })
    const hits = parseDoubanSearchHtml(searchRes.body)
    console.log(`  [douban] search hits: ${hits.length}`)
    if (hits.length === 0) return null

    const subjectUrl = `https://book.douban.com/subject/${hits[0].subjectId}/`
    console.log(`  [douban] fetching subject ${subjectUrl}`)
    const detailRes = await fetchUrl(subjectUrl, { 'Accept-Language': 'zh-CN,zh;q=0.9' })
    if (detailRes.status === 404) return null
    const meta = parseDoubanSubjectHtml(detailRes.body)
    if (meta?.title) {
      console.log(`  [douban] OK: "${meta.title}"`)
      return meta
    }
  } catch (e) {
    console.log(`  [douban] error: ${e.message}`)
  }
  return null
}

async function lookupOpenLibrary(isbn13) {
  console.log(`  [openlibrary] looking up ${isbn13}`)
  try {
    const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&jscmd=data&format=json`
    const res = await fetchUrl(url)
    const json = JSON.parse(res.body)
    const meta = parseOpenLibrary(isbn13, json)
    if (meta?.title) {
      console.log(`  [openlibrary] OK: "${meta.title}"`)
      return meta
    }
  } catch (e) {
    console.log(`  [openlibrary] error: ${e.message}`)
  }
  return null
}

async function lookupIsbnSearch(isbn13) {
  console.log(`  [isbnsearch] looking up ${isbn13}`)
  try {
    const url = `https://isbnsearch.org/isbn/${isbn13}`
    const res = await fetchUrl(url)
    if (res.status === 404) return null
    const meta = parseIsbnSearch(isbn13, res.body)
    if (meta?.title) {
      console.log(`  [isbnsearch] OK: "${meta.title}"`)
      return meta
    }
    console.log(`  [isbnsearch] not found (status ${res.status})`)
  } catch (e) {
    console.log(`  [isbnsearch] error: ${e.message}`)
  }
  return null
}

async function lookupIsbn(isbn13) {
  return (await lookupDouban(isbn13))
    ?? (await lookupOpenLibrary(isbn13))
    ?? (await lookupIsbnSearch(isbn13))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const raw = fs.readFileSync(DB_PATH, 'utf8')
const db = JSON.parse(raw)
const books = db.books ?? []

const isbnOnly = books.filter(b => b.title === b.isbn || b.author === '—')
console.log(`Found ${isbnOnly.length} ISBN-only book(s):\n`)

let changed = 0
for (const book of isbnOnly) {
  console.log(`Book id=${book.id} isbn=${book.isbn}`)
  const meta = await lookupIsbn(book.isbn)
  if (!meta) {
    console.log(`  → no metadata found, skipping\n`)
    continue
  }
  if (meta.title)     book.title     = meta.title
  if (meta.author)    book.author    = meta.author
  if (meta.publisher) book.publisher = meta.publisher
  if (meta.coverUrl)  book.coverUrl  = meta.coverUrl
  console.log(`  → patched: title="${book.title}" author="${book.author}"\n`)
  changed++
}

if (changed > 0) {
  // Write backup first
  const backupPath = DB_PATH + '.bak'
  fs.writeFileSync(backupPath, raw, 'utf8')
  console.log(`Backup written to ${backupPath}`)
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8')
  console.log(`db.json updated (${changed} book(s) patched)`)
} else {
  console.log('No changes made.')
}
