import { app, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'

/**
 * Download a remote cover image and save it to userData/covers/<id>.jpg.
 * Returns the app:// URL for the saved file, or the original URL on failure.
 */
function downloadCover(id: string, remoteUrl: string): Promise<string> {
  return new Promise(resolve => {
    const coversDir = path.join(app.getPath('userData'), 'covers')
    try {
      fs.mkdirSync(coversDir, { recursive: true })
    } catch {
      resolve(remoteUrl)
      return
    }

    const destPath = path.join(coversDir, `${id}.jpg`)
    const file = fs.createWriteStream(destPath)

    const protocol = remoteUrl.startsWith('https://') ? https : http

    const request = protocol.get(remoteUrl, response => {
      // Follow a single redirect
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        file.close()
        fs.unlink(destPath, () => undefined)
        downloadCover(id, response.headers.location as string).then(resolve)
        return
      }

      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        file.close()
        fs.unlink(destPath, () => undefined)
        resolve(remoteUrl)
        return
      }

      response.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve(`app://covers/${id}.jpg`)
      })
      file.on('error', () => {
        file.close()
        fs.unlink(destPath, () => undefined)
        resolve(remoteUrl)
      })
    })

    request.on('error', () => {
      file.close()
      fs.unlink(destPath, () => undefined)
      resolve(remoteUrl)
    })

    // 10-second timeout — silently fall back on slow networks
    request.setTimeout(10_000, () => {
      request.destroy()
      file.close()
      fs.unlink(destPath, () => undefined)
      resolve(remoteUrl)
    })
  })
}

export function setupCovers() {
  ipcMain.handle('covers:save-cover', async (_, { id, url }: { id: string; url: string }) => {
    if (!url || url.startsWith('app://')) return url
    return downloadCover(id, url)
  })
}
