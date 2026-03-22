/**
 * Pure-Node PNG generator — no external dependencies.
 * Produces a 1024×1024 RGBA PNG of the TomeKeep icon:
 *   • Warm amber/green palette
 *   • Tree whose canopy is formed by open book pages
 *   • Wind-swept branches suggesting motion / life
 */

import zlib from 'zlib'
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'icon.png')

const W = 1024
const H = 1024

// RGBA pixel buffer
const px = new Uint8Array(W * H * 4)

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= W || y < 0 || y >= H) return
  const i = (y * W + x) * 4
  // Alpha-blend over existing
  const sa = a / 255
  const da = px[i + 3] / 255
  const oa = sa + da * (1 - sa)
  if (oa === 0) return
  px[i]     = Math.round((r * sa + px[i]     * da * (1 - sa)) / oa)
  px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / oa)
  px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / oa)
  px[i + 3] = Math.round(oa * 255)
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

function fillRect(x0, y0, x1, y1, r, g, b, a = 255) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      setPixel(x, y, r, g, b, a)
}

function fillCircle(cx, cy, radius, r, g, b, a = 255) {
  const r2 = radius * radius
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2)
        setPixel(cx + dx, cy + dy, r, g, b, a)
    }
  }
}

function drawLine(x0, y0, x1, y1, thick, r, g, b, a = 255) {
  const dx = x1 - x0, dy = y1 - y0
  const len = Math.sqrt(dx * dx + dy * dy)
  const steps = Math.ceil(len * 2)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const cx = Math.round(x0 + dx * t)
    const cy = Math.round(y0 + dy * t)
    fillCircle(cx, cy, thick, r, g, b, a)
  }
}

// Bezier cubic line
function drawCubic(x0, y0, x1, y1, x2, y2, x3, y3, thick, r, g, b, a = 255) {
  const steps = 200
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    const cx = mt*mt*mt*x0 + 3*mt*mt*t*x1 + 3*mt*t*t*x2 + t*t*t*x3
    const cy = mt*mt*mt*y0 + 3*mt*mt*t*y1 + 3*mt*t*t*y2 + t*t*t*y3
    fillCircle(Math.round(cx), Math.round(cy), thick, r, g, b, a)
  }
}

// ---------------------------------------------------------------------------
// Background: warm cream / light tan
// ---------------------------------------------------------------------------
fillRect(0, 0, W - 1, H - 1, 255, 248, 235, 255)

// Subtle radial vignette — slightly darker edges
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2)
    const dy = (y - H / 2) / (H / 2)
    const d = Math.sqrt(dx * dx + dy * dy)
    const alpha = Math.min(1, Math.max(0, (d - 0.55) / 0.6)) * 60
    setPixel(x, y, 180, 140, 90, Math.round(alpha))
  }
}

// ---------------------------------------------------------------------------
// Tree trunk — thick tapered brown column
// ---------------------------------------------------------------------------
const trunkX = W / 2
const trunkBase = H - 80
const trunkTop  = H / 2 + 80

// Trunk: tapered rectangle + bezier sides for organic feel
for (let y = trunkTop; y <= trunkBase; y++) {
  const t = (y - trunkTop) / (trunkBase - trunkTop) // 0 at top, 1 at base
  const hw = 18 + t * 28  // half-width: 18px at top → 46px at base
  for (let x = Math.round(trunkX - hw); x <= Math.round(trunkX + hw); x++) {
    // Bark texture: slightly darker stripe every ~16px
    const shade = (x % 16 < 3) ? 10 : 0
    setPixel(x, y, 120 - shade, 72 - shade, 30 - shade, 255)
  }
}

// Roots at base — three fanning bezier curves
const rootColor = [100, 58, 20]
drawCubic(trunkX, trunkBase, trunkX - 40, trunkBase + 30, trunkX - 100, trunkBase + 50, trunkX - 150, trunkBase + 70, 10, ...rootColor, 220)
drawCubic(trunkX, trunkBase, trunkX + 40, trunkBase + 30, trunkX + 100, trunkBase + 50, trunkX + 150, trunkBase + 70, 10, ...rootColor, 220)
drawCubic(trunkX, trunkBase, trunkX, trunkBase + 20, trunkX - 20, trunkBase + 60, trunkX - 30, trunkBase + 80, 8, ...rootColor, 200)

// ---------------------------------------------------------------------------
// Primary branches — wind-swept (leaning right to suggest motion)
// ---------------------------------------------------------------------------
const bC = [95, 58, 22]  // branch color

// Left branch (wind sweeps it rightward / up)
drawCubic(trunkX, trunkTop + 60, trunkX - 60, trunkTop + 10, trunkX - 80, trunkTop - 60, trunkX - 30, trunkTop - 140, 14, ...bC, 240)
// Right branch
drawCubic(trunkX, trunkTop + 40, trunkX + 70, trunkTop - 10, trunkX + 110, trunkTop - 80, trunkX + 80, trunkTop - 170, 14, ...bC, 240)
// Center branch (goes up with slight lean right)
drawCubic(trunkX, trunkTop, trunkX + 10, trunkTop - 60, trunkX + 30, trunkTop - 120, trunkX + 20, trunkTop - 200, 16, ...bC, 240)

// Smaller secondary branches
drawCubic(trunkX - 55, trunkTop - 60, trunkX - 100, trunkTop - 100, trunkX - 140, trunkTop - 120, trunkX - 170, trunkTop - 110, 8, ...bC, 200)
drawCubic(trunkX + 70, trunkTop - 40, trunkX + 120, trunkTop - 80, trunkX + 160, trunkTop - 90, trunkX + 190, trunkTop - 80, 8, ...bC, 200)
drawCubic(trunkX + 15, trunkTop - 120, trunkX + 50, trunkTop - 160, trunkX + 80, trunkTop - 180, trunkX + 100, trunkTop - 170, 7, ...bC, 190)

// ---------------------------------------------------------------------------
// Book-page canopy: open book pages as leaf clusters
// ---------------------------------------------------------------------------
// Each "book" = two fan-shaped page arcs meeting at a spine
// We'll draw 5 clusters at different branch tips

function drawBookCluster(cx, cy, angle, scale = 1.0) {
  // angle: tilt of the book spine in degrees
  const rad = angle * Math.PI / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)

  // Page color — warm parchment / light ochre
  const pR = 245, pG = 220, pB = 150

  // Left page arc: fan of lines from spine toward left
  const pageCount = 12
  for (let i = 0; i < pageCount; i++) {
    const t = i / (pageCount - 1)
    // Page sweep: 10° to 80° to the left of spine
    const pageAngle = rad + (0.17 + t * 1.22)
    const px1 = cx
    const py1 = cy
    const len = (80 + t * 30) * scale
    const px2 = Math.round(cx + Math.cos(pageAngle) * len)
    const py2 = Math.round(cy + Math.sin(pageAngle) * len)
    const thick = Math.round((2.5 - t * 0.8) * scale)
    const alpha = Math.round(200 + t * 40)
    drawLine(px1, py1, px2, py2, thick, pR, pG, pB, alpha)
  }

  // Right page arc
  for (let i = 0; i < pageCount; i++) {
    const t = i / (pageCount - 1)
    const pageAngle = rad - (0.17 + t * 1.22)
    const px1 = cx, py1 = cy
    const len = (80 + t * 30) * scale
    const px2 = Math.round(cx + Math.cos(pageAngle) * len)
    const py2 = Math.round(cy + Math.sin(pageAngle) * len)
    const thick = Math.round((2.5 - t * 0.8) * scale)
    const alpha = Math.round(200 + t * 40)
    drawLine(px1, py1, px2, py2, thick, pR, pG, pB, alpha)
  }

  // Spine (dark line down the middle of the book)
  const spineLen = 90 * scale
  drawLine(
    Math.round(cx - cos * spineLen * 0.1), Math.round(cy - sin * spineLen * 0.1),
    Math.round(cx + cos * spineLen * 0.9), Math.round(cy + sin * spineLen * 0.9),
    Math.round(3 * scale), 80, 50, 20, 220
  )

  // Green leaf accents on page tips
  const gR = 100, gG = 160, gB = 60
  for (let i = 0; i < pageCount; i += 3) {
    const t = i / (pageCount - 1)
    for (const side of [1, -1]) {
      const pageAngle = rad + side * (0.17 + t * 1.22)
      const len = (80 + t * 30) * scale
      const lx = Math.round(cx + Math.cos(pageAngle) * len)
      const ly = Math.round(cy + Math.sin(pageAngle) * len)
      fillCircle(lx, ly, Math.round((4 + t * 5) * scale), gR, gG, gB, 180)
    }
  }
}

// Cluster positions — branch tips
// Angles: -90 = pointing up; adjust for wind-swept lean
drawBookCluster(trunkX + 20,  trunkTop - 200, -85, 1.3)   // top center
drawBookCluster(trunkX - 30,  trunkTop - 140, -100, 1.1)  // upper left
drawBookCluster(trunkX + 80,  trunkTop - 170, -70, 1.05)  // upper right
drawBookCluster(trunkX - 170, trunkTop - 110, -115, 0.85) // far left
drawBookCluster(trunkX + 190, trunkTop - 80,  -60, 0.85)  // far right

// ---------------------------------------------------------------------------
// Small amber berries / dots for life / dynamism
// ---------------------------------------------------------------------------
const berries = [
  [trunkX - 90, trunkTop - 180],
  [trunkX + 130, trunkTop - 200],
  [trunkX + 50,  trunkTop - 260],
  [trunkX - 140, trunkTop - 140],
  [trunkX + 160, trunkTop - 130],
]
for (const [bx, by] of berries) {
  fillCircle(bx, by, 10, 220, 100, 30, 230)
  fillCircle(bx - 2, by - 2, 3, 255, 200, 120, 180) // highlight
}

// ---------------------------------------------------------------------------
// Encode as PNG
// ---------------------------------------------------------------------------

function crc32(buf) {
  let crc = 0xFFFFFFFF
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      t[i] = c
    }
    return t
  })())
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf  = Buffer.allocUnsafe(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcInput = Buffer.concat([typeBuf, data])
  const crcBuf = Buffer.allocUnsafe(4)
  crcBuf.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

// IHDR
const ihdr = Buffer.allocUnsafe(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8]  = 8  // bit depth
ihdr[9]  = 2  // color type: RGB (no alpha for simplicity — premultiply)
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

// Build raw scanlines (RGB, filter byte 0 prepended)
const raw = Buffer.allocUnsafe(H * (1 + W * 3))
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0  // filter type None
  for (let x = 0; x < W; x++) {
    const si = (y * W + x) * 4
    const di = y * (1 + W * 3) + 1 + x * 3
    // Composite RGBA over cream background (already done in px buffer)
    raw[di]     = px[si]
    raw[di + 1] = px[si + 1]
    raw[di + 2] = px[si + 2]
  }
}

const compressed = zlib.deflateSync(raw, { level: 6 })

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
  chunk('IHDR', ihdr),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0)),
])

fs.writeFileSync(OUT, png)
console.log(`Written: ${OUT} (${(png.length / 1024).toFixed(1)} KB)`)
