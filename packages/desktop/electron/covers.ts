import { app, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import crypto from 'node:crypto'

/**
 * MD5 hashes of known placeholder images that must be rejected.
 * isbndb CDN returns a "book cover not available" JPEG (200×248, 3736 bytes)
 * with HTTP 200 for any ISBN that has no cover in their database.
 */
const PLACEHOLDER_MD5S = new Set([
  '6516a47fc69b0f3956f12e7efc984eb1', // isbndb "not available" JPEG
])

/**
 * Download a remote cover image and save it to userData/covers/<id>.jpg.
 * Sends Referer: https://book.douban.com/ to pass Douban CDN hotlink protection.
 * Returns the app:// URL for the saved file, or undefined on any failure.
 */
function downloadCover(id: string, remoteUrl: string): Promise<string | undefined> {
  return new Promise(resolve => {
    const coversDir = path.join(app.getPath('userData'), 'covers')
    console.log('[covers] coversDir=%s', coversDir)
    try {
      fs.mkdirSync(coversDir, { recursive: true })
    } catch (e) {
      console.error('[covers] mkdirSync failed', e)
      resolve(undefined)
      return
    }

    const destPath = path.join(coversDir, `${id}.jpg`)
    const file = fs.createWriteStream(destPath)

    // Guard: ensure resolve() is called exactly once even if timeout fires
    // after request error or vice-versa.
    let settled = false
    const settle = (result: string | undefined) => {
      if (settled) return
      settled = true
      file.close()
      resolve(result)
    }
    const settleError = () => {
      fs.unlink(destPath, () => undefined)
      settle(undefined)
    }

    const proto = remoteUrl.startsWith('https://') ? https : http
    console.log('[covers] GET %s → %s', remoteUrl, destPath)

    const parsed = new URL(remoteUrl)
    const request = proto.get(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        headers: {
          // Required to pass Douban CDN hotlink protection
          'Referer': 'https://book.douban.com/',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      },
      response => {
        console.log('[covers] response status=%d', response.statusCode)

        // Follow a single redirect
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          console.log('[covers] redirect → %s', response.headers.location)
          file.close()
          // Use unlinkSync so the empty placeholder file is removed before the
          // recursive downloadCover call creates a new WriteStream to the same
          // path.  If we used the async fs.unlink here, the deferred callback
          // could fire *after* the recursive call has already finished writing
          // the real image, silently deleting the freshly-saved cover.
          try { fs.unlinkSync(destPath) } catch { /* already gone — fine */ }
          settled = true
          downloadCover(id, response.headers.location as string).then(resolve)
          return
        }

        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          console.error('[covers] bad status=%d, falling back', response.statusCode)
          settleError()
          return
        }

        response.pipe(file)
        file.on('finish', () => {
          if (settled) return
          settled = true
          file.close()
          // Reject placeholder images:
          // 1. GIF files — isbndb CDN used to return a GIF placeholder with HTTP 200
          // 2. Known placeholder JPEGs identified by MD5 (isbndb "not available" image)
          let buf: Buffer
          try {
            buf = fs.readFileSync(destPath)
          } catch (e) {
            // File disappeared between finish and read (e.g. deleted by a
            // concurrent updateBook call). Treat as a failed download.
            console.error('[covers] file missing after finish for %s: %s', id, e)
            resolve(undefined)
            return
          }
          if (buf.slice(0, 3).toString('ascii') === 'GIF') {
            console.error('[covers] GIF placeholder detected, rejecting cover for %s', id)
            fs.unlink(destPath, () => undefined)
            resolve(undefined)
            return
          }
          const md5 = crypto.createHash('md5').update(buf).digest('hex')
          if (PLACEHOLDER_MD5S.has(md5)) {
            console.error('[covers] known placeholder image (md5=%s), rejecting cover for %s', md5, id)
            fs.unlink(destPath, () => undefined)
            resolve(undefined)
            return
          }
          console.log('[covers] saved %s (%d bytes) → app://covers/%s.jpg', destPath, buf.byteLength, id)
          resolve(`app://covers/${id}.jpg`)
        })
        file.on('error', (e) => {
          console.error('[covers] write error', e)
          settleError()
        })
      }
    )

    request.on('error', (e) => {
      console.error('[covers] request error', e)
      settleError()
    })

    // 10-second timeout — silently fall back on slow networks
    request.setTimeout(10_000, () => {
      console.error('[covers] timeout for %s', remoteUrl)
      request.destroy()
      settleError()
    })
  })
}

export function setupCovers() {
  /**
   * Check whether the local cover file for a given app:// URL actually exists
   * on disk.  Used at startup to detect covers that are referenced in the DB
   * but whose files were never written (e.g. due to a race in a prior session).
   * Returns true if the file exists, false otherwise.
   * Accepts either an app:// URL or a plain filename stem.
   */
  ipcMain.handle('covers:cover-exists', (_, appUrl: string) => {
    if (!appUrl || !appUrl.startsWith('app://')) return false
    const filename = appUrl.replace('app://covers/', '')
    const filePath = path.join(app.getPath('userData'), 'covers', filename)
    return fs.existsSync(filePath)
  })

  ipcMain.handle('covers:save-cover', async (_, { id, url }: { id: string; url: string }) => {
    console.log('[covers:save-cover] id=%s url=%s', id, url)
    if (!url || url.startsWith('app://')) {
      console.log('[covers:save-cover] skipped (already app:// or empty)')
      return url
    }
    const result = await downloadCover(id, url)
    console.log('[covers:save-cover] result=%s', result)

    // After saving locally, attempt async upload to R2 if logged in
    if (result) {
      void import('./sync.ts').then(async m => {
        const coverKey = await m.uploadCoverToCloud(id)
        if (coverKey) {
          // Update book or wishlist item with the R2 cover key
          const { getDb } = await import('./db.ts')
          const db = getDb()
          const bookIdx = db.data.books.findIndex(b => b.id === id)
          if (bookIdx !== -1) {
            db.data.books[bookIdx]!.coverKey = coverKey
            db.data.books[bookIdx]!.syncStatus = 'pending'
            await db.write()
            await m.pushBook(db.data.books[bookIdx]!)
          } else {
            const wishIdx = db.data.wishlist.findIndex(w => w.id === id)
            if (wishIdx !== -1) {
              db.data.wishlist[wishIdx]!.coverKey = coverKey
              db.data.wishlist[wishIdx]!.syncStatus = 'pending'
              await db.write()
              await m.pushWishlistItem(db.data.wishlist[wishIdx]!)
            }
          }
        }
      }).catch(err => console.error('[covers:save-cover] R2 upload error', err))
    }

    return result ?? undefined
  })

  /**
   * Save a cover from a base64 data URL (e.g. from a local file picker).
   * Accepts data:image/<ext>;base64,<data> and writes to userData/covers/<id>.<ext>.
   * Returns the app:// URL for the saved file.
   */
  ipcMain.handle('covers:save-cover-data', async (_, { id, dataUrl }: { id: string; dataUrl: string }) => {
    console.log('[covers:save-cover-data] id=%s dataUrl length=%d', id, dataUrl.length)
    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
    if (!match) {
      console.error('[covers:save-cover-data] invalid data URL format')
      return null
    }
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
    const base64Data = match[2]
    const coversDir = path.join(app.getPath('userData'), 'covers')
    try {
      fs.mkdirSync(coversDir, { recursive: true })
    } catch (e) {
      console.error('[covers:save-cover-data] mkdirSync failed', e)
      return null
    }
    const destPath = path.join(coversDir, `${id}.${ext}`)
    try {
      fs.writeFileSync(destPath, Buffer.from(base64Data, 'base64'))
      console.log('[covers:save-cover-data] saved %s → app://covers/%s.%s', destPath, id, ext)
    } catch (e) {
      console.error('[covers:save-cover-data] write failed', e)
      return null
    }

    // Attempt async upload to R2 (same as covers:save-cover)
    void import('./sync.ts').then(async m => {
      const coverKey = await m.uploadCoverToCloud(id)
      if (coverKey) {
        const { getDb } = await import('./db.ts')
        const db = getDb()
        const bookIdx = db.data.books.findIndex(b => b.id === id)
        if (bookIdx !== -1) {
          db.data.books[bookIdx]!.coverKey = coverKey
          db.data.books[bookIdx]!.syncStatus = 'pending'
          await db.write()
          await m.pushBook(db.data.books[bookIdx]!)
        } else {
          const wishIdx = db.data.wishlist.findIndex(w => w.id === id)
          if (wishIdx !== -1) {
            db.data.wishlist[wishIdx]!.coverKey = coverKey
            db.data.wishlist[wishIdx]!.syncStatus = 'pending'
            await db.write()
            await m.pushWishlistItem(db.data.wishlist[wishIdx]!)
          }
        }
      }
    }).catch(err => console.error('[covers:save-cover-data] R2 upload error', err))

    return `app://covers/${id}.${ext}`
  })
}
