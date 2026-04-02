/**
 * Step 3 — 将豆瓣匹配结果导入 TomeKeep 心愿单
 *
 * 前置：
 *   - 已运行 step2-match.mjs 并确认 jd-douban.json
 *   - TomeKeep 应用已关闭（避免写入冲突）
 *
 * 运行：
 *   node scripts/jd-import/step3-import.mjs
 *
 * 行为：
 *   - 只导入 status === "matched" 的条目
 *   - 跳过 wishlist 中已存在相同 title 的条目（大小写不敏感，忽略空格）
 *   - 写入前备份 db.json → db.json.bak
 *   - 最后打印导入/跳过/unmatched 汇总
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const PROG_PATH   = path.join(__dirname, 'jd-douban.json')
const DB_PATH     = path.join(os.homedir(), 'Library/Application Support/TomeKeep/db.json')
const BACKUP_PATH = DB_PATH + '.bak'

// ---------------------------------------------------------------------------
// 前置检查
// ---------------------------------------------------------------------------

if (!fs.existsSync(PROG_PATH)) {
  console.error(`错误：找不到 ${PROG_PATH}，请先运行 step2-match.mjs`)
  process.exit(1)
}
if (!fs.existsSync(DB_PATH)) {
  console.error(`错误：找不到 ${DB_PATH}`)
  console.error('请确认 TomeKeep 曾经运行过，且数据库路径正确。')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 读取数据
// ---------------------------------------------------------------------------

const progress = JSON.parse(fs.readFileSync(PROG_PATH, 'utf8'))
const dbRaw    = fs.readFileSync(DB_PATH, 'utf8')
const db       = JSON.parse(dbRaw)

if (!Array.isArray(db.wishlist)) db.wishlist = []

// ---------------------------------------------------------------------------
// 汇总输入
// ---------------------------------------------------------------------------

const matched   = progress.filter(e => e.status === 'matched')
const unmatched = progress.filter(e => e.status === 'unmatched')
const errors    = progress.filter(e => e.status === 'error')

console.log(`jd-douban.json 共 ${progress.length} 条：`)
console.log(`  matched   : ${matched.length}`)
console.log(`  unmatched : ${unmatched.length}`)
console.log(`  error     : ${errors.length}`)
console.log()

if (matched.length === 0) {
  console.log('没有 matched 条目可导入。')
  if (unmatched.length > 0 || errors.length > 0) {
    console.log('请先检查 jd-douban.json，重新运行 step2-match.mjs 处理错误条目。')
  }
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 去重：构建现有 wishlist 标题集合
// ---------------------------------------------------------------------------

function normalizeTitle(t) {
  return t.replace(/\s+/g, '').toLowerCase()
}

const existingTitles = new Set(db.wishlist.map(w => normalizeTitle(w.title)))

// ---------------------------------------------------------------------------
// 导入
// ---------------------------------------------------------------------------

let importedCount = 0
let skippedCount  = 0
const skippedTitles = []
const importedItems = []

// 基准时间：按原始顺序给每条加 1ms 偏移，确保 addedAt 严格递增、顺序确定
const baseTime = Date.now()
let timeOffset  = 0

for (const entry of matched) {
  const title = entry.doubanTitle || entry.clean
  if (existingTitles.has(normalizeTitle(title))) {
    skippedCount++
    skippedTitles.push(title)
    continue
  }

  const item = {
    id:        crypto.randomUUID(),
    title,
    author:    entry.author    || '',
    isbn:      entry.isbn      || undefined,
    publisher: entry.publisher || undefined,
    coverUrl:  entry.coverUrl  || undefined,
    detailUrl: entry.subjectId ? `https://book.douban.com/subject/${entry.subjectId}/` : undefined,
    tags:      [],
    priority:  'medium',
    addedAt:   new Date(baseTime + timeOffset++).toISOString(),
  }

  // 清理 undefined 字段（lowdb/JSON.stringify 会保留 undefined 为缺失）
  for (const key of Object.keys(item)) {
    if (item[key] === undefined) delete item[key]
  }

  db.wishlist.push(item)
  existingTitles.add(normalizeTitle(title))
  importedItems.push(item)
  importedCount++
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

if (importedCount === 0) {
  console.log('所有 matched 条目在心愿单中已存在，无需导入。')
  process.exit(0)
}

// 备份
fs.writeFileSync(BACKUP_PATH, dbRaw, 'utf8')
console.log(`备份已写入 ${BACKUP_PATH}`)

// 写入
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8')

// ---------------------------------------------------------------------------
// 汇总报告
// ---------------------------------------------------------------------------

console.log()
console.log('═'.repeat(50))
console.log(`✅ 已导入   : ${importedCount} 条`)
console.log(`⏭  已跳过   : ${skippedCount} 条（心愿单中已存在）`)
console.log(`❌ 未匹配   : ${unmatched.length} 条（需人工处理）`)
console.log('═'.repeat(50))

if (importedCount > 0) {
  console.log('\n新导入的条目：')
  importedItems.forEach((item, i) => {
    console.log(`  ${String(i + 1).padStart(3)}. 《${item.title}》${item.author ? '  ' + item.author : ''}`)
  })
}

if (skippedCount > 0) {
  console.log('\n已跳过（重复）：')
  skippedTitles.forEach((t, i) => {
    console.log(`  ${String(i + 1).padStart(3)}. 《${t}》`)
  })
}

if (unmatched.length > 0) {
  console.log('\n以下条目未能匹配豆瓣，需人工处理：')
  unmatched.forEach((e, i) => {
    console.log(`  ${String(i + 1).padStart(3)}. ${e.raw}`)
  })
  console.log()
  console.log('可在 jd-douban.json 中将这些条目的 status 改为 "matched" 并手动填写字段，')
  console.log('然后重新运行本脚本（已导入的会被跳过，不会重复）。')
}
