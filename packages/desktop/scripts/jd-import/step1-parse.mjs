/**
 * Step 1 — 清洗京东购物车原始标题
 *
 * 准备工作：
 *   在 https://cart.jd.com/cart.action 页面打开浏览器控制台，运行：
 *
 *     copy(JSON.stringify(
 *       [...document.querySelectorAll('.p-name a')].map(a => (a.getAttribute('title') || a.textContent).trim()),
 *       null, 2
 *     ))
 *
 *   将结果粘贴保存为 scripts/jd-import/jd-titles-raw.json
 *
 * 运行：
 *   node scripts/jd-import/step1-parse.mjs
 *
 * 输出：
 *   scripts/jd-import/jd-cart.json
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RAW_PATH  = path.join(__dirname, 'jd-titles-raw.json')
const OUT_PATH  = path.join(__dirname, 'jd-cart.json')

// ---------------------------------------------------------------------------
// 清洗规则
// ---------------------------------------------------------------------------

/**
 * 去除京东商品标题中常见的噪声后缀/括号内容，返回纯书名。
 * 保守原则：只去掉确定是噪声的部分，不猜测。
 */
function cleanTitle(raw) {
  let s = raw.trim()

  // 1. 去除全角/半角括号内的噪声（只去噪声词，避免误删书名副标题）
  //    先整体替换明确的噪声模式，再去空括号
  const noisePatterns = [
    // 装帧
    /[（(]\s*精装\s*[）)]/g,
    /[（(]\s*平装\s*[）)]/g,
    /[（(]\s*硬壳\s*[）)]/g,
    /[（(]\s*软皮\s*[）)]/g,
    /[（(]\s*线装\s*[）)]/g,
    /[（(]\s*全彩\s*[）)]/g,
    /[（(]\s*彩色\s*[）)]/g,
    /[（(]\s*黑白\s*[）)]/g,

    // 套装/册数
    /[（(]\s*套装[共]?\s*\d+\s*册\s*[）)]/g,
    /[（(]\s*全\s*\d+\s*册\s*[）)]/g,
    /[（(]\s*共\s*\d+\s*册\s*[）)]/g,
    /[（(]\s*上下[两二]?册\s*[）)]/g,
    /[（(]\s*上中下册\s*[）)]/g,
    /[（(]\s*全套\s*[）)]/g,
    /[（(]\s*套装\s*[）)]/g,
    /[（(]\s*全集\s*[）)]/g,

    // 版本
    /[（(]\s*增订[第版]?\d*\s*版?\s*[）)]/g,
    /[（(]\s*修订[第版]?\d*\s*版?\s*[）)]/g,
    /[（(]\s*第\s*\d+\s*版\s*[）)]/g,
    /[（(]\s*第\s*[一二三四五六七八九十]+\s*版\s*[）)]/g,
    /[（(]\s*最新版\s*[）)]/g,
    /[（(]\s*新版\s*[）)]/g,
    /[（(]\s*旧版\s*[）)]/g,
    /[（(]\s*原版\s*[）)]/g,
    /[（(]\s*典藏版\s*[）)]/g,
    /[（(]\s*纪念版\s*[）)]/g,
    /[（(]\s*珍藏版\s*[）)]/g,
    /[（(]\s*限量版\s*[）)]/g,
    /[（(]\s*豪华版\s*[）)]/g,
    /[（(]\s*普通版\s*[）)]/g,
    /[（(]\s*学生版\s*[）)]/g,
    /[（(]\s*教师版\s*[）)]/g,

    // 辑/册编号
    /[（(]\s*第\s*\d+\s*辑\s*[）)]/g,
    /[（(]\s*第\s*[一二三四五六七八九十]+\s*辑\s*[）)]/g,

    // 赠品/附件
    /[（(]\s*赠[^）)]{0,20}[）)]/g,
    /[（(]\s*附[^）)]{0,20}[）)]/g,
    /[（(]\s*含[^）)]{0,20}[）)]/g,
    /[（(]\s*送[^）)]{0,15}[）)]/g,
    /[（(]\s*赠品\s*[）)]/g,

    // 豆瓣/评分
    /[（(]\s*豆瓣[^）)]{0,20}[）)]/g,
    /[（(]\s*评分[^）)]{0,20}[）)]/g,

    // 出版社前缀（如"人民文学出版社·"）——去掉出版社名作为前缀
    // 不处理，出版社名出现在括号外时风险太高

    // 空括号（清完后可能残留）
    /[（(]\s*[）)]/g,
  ]

  for (const re of noisePatterns) {
    s = s.replace(re, '')
  }

  // 2. 去除末尾孤立的版本标记（括号外的，如"（精装版）" 变体）
  s = s
    .replace(/\s+精装$/, '')
    .replace(/\s+平装$/, '')
    .replace(/\s+套装$/, '')

  // 3. 收尾：合并多余空格
  s = s.replace(/\s+/g, ' ').trim()

  return s
}

// ---------------------------------------------------------------------------
// 主逻辑
// ---------------------------------------------------------------------------

if (!fs.existsSync(RAW_PATH)) {
  console.error(`错误：找不到 ${RAW_PATH}`)
  console.error()
  console.error('请先在京东购物车页面（https://cart.jd.com/cart.action）的浏览器控制台运行：')
  console.error()
  console.error("  copy(JSON.stringify([...document.querySelectorAll('.p-name a')].map(a => (a.getAttribute('title') || a.textContent).trim()), null, 2))")
  console.error()
  console.error('然后将结果粘贴保存为 scripts/jd-import/jd-titles-raw.json')
  process.exit(1)
}

const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'))

if (!Array.isArray(raw)) {
  console.error('错误：jd-titles-raw.json 应为字符串数组')
  process.exit(1)
}

console.log(`读取到 ${raw.length} 条原始标题\n`)

const entries = raw.map((title, i) => {
  const clean = cleanTitle(title)
  const changed = clean !== title
  console.log(`${String(i + 1).padStart(3)}. ${changed ? '✂' : ' '} ${title}`)
  if (changed) console.log(`      → ${clean}`)
  return { raw: title, clean }
})

fs.writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2), 'utf8')

console.log(`\n✅ 已写入 ${OUT_PATH}（共 ${entries.length} 条）`)
console.log()
console.log('请检查 jd-cart.json，确认 clean 字段无误后，运行下一步：')
console.log('  node scripts/jd-import/step2-match.mjs')
