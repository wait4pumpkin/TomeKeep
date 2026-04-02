/**
 * companion-server.ts
 *
 * Starts a local HTTPS server that allows a mobile browser on the same LAN
 * to scan book barcodes and stream ISBN values back to the desktop app.
 *
 * Architecture:
 *   GET  /                     → serves public/mobile-scan.html
 *   GET  /events?token=T       → SSE stream; sends { type:'ack', isbn, hasMetadata } per scan
 *   POST /scan?token=T         → receives { isbn: string }; fires companion:isbn-received via IPC
 *   POST /delete-entry?token=T → receives { isbn: string }; fires companion:delete-entry via IPC; SSE delete-ack
 *   GET  /ping                 → { alive: true } health check
 *
 * Security:
 *   - A 16-byte random hex token is generated on each start(); all /scan and /events
 *     requests must carry it as a query param.
 *   - Self-signed TLS certificate is generated on first launch and persisted to
 *     userData so the user only needs to trust it once on their phone.
 *   - Server binds to 0.0.0.0 but the URL shared with the phone uses the local LAN IP.
 */

import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { app, ipcMain, BrowserWindow } from 'electron'
import selfsigned from 'selfsigned'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompanionStartResult =
  | { ok: true; url: string; token: string }
  | { ok: false; error: string }

export type CompanionStatusResult =
  | { running: true; url: string }
  | { running: false }

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const PREFERRED_PORT = 47213

let server: https.Server | null = null
let activeToken: string | null = null
let activeUrl: string | null = null

/** SSE response objects currently connected (one per phone tab). */
const sseClients = new Set<http.ServerResponse>()

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Get the first non-loopback IPv4 address on the machine. */
function getLanIp(): string | null {
  const ifaces = os.networkInterfaces()
  for (const iface of Object.values(ifaces)) {
    if (!iface) continue
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return null
}

/** Find a free port, starting from `preferred`. */
function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = http.createServer()
    probe.listen(preferred, '0.0.0.0', () => {
      const addr = probe.address()
      probe.close(() => {
        if (addr && typeof addr === 'object') resolve(addr.port)
        else reject(new Error('Could not determine port'))
      })
    })
    probe.on('error', () => {
      // preferred port taken — let OS pick
      const fallback = http.createServer()
      fallback.listen(0, '0.0.0.0', () => {
        const addr2 = fallback.address()
        fallback.close(() => {
          if (addr2 && typeof addr2 === 'object') resolve(addr2.port)
          else reject(new Error('Could not determine fallback port'))
        })
      })
      fallback.on('error', reject)
    })
  })
}

/** Load or generate a self-signed certificate, cached in userData. */
async function getOrCreateCert(): Promise<{ cert: string; key: string }> {
  const userData = app.getPath('userData')
  const certPath = path.join(userData, 'companion-cert.pem')
  const keyPath = path.join(userData, 'companion-key.pem')

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return {
      cert: fs.readFileSync(certPath, 'utf8'),
      key: fs.readFileSync(keyPath, 'utf8'),
    }
  }

  // Generate new self-signed cert valid for 3 years
  const attrs = [{ name: 'commonName', value: 'TomeKeep Companion' }]
  const notAfterDate = new Date()
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 3)
  const pems = await selfsigned.generate(attrs, {
    notAfterDate,
    algorithm: 'sha256',
    keySize: 2048,
  })

  fs.writeFileSync(certPath, pems.cert, 'utf8')
  fs.writeFileSync(keyPath, pems.private, 'utf8')

  return { cert: pems.cert, key: pems.private }
}

/** Serve a bundled HTML file from the public/ directory. */
function servePublicHtml(filename: string, res: http.ServerResponse) {
  const htmlPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'public', filename)
    : path.join(app.getAppPath(), 'public', filename)

  if (!fs.existsSync(htmlPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end(`${filename} not found`)
    return
  }

  const html = fs.readFileSync(htmlPath, 'utf8')
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

/** Serve static vendor assets from public/vendor/. */
function serveVendor(pathname: string, res: http.ServerResponse) {
  // Strip leading /vendor/ and resolve against public/vendor/
  const filename = path.basename(pathname) // prevent directory traversal
  const vendorDir = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'public', 'vendor')
    : path.join(app.getAppPath(), 'public', 'vendor')
  const filePath = path.join(vendorDir, filename)

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
    return
  }

  const ext = path.extname(filename)
  const mime = ext === '.js' ? 'application/javascript; charset=utf-8' : 'application/octet-stream'
  const content = fs.readFileSync(filePath)
  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': 'public, max-age=86400',
  })
  res.end(content)
}

/** Validate token from query string; return 401 and false if invalid. */
function requireToken(url: URL, res: http.ServerResponse): boolean {
  if (!activeToken || url.searchParams.get('token') !== activeToken) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid_token' }))
    return false
  }
  return true
}

/** Push an SSE event to all connected phone clients. */
function broadcastSse(data: object) {
  const payload = `data: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    try {
      client.write(payload)
    } catch {
      sseClients.delete(client)
    }
  }
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  // CORS headers — allow the phone's browser to make fetch() calls
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const urlObj = new URL(req.url ?? '/', `https://localhost`)
  const pathname = urlObj.pathname

  // --- GET / → serve the mobile scan page ---
  if (req.method === 'GET' && pathname === '/') {
    servePublicHtml('mobile-scan.html', res)
    return
  }

  // --- GET /vendor/* → serve bundled static assets (e.g. zxing-library.min.js) ---
  if (req.method === 'GET' && pathname.startsWith('/vendor/')) {
    serveVendor(pathname, res)
    return
  }

  // --- GET /ping ---
  if (req.method === 'GET' && pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ alive: true }))
    return
  }

  // --- GET /cover → serve the mobile cover-capture page ---
  if (req.method === 'GET' && pathname === '/cover') {
    if (!requireToken(urlObj, res)) return
    servePublicHtml('mobile-cover.html', res)
    return
  }

  // --- POST /upload-cover → receive a JPEG data URL from the phone ---
  if (req.method === 'POST' && pathname === '/upload-cover') {
    if (!requireToken(urlObj, res)) return

    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { dataUrl, session } = JSON.parse(body) as { dataUrl?: unknown; session?: unknown }
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'missing_or_invalid_dataUrl' }))
          return
        }

        const wins = BrowserWindow.getAllWindows()
        if (wins[0]) {
          wins[0].webContents.send('companion:cover-received', {
            dataUrl,
            session: typeof session === 'string' ? session : '',
          })
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_json' }))
      }
    })
    return
  }

  // --- GET /events → SSE stream ---
  if (req.method === 'GET' && pathname === '/events') {
    if (!requireToken(urlObj, res)) return

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    // Send a heartbeat comment so the connection doesn't time out
    res.write(': connected\n\n')

    sseClients.add(res)
    req.on('close', () => { sseClients.delete(res) })
    return
  }

  // --- POST /scan → receive ISBN from phone ---
  if (req.method === 'POST' && pathname === '/scan') {
    if (!requireToken(urlObj, res)) return

    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { isbn } = JSON.parse(body) as { isbn?: unknown }
        if (typeof isbn !== 'string' || !isbn) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'missing_isbn' }))
          return
        }

        // Forward to renderer via IPC
        const wins = BrowserWindow.getAllWindows()
        if (wins[0]) {
          wins[0].webContents.send('companion:isbn-received', isbn)
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_json' }))
      }
    })
    return
  }

  // --- POST /delete-entry → phone requests deletion of a failed scan entry ---
  if (req.method === 'POST' && pathname === '/delete-entry') {
    if (!requireToken(urlObj, res)) return

    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const { isbn } = JSON.parse(body) as { isbn?: unknown }
        if (typeof isbn !== 'string' || !isbn) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'missing_isbn' }))
          return
        }

        // Forward to renderer via IPC so the desktop library removes the entry
        const wins = BrowserWindow.getAllWindows()
        if (wins[0]) {
          wins[0].webContents.send('companion:delete-entry', isbn)
        }

        // Acknowledge back to the phone immediately so it can remove the item from its list
        broadcastSse({ type: 'delete-ack', isbn })

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_json' }))
      }
    })
    return
  }

  // --- POST /scan-ack → renderer notifies phone of result ---
  if (req.method === 'POST' && pathname === '/scan-ack') {
    if (!requireToken(urlObj, res)) return

    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const payload = JSON.parse(body) as object
        broadcastSse(payload)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_json' }))
      }
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not found')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Start the companion HTTPS server. Returns the LAN URL and session token. */
export async function startCompanionServer(): Promise<CompanionStartResult> {
  if (server) {
    // Already running — return current info
    return { ok: true, url: activeUrl!, token: activeToken! }
  }

  try {
    const { cert, key } = await getOrCreateCert()
    const port = await findFreePort(PREFERRED_PORT)
    const ip = getLanIp()
    if (!ip) return { ok: false, error: 'no_lan_ip' }

    activeToken = crypto.randomBytes(16).toString('hex')
    activeUrl = `https://${ip}:${port}?token=${activeToken}`

    server = https.createServer({ cert, key }, handleRequest)

    await new Promise<void>((resolve, reject) => {
      server!.listen(port, '0.0.0.0', () => resolve())
      server!.on('error', reject)
    })

    return { ok: true, url: activeUrl, token: activeToken }
  } catch (e) {
    server = null
    activeToken = null
    activeUrl = null
    const msg = e instanceof Error ? e.message : 'unknown error'
    return { ok: false, error: msg }
  }
}

/** Stop the companion HTTPS server and invalidate the token. */
export function stopCompanionServer(): Promise<void> {
  return new Promise(resolve => {
    // Close all SSE connections
    for (const client of sseClients) {
      try { client.end() } catch { /* ignore */ }
    }
    sseClients.clear()

    activeToken = null
    activeUrl = null

    if (!server) {
      resolve()
      return
    }
    server.close(() => {
      server = null
      resolve()
    })
  })
}

/** Return current server status. */
export function getCompanionStatus(): CompanionStatusResult {
  if (server && activeUrl) return { running: true, url: activeUrl }
  return { running: false }
}

// ---------------------------------------------------------------------------
// IPC handlers (called from main.ts via setupCompanion())
// ---------------------------------------------------------------------------

export function setupCompanion() {
  ipcMain.handle('companion:start', async () => {
    return await startCompanionServer()
  })

  ipcMain.handle('companion:stop', async () => {
    await stopCompanionServer()
  })

  ipcMain.handle('companion:status', () => {
    return getCompanionStatus()
  })

  // When the renderer finishes processing an ISBN (success/fail), send ack back
  // to the phone via SSE so the phone UI can update its scan list.
  ipcMain.on('companion:scan-ack', (_event, payload: { isbn: string; hasMetadata: boolean; title?: string }) => {
    broadcastSse({ type: 'ack', isbn: payload.isbn, hasMetadata: payload.hasMetadata, title: payload.title })
  })

  // Shut down cleanly when the app quits
  app.on('before-quit', () => {
    void stopCompanionServer()
  })
}
