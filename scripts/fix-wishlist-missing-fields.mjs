/**
 * fix-wishlist-missing-fields.mjs
 *
 * Repairs wishlist items that are missing author (and optionally coverUrl)
 * by fetching their Douban subject pages.
 *
 * - Reads db.json, backs it up to db.json.fix-bak
 * - Only processes items with empty author AND a detailUrl pointing to Douban
 * - 2 second pause between requests to stay well under Douban rate limits
 * - Skips (does not fail) on network error or parse failure
 * - Writes updated db.json when done
 *
 * Usage:
 *   node scripts/fix-wishlist-missing-fields.mjs
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DB_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'tomekeep', 'db.json')
const DELAY_MS = 2000   // 2 s between requests
const TIMEOUT_MS = 10000

// ---------------------------------------------------------------------------
// Parsing helpers (ported from src/lib/douban.ts)
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function normalizeWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim()
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ')
}

function readFirstMatchText(html, re) {
  const m = html.match(re)
  if (!m) return null
  return decodeHtmlEntities(m[1]).trim() || null
}

function readFirstMetaContent(html, property) {
  const esc = escapeRegExp(property)
  const r1 = new RegExp(`<meta[^>]+property=["']${esc}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i')
  const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${esc}["'][^>]*>`, 'i')
  return readFirstMatchText(html, r1) ?? readFirstMatchText(html, r2)
}

function extractDivById(html, id) {
  const openRe = new RegExp(`<div[^>]*\\bid=["']${escapeRegExp(id)}["'][^>]*>`, 'i')
  const openM = openRe.exec(html)
  if (!openM) return null
  let pos = openM.index + openM[0].length
  let depth = 1
  while (pos < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', pos)
    const nextClose = html.indexOf('</div', pos)
    if (nextClose === -1) break
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      pos = nextOpen + 4
    } else {
      depth--
      if (depth === 0) return html.slice(openM.index + openM[0].length, nextClose)
      pos = nextClose + 6
    }
  }
  return null
}

function extractInfoValue(infoHtml, label) {
  const re = new RegExp(
    `<span[^>]*class=["']pl["'][^>]*>\\s*${escapeRegExp(label)}\\s*:?\\s*<\\/span>\\s*:?\\s*([\\s\\S]*?)(?:<br\\s*\\/?>|$)`,
    'i',
  )
  const raw = readFirstMatchText(infoHtml, re)
  if (!raw) return null
  const cleaned = normalizeWhitespace(stripTags(raw)).replace(/^[:：]\s*/u, '').trim()
  return cleaned || null
}

function normalizePeopleList(input) {
  const parts = input.split(/[/／,，]/g).map(x => normalizeWhitespace(x)).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return parts.join(', ')
}

function isPlaceholderCoverUrl(url) {
  return (
    /doubanio\.com\/.*book-default-[ls]pic/.test(url) ||
    /img\d*\.doubanio\.com\/[^?]*book-default/.test(url)
  )
}

function parseDoubanSubjectHtml(html) {
  const title =
    readFirstMatchText(html, /<span[^>]*\bproperty=["']v:itemreviewed["'][^>]*>([^<]+)<\/span>/i) ??
    readFirstMetaContent(html, 'og:title') ??
    readFirstMatchText(html, /<title[^>]*>([^<]+)<\/title>/i)

  const coverUrl =
    readFirstMetaContent(html, 'og:image') ??
    readFirstMatchText(html, /<div[^>]*\bid=["']mainpic["'][^>]*>[\s\S]*?<img[^>]*\bsrc=["']([^"']+)["']/i)

  const info = extractDivById(html, 'info')
  const authorRaw = info ? extractInfoValue(info, '作者') : null
  const publisher = info ? extractInfoValue(info, '出版社') : null

  return {
    title: title ? normalizeWhitespace(title).replace(/\s*\(豆瓣\)\s*$/, '').replace(/\s*-\s*豆瓣\s*$/, '').trim() : undefined,
    author: authorRaw ? normalizePeopleList(authorRaw) : undefined,
    publisher: publisher ? normalizeWhitespace(publisher) : undefined,
    coverUrl: coverUrl ? normalizeWhitespace(coverUrl) : undefined,
  }
}

// ---------------------------------------------------------------------------
// HTTP fetch with timeout + browser-like headers
// ---------------------------------------------------------------------------
async function fetchDouban(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Delay helper
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const raw = fs.readFileSync(DB_PATH, 'utf8')
const db = JSON.parse(raw)
const wishlist = db.wishlist ?? []

// Backup
const bakPath = DB_PATH + '.fix-bak'
if (!fs.existsSync(bakPath)) {
  fs.copyFileSync(DB_PATH, bakPath)
  console.log(`Backed up to ${bakPath}`)
}

// Collect items to fix
const toFix = wishlist.filter(item => {
  const missingAuthor = !item.author?.trim()
  const missingCover = !item.coverUrl || isPlaceholderCoverUrl(item.coverUrl)
  const hasDoubanUrl = typeof item.detailUrl === 'string' && item.detailUrl.includes('book.douban.com/subject/')
  return (missingAuthor || missingCover) && hasDoubanUrl
})

console.log(`Total wishlist: ${wishlist.length}`)
console.log(`Items to fix: ${toFix.length}`)
console.log()

let fixed = 0
let skipped = 0

for (let i = 0; i < toFix.length; i++) {
  const item = toFix[i]
  console.log(`[${i + 1}/${toFix.length}] "${item.title}" — ${item.detailUrl}`)

  try {
    const html = await fetchDouban(item.detailUrl)
    const parsed = parseDoubanSubjectHtml(html)

    let changed = false

    if (!item.author?.trim() && parsed.author) {
      console.log(`  author: "" → "${parsed.author}"`)
      item.author = parsed.author
      changed = true
    }
    if ((!item.coverUrl || isPlaceholderCoverUrl(item.coverUrl)) && parsed.coverUrl && !isPlaceholderCoverUrl(parsed.coverUrl)) {
      console.log(`  cover:  (missing) → "${parsed.coverUrl}"`)
      item.coverUrl = parsed.coverUrl
      changed = true
    }
    if (!item.publisher?.trim() && parsed.publisher) {
      console.log(`  publisher: "" → "${parsed.publisher}"`)
      item.publisher = parsed.publisher
      // publisher is bonus, not counted as primary fix
    }

    if (changed) {
      fixed++
    } else {
      console.log(`  (no usable data found on page)`)
      skipped++
    }
  } catch (err) {
    console.log(`  ERROR: ${err.message} — skipping`)
    skipped++
  }

  // Save incrementally every 10 items
  if ((i + 1) % 10 === 0) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8')
    console.log(`  [saved progress at ${i + 1} items]`)
  }

  if (i < toFix.length - 1) {
    await sleep(DELAY_MS)
  }
}

// Final save
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8')

console.log()
console.log(`Done. Fixed: ${fixed}, Skipped/errored: ${skipped}`)
