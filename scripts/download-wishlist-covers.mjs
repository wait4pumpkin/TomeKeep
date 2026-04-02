/**
 * download-wishlist-covers.mjs
 *
 * Downloads covers for wishlist items whose coverUrl is a remote HTTP(S) URL
 * (i.e. has never been saved to the local covers/ directory).
 *
 * - Reads db.json
 * - For each item with a remote coverUrl and no local <id>.jpg, downloads it
 * - Sends Referer + User-Agent to pass Douban CDN hotlink protection
 * - Follows a single redirect (Douban CDN sometimes redirects)
 * - Rejects GIF placeholder images
 * - Updates coverUrl to app://covers/<id>.jpg in db.json on success
 * - 1 second pause between downloads
 * - Saves incrementally every 10 items
 *
 * Usage:
 *   node scripts/download-wishlist-covers.mjs
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import http from 'http'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DATA_DIR  = path.join(os.homedir(), 'Library', 'Application Support', 'tomekeep')
const DB_PATH   = path.join(DATA_DIR, 'db.json')
const COVERS_DIR = path.join(DATA_DIR, 'covers')
const DELAY_MS  = 1000
const TIMEOUT_MS = 12000

const HEADERS = {
  'Referer': 'https://book.douban.com/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
}

// Known placeholder MD5s (from electron/covers.ts)
const PLACEHOLDER_MD5S = new Set([
  '6516a47fc69b0f3956f12e7efc984eb1',
])

// ---------------------------------------------------------------------------
// Download helper — mirrors electron/covers.ts downloadCover()
// ---------------------------------------------------------------------------
function downloadCoverToFile(id, remoteUrl, destPath, redirectsLeft = 2) {
  return new Promise((resolve) => {
    if (redirectsLeft <= 0) { resolve(false); return }

    const proto = remoteUrl.startsWith('https://') ? https : http
    let settled = false
    const settle = (ok) => { if (!settled) { settled = true; resolve(ok) } }

    let parsed
    try { parsed = new URL(remoteUrl) } catch { settle(false); return }

    const req = proto.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      headers: HEADERS,
    }, (res) => {
      // Follow redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        try { fs.unlinkSync(destPath) } catch { /* ok */ }
        downloadCoverToFile(id, res.headers.location, destPath, redirectsLeft - 1).then(settle)
        settled = true
        return
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume(); settle(false); return
      }

      const file = fs.createWriteStream(destPath)
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        try {
          const buf = fs.readFileSync(destPath)
          // Reject GIF placeholder
          if (buf.slice(0, 3).toString('ascii') === 'GIF') {
            fs.unlink(destPath, () => {})
            settle(false); return
          }
          // Reject known placeholder JPEG by MD5
          const md5 = crypto.createHash('md5').update(buf).digest('hex')
          if (PLACEHOLDER_MD5S.has(md5)) {
            fs.unlink(destPath, () => {})
            settle(false); return
          }
        } catch { /* if unreadable, keep going */ }
        settle(true)
      })
      file.on('error', () => { try { fs.unlinkSync(destPath) } catch {} settle(false) })
    })
    req.on('error', () => settle(false))
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); settle(false) })
  })
}

// ---------------------------------------------------------------------------
// Delay helper
// ---------------------------------------------------------------------------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
fs.mkdirSync(COVERS_DIR, { recursive: true })

const raw = fs.readFileSync(DB_PATH, 'utf8')
const db = JSON.parse(raw)
const wishlist = db.wishlist ?? []

// Backup (only once)
const bakPath = DB_PATH + '.covers-bak'
if (!fs.existsSync(bakPath)) {
  fs.copyFileSync(DB_PATH, bakPath)
  console.log(`Backed up to ${bakPath}`)
}

// Items that need a cover download:
//   - coverUrl is a remote http(s):// URL  (not app://, not empty/default)
//   - no local file at covers/<id>.jpg yet
const toDownload = wishlist.filter(item => {
  const url = item.coverUrl || ''
  if (!url || url.startsWith('app://') || url.includes('book-default')) return false
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false
  const localPath = path.join(COVERS_DIR, `${item.id}.jpg`)
  return !fs.existsSync(localPath)
})

console.log(`Total wishlist: ${wishlist.length}`)
console.log(`Need cover download: ${toDownload.length}`)
console.log()

let ok = 0
let failed = 0

for (let i = 0; i < toDownload.length; i++) {
  const item = toDownload[i]
  const destPath = path.join(COVERS_DIR, `${item.id}.jpg`)
  process.stdout.write(`[${i + 1}/${toDownload.length}] "${item.title}" ... `)

  const success = await downloadCoverToFile(item.id, item.coverUrl, destPath)

  if (success) {
    item.coverUrl = `app://covers/${item.id}.jpg`
    console.log('OK')
    ok++
  } else {
    console.log('FAILED')
    failed++
  }

  // Save incrementally
  if ((i + 1) % 10 === 0) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8')
    console.log(`  [saved at ${i + 1}]`)
  }

  if (i < toDownload.length - 1) await sleep(DELAY_MS)
}

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8')
console.log()
console.log(`Done. Downloaded: ${ok}, Failed: ${failed}`)
