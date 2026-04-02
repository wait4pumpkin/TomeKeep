/**
 * Step 2 — 逐条搜索豆瓣，断点续传
 *
 * 输入：jd-titles-raw.json（每行一个书名的纯文本文件）
 * 输出：jd-douban.json（匹配进度，可随时 Ctrl+C 后重新运行续传）
 *
 * 运行：node scripts/jd-import/step2-match.mjs
 *
 * 状态说明：
 *   pending   — 尚未处理
 *   matched   — 成功匹配
 *   unmatched — 搜索无结果，需人工处理
 *   error     — 出错，下次运行自动重试
 */

import fs from 'fs'
import https from 'https'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const TITLES_PATH = path.join(__dirname, 'jd-titles-raw.json')
const PROG_PATH   = path.join(__dirname, 'jd-douban.json')

// ---------------------------------------------------------------------------
// 节奏控制
// ---------------------------------------------------------------------------

const DELAY_MIN_MS   = 4000   // 每条之间最短等待
const DELAY_MAX_MS   = 7000   // 每条之间最长等待
const SEARCH_TO_DETAIL_MS = 2000  // 搜索→详情之间的额外等待
const BATCH_EVERY    = 10     // 每 N 条额外长暂停
const BATCH_PAUSE_MS = 25000  // 长暂停时长（25秒）
const FETCH_TIMEOUT  = 12000  // 单次请求超时

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function randomDelay() {
  const ms = DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS))
  process.stdout.write(`  (等待 ${(ms / 1000).toFixed(1)}s)\n`)
  return sleep(ms)
}

// ---------------------------------------------------------------------------
// HTTP fetch
// ---------------------------------------------------------------------------

function fetchUrl(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...extraHeaders,
    }
    const req = https.get(url, { headers }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location
        if (!loc) return reject(new Error('redirect with no location'))
        return fetchUrl(loc, extraHeaders).then(resolve).catch(reject)
      }
      let data = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.setTimeout(FETCH_TIMEOUT, () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// 解析器
// ---------------------------------------------------------------------------

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

function parseDoubanSearchHtml(html) {
  const hits = []
  // Douban search returns <div class="result"> blocks.
  // Subject ID is in onclick="moreurl(this,{..., sid: 123456, ...})"
  // Title is in title="书名" on the same <a class="nbg"> tag.
  const resultRe = /<div class="result">([\s\S]*?)<\/div>\s*<\/div>/g
  let m
  while ((m = resultRe.exec(html)) !== null) {
    const block = m[1]
    // Only book results have [书籍] span
    if (!block.includes('[书籍]')) continue
    const sidM   = block.match(/\bsid:\s*(\d+)/)
    const titleM = block.match(/class="nbg"[^>]+title="([^"]+)"/)
                ?? block.match(/title="([^"]+)"[^>]*class="nbg"/)
    if (sidM && titleM) {
      hits.push({ subjectId: sidM[1], title: titleM[1].trim() })
    }
  }
  // Fallback: extract sid from any onclick in the result section
  if (hits.length === 0) {
    const re2 = /\bsid:\s*(\d+)[^}]*}[^>]*>([^<]+)<\/a>/g
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
     html.match(/<title[^>]*>([^<（(·]+)/i))?.[1]?.trim()
  if (!title) return null

  const authorM = html.match(/<span[^>]*class=["'][^"']*author[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)
    ?? html.match(/作者[：:]\s*<\/span>([\s\S]*?)<\/span>/i)
  const author = authorM ? stripTags(authorM[1]).replace(/\s+/g, ' ').trim() : undefined

  const publisherM = html.match(/出版社[：:]\s*<\/span>\s*<a[^>]*>([^<]+)<\/a>/i)
    ?? html.match(/出版社[：:].*?<a[^>]*>([^<]+)<\/a>/i)
  const publisher = publisherM ? publisherM[1].trim() : undefined

  const isbnM = html.match(/ISBN[：:]\s*<\/span>\s*([\d\-X]+)/i)
    ?? html.match(/ISBN[：:]\s*([\d\-X]+)/i)
  const isbn = isbnM ? isbnM[1].replace(/-/g, '').trim() : undefined

  const coverM = html.match(/<img[^>]+rel=["']v:photo["'][^>]+src=["']([^"']+)["']/i)
    ?? html.match(/<img[^>]+id=["']book-cover-section["'][^>]+src=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
  const coverUrl = coverM?.[1]?.trim()

  return { title, author, publisher, isbn, coverUrl }
}

// ---------------------------------------------------------------------------
// 豆瓣搜索 + 详情
// ---------------------------------------------------------------------------

async function searchDouban(title) {
  const url = `https://www.douban.com/search?cat=1001&q=${encodeURIComponent(title)}`
  const res = await fetchUrl(url)

  if (
    res.status === 403 ||
    res.body.includes('检测到异常请求') ||
    res.body.includes('robot check') ||
    res.body.includes('captcha') ||
    // 豆瓣限流页：页面标题变成"豆瓣"而非"搜索: xxx"，且不含搜索结果区域
    (!res.body.includes('result-list') && res.body.includes('再试一次'))
  ) {
    throw new Error('blocked')
  }
  if (res.status !== 200) throw new Error(`search HTTP ${res.status}`)

  return parseDoubanSearchHtml(res.body)
}

async function fetchDoubanSubject(subjectId) {
  const url = `https://book.douban.com/subject/${subjectId}/`
  const res = await fetchUrl(url)
  if (res.status === 404) return null
  if (res.status !== 200) throw new Error(`subject HTTP ${res.status}`)
  return parseDoubanSubjectHtml(res.body)
}

// ---------------------------------------------------------------------------
// 进度文件
// ---------------------------------------------------------------------------

function loadProgress(titles) {
  if (!fs.existsSync(PROG_PATH)) {
    return titles.map(t => ({ title: t, status: 'pending' }))
  }
  const existing = JSON.parse(fs.readFileSync(PROG_PATH, 'utf8'))
  const byTitle = new Map(existing.map(e => [e.title, e]))
  // 补入 raw 中有但进度文件中没有的新条目
  return titles.map(t => byTitle.get(t) ?? { title: t, status: 'pending' })
}

function saveProgress(progress) {
  fs.writeFileSync(PROG_PATH, JSON.stringify(progress, null, 2), 'utf8')
}

// ---------------------------------------------------------------------------
// 主逻辑
// ---------------------------------------------------------------------------

if (!fs.existsSync(TITLES_PATH)) {
  console.error(`错误：找不到 ${TITLES_PATH}`)
  process.exit(1)
}

// 读取纯文本（每行一个书名）
const rawText = fs.readFileSync(TITLES_PATH, 'utf8')
const titles  = rawText.split('\n').map(l => l.trim()).filter(Boolean)

console.log(`读取到 ${titles.length} 个书名`)

const progress = loadProgress(titles)

const total    = progress.length
const done     = progress.filter(e => e.status === 'matched' || e.status === 'unmatched').length
const pending  = progress.filter(e => e.status === 'pending' || e.status === 'error')

console.log(`已完成 ${done}，待处理 ${pending.length}，共 ${total}\n`)

if (pending.length === 0) {
  printSummary(progress)
  console.log('\n全部处理完毕。请检查 jd-douban.json，然后运行：')
  console.log('  node scripts/jd-import/step3-import.mjs')
  process.exit(0)
}

let processedThisBatch = 0

for (let i = 0; i < progress.length; i++) {
  const entry = progress[i]
  if (entry.status !== 'pending' && entry.status !== 'error') continue

  const idx    = String(i + 1).padStart(3)
  const prefix = `[${idx}/${total}]`

  process.stdout.write(`${prefix} 《${entry.title}》\n`)
  process.stdout.write(`  搜索中 … `)

  try {
    const hits = await searchDouban(entry.title)

    if (!hits || hits.length === 0) {
      entry.status = 'unmatched'
      delete entry.errorMsg
      console.log(`❌ 无搜索结果`)
    } else {
      process.stdout.write(`找到 ${hits.length} 条，取第一条 subject=${hits[0].subjectId} … `)
      await sleep(SEARCH_TO_DETAIL_MS)

      const detail = await fetchDoubanSubject(hits[0].subjectId)

      if (!detail) {
        entry.status    = 'unmatched'
        entry.subjectId = hits[0].subjectId
        delete entry.errorMsg
        console.log(`❌ 详情页不可用`)
      } else {
        entry.status      = 'matched'
        entry.subjectId   = hits[0].subjectId
        entry.doubanTitle = detail.title
        entry.author      = detail.author  ?? ''
        entry.publisher   = detail.publisher ?? ''
        entry.isbn        = detail.isbn ?? ''
        entry.coverUrl    = detail.coverUrl ?? ''
        delete entry.errorMsg
        console.log(`✅ 《${detail.title}》`)
        if (detail.author)    console.log(`     作者：${detail.author}`)
        if (detail.publisher) console.log(`     出版：${detail.publisher}`)
        if (detail.isbn)      console.log(`     ISBN：${detail.isbn}`)
      }
    }
  } catch (err) {
    entry.status   = 'error'
    entry.errorMsg = err.message
    console.log(`⚠️  错误：${err.message}`)

    if (err.message === 'blocked') {
      saveProgress(progress)
      console.log('\n🚫 豆瓣限流/验证码，已保存进度。请稍等几分钟后重新运行。')
      process.exit(1)
    }
  }

  saveProgress(progress)
  processedThisBatch++

  // 是否还有待处理的条目
  const hasMore = progress.slice(i + 1).some(e => e.status === 'pending' || e.status === 'error')
  if (!hasMore) break

  // 每 BATCH_EVERY 条长暂停
  if (processedThisBatch % BATCH_EVERY === 0) {
    console.log(`\n─── 已处理 ${processedThisBatch} 条，长暂停 ${BATCH_PAUSE_MS / 1000} 秒 ───\n`)
    await sleep(BATCH_PAUSE_MS)
  } else {
    await randomDelay()
  }
}

printSummary(progress)

const stillPending = progress.filter(e => e.status === 'pending' || e.status === 'error').length
if (stillPending === 0) {
  console.log('\n请检查 jd-douban.json，对 unmatched 条目手动补充后，运行：')
  console.log('  node scripts/jd-import/step3-import.mjs')
}

// ---------------------------------------------------------------------------

function printSummary(progress) {
  const matched   = progress.filter(e => e.status === 'matched')
  const unmatched = progress.filter(e => e.status === 'unmatched')
  const errors    = progress.filter(e => e.status === 'error')

  console.log()
  console.log('═'.repeat(50))
  console.log(`✅ matched   : ${matched.length}`)
  console.log(`❌ unmatched : ${unmatched.length}`)
  console.log(`⚠️  error     : ${errors.length}`)
  console.log('═'.repeat(50))

  if (unmatched.length > 0) {
    console.log('\nunmatched（需人工处理）：')
    unmatched.forEach((e, i) => console.log(`  ${String(i + 1).padStart(3)}. ${e.title}`))
  }
  if (errors.length > 0) {
    console.log('\nerror（重新运行会自动重试）：')
    errors.forEach((e, i) => console.log(`  ${String(i + 1).padStart(3)}. ${e.title}  [${e.errorMsg}]`))
  }
}
