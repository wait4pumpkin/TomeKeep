import { app, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'

/**
 * Download a remote cover image and save it to userData/covers/<id>.jpg.
 * Sends Referer: https://book.douban.com/ to pass Douban CDN hotlink protection.
 * Returns the app:// URL for the saved file, or the original URL on failure.
 */
function downloadCover(id: string, remoteUrl: string): Promise<string> {
  return new Promise(resolve => {
    const coversDir = path.join(app.getPath('userData'), 'covers')
    console.log('[covers] coversDir=%s', coversDir)
    try {
      fs.mkdirSync(coversDir, { recursive: true })
    } catch (e) {
      console.error('[covers] mkdirSync failed', e)
      resolve(remoteUrl)
      return
    }

    const destPath = path.join(coversDir, `${id}.jpg`)
    const file = fs.createWriteStream(destPath)

    // Guard: ensure resolve() is called exactly once even if timeout fires
    // after request error or vice-versa.
    let settled = false
    const settle = (result: string) => {
      if (settled) return
      settled = true
      file.close()
      resolve(result)
    }
    const settleError = () => {
      fs.unlink(destPath, () => undefined)
      settle(remoteUrl)
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
          fs.unlink(destPath, () => undefined)
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
          const stat = fs.statSync(destPath)
          console.log('[covers] saved %s (%d bytes) → app://covers/%s.jpg', destPath, stat.size, id)
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
  ipcMain.handle('covers:save-cover', async (_, { id, url }: { id: string; url: string }) => {
    console.log('[covers:save-cover] id=%s url=%s', id, url)
    if (!url || url.startsWith('app://')) {
      console.log('[covers:save-cover] skipped (already app:// or empty)')
      return url
    }
    const result = await downloadCover(id, url)
    console.log('[covers:save-cover] result=%s', result)
    return result
  })
}
