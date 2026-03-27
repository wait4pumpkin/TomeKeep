import { useEffect, useRef, useState, useCallback } from 'react'
import QRCode from 'qrcode'
import { extractCoverText } from '../lib/coverOcr'
import type { OcrResult } from '../lib/coverOcr'

// ---------------------------------------------------------------------------
// CoverCropModal
//
// Two modes:
//   'file'   — caller passes a File; we decode it, auto-detect cover corners,
//              show a 4-point drag adjuster, then perspective-correct + compress.
//   'camera' — we open getUserMedia, run continuous Sobel rect detection every
//              5 frames, auto-freeze when confident for 3 consecutive checks;
//              manual "拍摄" button always available as fallback.
//
// Output: onConfirm receives a JPEG data URL (max 600×800, quality 0.85).
// ---------------------------------------------------------------------------

export type CoverCropModalProps = {
  isOpen: boolean
  onClose: () => void
  onConfirm: (dataUrl: string, ocr?: OcrResult) => void
  mode: 'file' | 'camera'
  initialFile?: File
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

type Point = { x: number; y: number }

// ---------------------------------------------------------------------------
// Canny edge detection helpers
// ---------------------------------------------------------------------------

/** 1-D separable Gaussian blur (kernel radius 2, σ≈1.0) applied in-place */
function gaussianBlur(gray: Float32Array, w: number, h: number): Float32Array {
  // kernel: [0.0625, 0.25, 0.375, 0.25, 0.0625]
  const k = [0.0625, 0.25, 0.375, 0.25, 0.0625]
  const tmp = new Float32Array(w * h)
  // horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let d = -2; d <= 2; d++) {
        const xi = Math.max(0, Math.min(w - 1, x + d))
        v += gray[y * w + xi] * k[d + 2]
      }
      tmp[y * w + x] = v
    }
  }
  const out = new Float32Array(w * h)
  // vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let d = -2; d <= 2; d++) {
        const yi = Math.max(0, Math.min(h - 1, y + d))
        v += tmp[yi * w + x] * k[d + 2]
      }
      out[y * w + x] = v
    }
  }
  return out
}

/**
 * Canny edge detection.
 * Returns a Uint8Array (1 = edge pixel, 0 = non-edge) of size w×h.
 * Thresholds are relative to the maximum gradient magnitude in the image.
 */
function cannyEdges(imgData: ImageData): Uint8Array {
  const { data, width: w, height: h } = imgData

  // Build grayscale float image
  const gray = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }

  const blurred = gaussianBlur(gray, w, h)

  // Sobel gradients
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  let maxMag = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x
      const gxv =
        -blurred[(y-1)*w+(x-1)] - 2*blurred[y*w+(x-1)] - blurred[(y+1)*w+(x-1)]
        +blurred[(y-1)*w+(x+1)] + 2*blurred[y*w+(x+1)] + blurred[(y+1)*w+(x+1)]
      const gyv =
        -blurred[(y-1)*w+(x-1)] - 2*blurred[(y-1)*w+x] - blurred[(y-1)*w+(x+1)]
        +blurred[(y+1)*w+(x-1)] + 2*blurred[(y+1)*w+x] + blurred[(y+1)*w+(x+1)]
      gx[idx] = gxv
      gy[idx] = gyv
      const mag = Math.sqrt(gxv*gxv + gyv*gyv)
      if (mag > maxMag) maxMag = mag
    }
  }

  if (maxMag === 0) return new Uint8Array(w * h)

  // Normalise magnitudes
  const mag = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) mag[i] = Math.sqrt(gx[i]*gx[i] + gy[i]*gy[i]) / maxMag

  // Non-maximum suppression
  const nms = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x
      const angle = Math.atan2(gy[idx], gx[idx]) * 180 / Math.PI
      const a = ((angle % 180) + 180) % 180
      let n1: number, n2: number
      if (a < 22.5 || a >= 157.5) {
        n1 = mag[y*w+(x-1)]; n2 = mag[y*w+(x+1)]
      } else if (a < 67.5) {
        n1 = mag[(y-1)*w+(x+1)]; n2 = mag[(y+1)*w+(x-1)]
      } else if (a < 112.5) {
        n1 = mag[(y-1)*w+x]; n2 = mag[(y+1)*w+x]
      } else {
        n1 = mag[(y-1)*w+(x-1)]; n2 = mag[(y+1)*w+(x+1)]
      }
      nms[idx] = (mag[idx] >= n1 && mag[idx] >= n2) ? mag[idx] : 0
    }
  }

  // Double threshold hysteresis
  const HIGH = 0.20, LOW = 0.08
  const edges = new Uint8Array(w * h) // 0=none, 1=weak, 2=strong
  for (let i = 0; i < w * h; i++) {
    if (nms[i] >= HIGH) edges[i] = 2
    else if (nms[i] >= LOW) edges[i] = 1
  }
  // Promote weak edges connected to strong
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (edges[y*w+x] !== 1) continue
      let hasStrong = false
      for (let dy = -1; dy <= 1 && !hasStrong; dy++)
        for (let dx = -1; dx <= 1 && !hasStrong; dx++)
          if (edges[(y+dy)*w+(x+dx)] === 2) hasStrong = true
      edges[y*w+x] = hasStrong ? 2 : 0
    }
  }
  // Final: strong edges only
  const result = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) result[i] = edges[i] === 2 ? 1 : 0
  return result
}

// ---------------------------------------------------------------------------
// Contour extraction via BFS connected components on edge map
// ---------------------------------------------------------------------------

function extractContours(edgeMap: Uint8Array, w: number, h: number): Point[][] {
  const visited = new Uint8Array(w * h)
  const contours: Point[][] = []
  const minLen = Math.min(w, h) / 4

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (!edgeMap[idx] || visited[idx]) continue
      // BFS
      const contour: Point[] = []
      const queue: number[] = [idx]
      visited[idx] = 1
      while (queue.length) {
        const cur = queue.pop()!
        const cx = cur % w, cy = (cur - cx) / w
        contour.push({ x: cx, y: cy })
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = cx + dx, ny = cy + dy
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
            const ni = ny * w + nx
            if (edgeMap[ni] && !visited[ni]) { visited[ni] = 1; queue.push(ni) }
          }
        }
      }
      if (contour.length >= minLen) contours.push(contour)
    }
  }
  return contours
}

// ---------------------------------------------------------------------------
// Douglas-Peucker polyline simplification → quadrilateral fitting
// ---------------------------------------------------------------------------

function ptLineDistSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  if (dx === 0 && dy === 0) return (p.x-a.x)**2 + (p.y-a.y)**2
  const t = ((p.x-a.x)*dx + (p.y-a.y)*dy) / (dx*dx + dy*dy)
  const tc = Math.max(0, Math.min(1, t))
  return (p.x - a.x - tc*dx)**2 + (p.y - a.y - tc*dy)**2
}

function douglasPeucker(pts: Point[], eps: number): Point[] {
  if (pts.length <= 2) return pts
  let maxD = 0, idx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.sqrt(ptLineDistSq(pts[i], pts[0], pts[pts.length-1]))
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD > eps) {
    const l = douglasPeucker(pts.slice(0, idx+1), eps)
    const r = douglasPeucker(pts.slice(idx), eps)
    return [...l.slice(0, -1), ...r]
  }
  return [pts[0], pts[pts.length-1]]
}

/** Convex hull of a point set (Graham scan) */
function convexHull(pts: Point[]): Point[] {
  if (pts.length < 3) return pts
  const sorted = [...pts].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y)
  function cross(o: Point, a: Point, b: Point) {
    return (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x)
  }
  const lower: Point[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = sorted.length-1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  upper.pop(); lower.pop()
  return [...lower, ...upper]
}

function polygonArea(pts: Point[]): number {
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(area) / 2
}

/**
 * Attempt to fit a quadrilateral to a contour.
 * Returns null if no valid quad is found.
 */
function fitQuad(contour: Point[], w: number, h: number): [Point, Point, Point, Point] | null {
  const hull = convexHull(contour)
  if (hull.length < 4) return null

  // Adaptive epsilon: fraction of perimeter
  let perim = 0
  for (let i = 0; i < hull.length; i++) {
    const j = (i+1) % hull.length
    perim += Math.hypot(hull[j].x-hull[i].x, hull[j].y-hull[i].y)
  }

  // Try increasingly aggressive simplification until we get 4 points
  let simplified: Point[] = hull
  for (const frac of [0.02, 0.04, 0.06, 0.08, 0.12]) {
    simplified = douglasPeucker(hull, perim * frac)
    if (simplified.length === 4) break
    if (simplified.length < 4) break
  }

  if (simplified.length !== 4) {
    // Fall back to AABB of hull
    const xs = hull.map(p => p.x), ys = hull.map(p => p.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    simplified = [
      { x: minX, y: minY }, { x: maxX, y: minY },
      { x: maxX, y: maxY }, { x: minX, y: maxY },
    ]
  }

  // Reorder as [tl, tr, br, bl]
  const cx = simplified.reduce((s,p) => s+p.x, 0) / 4
  const cy = simplified.reduce((s,p) => s+p.y, 0) / 4
  const ordered = simplified.slice().sort((a, b) => {
    const qa = (a.x < cx ? 0 : 1) + (a.y < cy ? 0 : 2)
    const qb = (b.x < cx ? 0 : 1) + (b.y < cy ? 0 : 2)
    return qa - qb
  }) as [Point, Point, Point, Point]
  // quadrant sort: 0=TL,1=TR,2=BL,3=BR → reorder to TL,TR,BR,BL
  const [tl, tr, bl, br] = ordered
  const quad: [Point, Point, Point, Point] = [tl, tr, br, bl]

  // Validate: coverage ≥ 30% and aspect ratio in [0.3, 1.2]
  const area = polygonArea(quad)
  const coverage = area / (w * h)
  const bboxW = Math.max(quad[0].x, quad[1].x, quad[2].x, quad[3].x) - Math.min(quad[0].x, quad[1].x, quad[2].x, quad[3].x)
  const bboxH = Math.max(quad[0].y, quad[1].y, quad[2].y, quad[3].y) - Math.min(quad[0].y, quad[1].y, quad[2].y, quad[3].y)
  const aspect = bboxH > 0 ? bboxW / bboxH : 0

  if (coverage < 0.30 || aspect < 0.3 || aspect > 1.2) return null
  return quad
}

/**
 * Detect the book cover quadrilateral in an image using Canny edge detection,
 * contour extraction, and quadrilateral fitting.
 *
 * Returns corners [tl, tr, br, bl] in image-pixel coordinates plus a
 * confidence score in [0, 1].  Falls back to insetCorners on failure.
 */
function detectRect(imgData: ImageData): { corners: [Point, Point, Point, Point]; confidence: number } {
  const { width: w, height: h } = imgData
  const edgeMap = cannyEdges(imgData)
  const contours = extractContours(edgeMap, w, h)

  // Pick the contour whose fitted quad has the largest area
  let bestQuad: [Point, Point, Point, Point] | null = null
  let bestArea = 0
  for (const contour of contours) {
    const quad = fitQuad(contour, w, h)
    if (!quad) continue
    const area = polygonArea(quad)
    if (area > bestArea) { bestArea = area; bestQuad = quad }
  }

  if (bestQuad) {
    const coverage = bestArea / (w * h)
    return { corners: bestQuad, confidence: Math.min(1, coverage * 2) }
  }

  // Fallback: inset corners, zero confidence → caller will use insetCorners
  return { corners: insetCorners(w, h), confidence: 0 }
}

/** Inset corners as a fraction of image dimensions — safe fallback */
function insetCorners(w: number, h: number, f = 0.08): [Point, Point, Point, Point] {
  const mx = Math.round(w * f), my = Math.round(h * f)
  return [
    { x: mx,     y: my },
    { x: w - mx, y: my },
    { x: w - mx, y: h - my },
    { x: mx,     y: h - my },
  ]
}

// ---------------------------------------------------------------------------
// Perspective transform (homography) — pure Canvas 2D backward mapping
// ---------------------------------------------------------------------------

type Mat3 = [number, number, number, number, number, number, number, number, number]

/**
 * Solve the 8-DOF homography H such that H * srcPts[i] ≈ dstPts[i]
 * using the standard DLT (Direct Linear Transform) with Gaussian elimination.
 *
 * H is stored row-major: [h0 h1 h2 / h3 h4 h5 / h6 h7 1]
 * so that:  w*u = h0*x + h1*y + h2
 *           w*v = h3*x + h4*y + h5
 *           w   = h6*x + h7*y + 1
 */
function solveHomography(
  srcPts: [Point, Point, Point, Point],
  dstPts: [Point, Point, Point, Point],
): Mat3 {
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = srcPts[i]
    const { x: u, y: v } = dstPts[i]
    A.push([ x,  y,  1,  0,  0,  0, -u*x, -u*y, u])
    A.push([ 0,  0,  0,  x,  y,  1, -v*x, -v*y, v])
  }
  // Gaussian elimination with partial pivoting (8×9 augmented matrix)
  const n = 8
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row
    }
    ;[A[col], A[maxRow]] = [A[maxRow], A[col]]
    const pivot = A[col][col]
    if (Math.abs(pivot) < 1e-10) continue
    for (let j = col; j <= n; j++) A[col][j] /= pivot
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const f = A[row][col]
      for (let j = col; j <= n; j++) A[row][j] -= f * A[col][j]
    }
  }
  const h = A.map(r => r[n])
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] as Mat3
}

/**
 * Perspective-warp srcCanvas using backward mapping:
 * for each output pixel (dx,dy) we compute the source coordinate via the
 * homography that maps output-rectangle corners → source quad corners,
 * then bilinearly sample the source.
 *
 * corners order: [tl, tr, br, bl] in source-image pixel space.
 */
function perspectiveWarp(
  srcCanvas: HTMLCanvasElement,
  corners: [Point, Point, Point, Point],
  outW: number,
  outH: number,
): HTMLCanvasElement {
  // dst (output rectangle) → src (the quad the user drew)
  const dstPts: [Point, Point, Point, Point] = [
    { x: 0,    y: 0    },  // tl
    { x: outW, y: 0    },  // tr
    { x: outW, y: outH },  // br
    { x: 0,    y: outH },  // bl
  ]
  // H maps output coords → source coords
  const H = solveHomography(dstPts, corners)

  const srcCtx = srcCanvas.getContext('2d')!
  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height)
  const sw = srcCanvas.width, sh = srcCanvas.height

  const out = document.createElement('canvas')
  out.width = outW; out.height = outH
  const outCtx = out.getContext('2d')!
  const outData = outCtx.createImageData(outW, outH)

  const [h0,h1,h2,h3,h4,h5,h6,h7] = H

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      const ww = h6*dx + h7*dy + 1
      const sx = (h0*dx + h1*dy + h2) / ww
      const sy = (h3*dx + h4*dy + h5) / ww

      // Bilinear interpolation
      const x0 = Math.floor(sx), y0 = Math.floor(sy)
      const x1 = x0 + 1,        y1 = y0 + 1
      const fx = sx - x0,        fy = sy - y0
      const cx0 = Math.max(0, Math.min(sw - 1, x0))
      const cy0 = Math.max(0, Math.min(sh - 1, y0))
      const cx1 = Math.max(0, Math.min(sw - 1, x1))
      const cy1 = Math.max(0, Math.min(sh - 1, y1))
      const i00 = (cy0 * sw + cx0) * 4
      const i10 = (cy0 * sw + cx1) * 4
      const i01 = (cy1 * sw + cx0) * 4
      const i11 = (cy1 * sw + cx1) * 4
      const oi  = (dy  * outW + dx) * 4
      for (let c = 0; c < 3; c++) {
        outData.data[oi+c] = Math.round(
          srcData.data[i00+c] * (1-fx) * (1-fy) +
          srcData.data[i10+c] *    fx  * (1-fy) +
          srcData.data[i01+c] * (1-fx) *    fy  +
          srcData.data[i11+c] *    fx  *    fy
        )
      }
      outData.data[oi+3] = 255
    }
  }
  outCtx.putImageData(outData, 0, 0)
  return out
}



function compressCanvas(src: HTMLCanvasElement, maxW = 600, maxH = 800, quality = 0.85): string {
  const scale = Math.min(1, maxW / src.width, maxH / src.height)
  const w = Math.round(src.width * scale)
  const h = Math.round(src.height * scale)
  const out = document.createElement('canvas')
  out.width = w; out.height = h
  out.getContext('2d')!.drawImage(src, 0, 0, w, h)
  return out.toDataURL('image/jpeg', quality)
}

// ---------------------------------------------------------------------------
// CropAdjuster — interactive 4-point corner drag on a displayed image
// ---------------------------------------------------------------------------

type CropAdjusterProps = {
  /** The source image as a data URL (shown as background) */
  imageUrl: string
  /** Initial corners in image-pixel space */
  initCorners: [Point, Point, Point, Point]
  onChange: (corners: [Point, Point, Point, Point]) => void
}

function CropAdjuster({ imageUrl, initCorners, onChange }: CropAdjusterProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [corners, setCorners] = useState<[Point, Point, Point, Point]>(initCorners)
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null)
  const dragging = useRef<number | null>(null)

  // Reset corners when initCorners change (new image loaded)
  useEffect(() => { setCorners(initCorners) }, [initCorners])

  // Map corner in image-pixel space → display percentage
  const toDisplay = useCallback((p: Point) => {
    if (!imgNatural) return { left: '50%', top: '50%' }
    return {
      left: `${(p.x / imgNatural.w) * 100}%`,
      top:  `${(p.y / imgNatural.h) * 100}%`,
    }
  }, [imgNatural])

  const onPointerDown = (idx: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    dragging.current = idx
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current === null || !containerRef.current || !imgNatural) return
    const rect = containerRef.current.getBoundingClientRect()
    const px = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))  * imgNatural.w
    const py = Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height)) * imgNatural.h
    const next = [...corners] as [Point, Point, Point, Point]
    next[dragging.current] = { x: px, y: py }
    setCorners(next)
    onChange(next)
  }, [corners, imgNatural, onChange])

  const onPointerUp = () => { dragging.current = null }

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444']
  const LABELS = ['↖', '↗', '↘', '↙']

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none"
      style={{ userSelect: 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img
        src={imageUrl}
        className="w-full block rounded"
        draggable={false}
        onLoad={e => {
          const img = e.currentTarget
          setImgNatural({ w: img.naturalWidth, h: img.naturalHeight })
        }}
      />
      {/* Overlay polygon */}
      {imgNatural && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${imgNatural.w} ${imgNatural.h}`}
          preserveAspectRatio="none"
        >
          <polygon
            points={corners.map(p => `${p.x},${p.y}`).join(' ')}
            fill="rgba(59,130,246,0.15)"
            stroke="#3b82f6"
            strokeWidth="3"
          />
        </svg>
      )}
      {/* Drag handles */}
      {corners.map((p, i) => {
        const { left, top } = toDisplay(p)
        return (
          <div
            key={i}
            className="absolute w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold cursor-grab active:cursor-grabbing touch-none"
            style={{
              left, top,
              transform: 'translate(-50%,-50%)',
              background: COLORS[i],
              boxShadow: '0 1px 4px rgba(0,0,0,.4)',
              zIndex: 10,
            }}
            onPointerDown={onPointerDown(i)}
          >
            {LABELS[i]}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main CoverCropModal component
// ---------------------------------------------------------------------------

type Stage =
  | 'loading'       // decoding file / starting companion
  | 'qr'            // camera mode: showing QR code, waiting for phone photo
  | 'adjusting'     // showing 4-point adjuster
  | 'processing'    // running perspective warp + compress
  | 'error'

export function CoverCropModal({ isOpen, onClose, onConfirm, mode, initialFile }: CoverCropModalProps) {
  const [stage, setStage] = useState<Stage>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null)
  const [corners, setCorners] = useState<[Point, Point, Point, Point]>([[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>({x,y})) as [Point,Point,Point,Point])
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [processingLabel, setProcessingLabel] = useState('正在处理图片…')

  // Stable session ID — identifies this particular modal open so stale IPC
  // callbacks from a previous session don't clobber a new one.
  const sessionRef = useRef('')

  // Dispose function returned by companion.onCoverReceived
  const disposeListenerRef = useRef<(() => void) | null>(null)

  // ── Reset / setup on open/close ───────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      // Tear down listener on close
      disposeListenerRef.current?.()
      disposeListenerRef.current = null
      setStage('loading')
      setErrorMsg('')
      setSourceUrl(null)
      setSourceCanvas(null)
      setQrDataUrl(null)
      setCoverUrl(null)
      sessionRef.current = ''
      return
    }

    if (mode === 'file' && initialFile) {
      loadFile(initialFile)
    } else if (mode === 'camera') {
      void startQrFlow()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // ── File mode ─────────────────────────────────────────────────────────────
  function loadFile(file: File) {
    setStage('loading')
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string
      const img = new Image()
      img.onload = () => {
        // Electron/Chromium automatically applies EXIF orientation when rendering
        // an <img> element and when calling drawImage() — naturalWidth/Height
        // already reflect the corrected (visual) dimensions.
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d')!.drawImage(img, 0, 0)
        const imgData = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
        const { corners: detected, confidence } = detectRect(imgData)
        setSourceCanvas(canvas)
        setSourceUrl(canvas.toDataURL('image/jpeg', 0.92))
        setCorners(confidence >= 0.4 ? detected : insetCorners(canvas.width, canvas.height))
        setStage('adjusting')
      }
      img.onerror = () => { setErrorMsg('无法读取图片文件'); setStage('error') }
      img.src = dataUrl
    }
    reader.onerror = () => { setErrorMsg('文件读取失败'); setStage('error') }
    reader.readAsDataURL(file)
  }

  // ── Camera mode: start companion, generate QR, listen for photo ───────────
  async function startQrFlow() {
    setStage('loading')

    // Generate a stable random session ID for this modal open
    const session = Math.random().toString(36).slice(2) + Date.now().toString(36)
    sessionRef.current = session

    try {
      // Start companion server (idempotent if already running)
      const result = await window.companion.start() as { ok: boolean; url: string; token: string; error?: string }
      if (!result.ok) {
        setErrorMsg('无法启动手机连接服务：' + (result.error ?? '未知错误'))
        setStage('error')
        return
      }

      // Build the cover-capture URL: /cover?token=T&session=S
      // result.url is https://<ip>:<port>?token=T  — extract base + token
      const serverUrl = new URL(result.url)
      const token = serverUrl.searchParams.get('token') ?? result.token
      const base = serverUrl.origin  // https://<ip>:<port>
      const coverPageUrl = `${base}/cover?token=${token}&session=${session}`

      // Generate QR code as data URL
      const qr = await QRCode.toDataURL(coverPageUrl, {
        width: 256,
        margin: 2,
        color: { dark: '#1e293b', light: '#f8fafc' },
      })
      setQrDataUrl(qr)
      setCoverUrl(coverPageUrl)
      setStage('qr')

      // Register IPC listener for the photo coming back
      disposeListenerRef.current?.()
      const dispose = window.companion.onCoverReceived((payload: { dataUrl: string; session: string }) => {
        // Ignore photos from a different session
        if (payload.session !== sessionRef.current) return
        dispose()
        disposeListenerRef.current = null
        loadFromDataUrl(payload.dataUrl)
      })
      disposeListenerRef.current = dispose

    } catch (e) {
      setErrorMsg('启动失败：' + ((e as Error).message || '未知错误'))
      setStage('error')
    }
  }

  // ── Load a received photo into the adjuster ───────────────────────────────
  function loadFromDataUrl(dataUrl: string) {
    setStage('loading')
    const img = new Image()
    img.onload = () => {
      // The phone's mobile-cover.html uses drawImage() via an object URL,
      // which also lets the browser normalise EXIF before toDataURL().
      // On the desktop side Chromium likewise normalises via drawImage().
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      const imgData = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
      const { corners: detected, confidence } = detectRect(imgData)
      setSourceCanvas(canvas)
      setSourceUrl(canvas.toDataURL('image/jpeg', 0.92))
      setCorners(confidence >= 0.4 ? detected : insetCorners(canvas.width, canvas.height))
      setStage('adjusting')
    }
    img.onerror = () => { setErrorMsg('无法解析手机发来的图片'); setStage('error') }
    img.src = dataUrl
  }

  // ── Confirm: perspective warp + compress + OCR ───────────────────────────
  async function handleConfirm() {
    if (!sourceCanvas) return
    setProcessingLabel('正在裁剪…')
    setStage('processing')
    const [tl, tr, br, bl] = corners
    const wTop    = Math.hypot(tr.x - tl.x, tr.y - tl.y)
    const wBottom = Math.hypot(br.x - bl.x, br.y - bl.y)
    const hLeft   = Math.hypot(bl.x - tl.x, bl.y - tl.y)
    const hRight  = Math.hypot(br.x - tr.x, br.y - tr.y)
    const outW = Math.round(Math.max(wTop, wBottom))
    const outH = Math.round(Math.max(hLeft, hRight))
    if (outW < 10 || outH < 10) { setErrorMsg('裁剪区域太小'); setStage('error'); return }
    const warped = perspectiveWarp(sourceCanvas, corners, outW, outH)
    const result = compressCanvas(warped)
    setProcessingLabel('正在识别文字…')
    const ocrResult = await extractCoverText(result)
    onConfirm(result, ocrResult)
    onClose()
  }

  // ── Open cover URL in system browser (fallback for non-scannable) ─────────
  function openInBrowser() {
    if (coverUrl) void window.app.openExternal(coverUrl)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden max-h-[90dvh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {mode === 'file' ? '裁剪封面' : '手机拍摄封面'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">

          {/* Loading */}
          {stage === 'loading' && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400 dark:text-gray-500">
              <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
              <span className="text-sm">{mode === 'camera' ? '正在准备连接…' : '正在加载图片…'}</span>
            </div>
          )}

          {/* QR code — waiting for phone */}
          {stage === 'qr' && qrDataUrl && (
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 text-center leading-relaxed">
                用手机扫描下方二维码，拍摄封面后图片将自动传回
              </p>
              {/* QR code */}
              <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">
                <img src={qrDataUrl} alt="扫码链接" className="w-52 h-52 block" />
              </div>
              {/* Waiting indicator */}
              <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                <svg className="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                等待手机拍摄…
              </div>
              {/* Fallback: open in browser */}
              <button
                type="button"
                onClick={openInBrowser}
                className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2"
              >
                无法扫码？在浏览器中打开
              </button>
            </div>
          )}

          {/* Adjuster */}
          {stage === 'adjusting' && sourceUrl && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">拖动角点以精确框选封面范围</p>
              <CropAdjuster
                imageUrl={sourceUrl}
                initCorners={corners}
                onChange={setCorners}
              />
            </div>
          )}

          {/* Processing */}
          {stage === 'processing' && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400 dark:text-gray-500">
              <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
              <span className="text-sm">{processingLabel}</span>
            </div>
          )}

          {/* Error */}
          {stage === 'error' && (
            <div className="space-y-3">
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-4 text-sm text-red-600 dark:text-red-400">
                {errorMsg || '发生未知错误'}
              </div>
              {mode === 'camera' && (
                <button
                  type="button"
                  onClick={() => void startQrFlow()}
                  className="w-full py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  重试
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {stage === 'adjusting' && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              确认裁剪
            </button>
          </div>
        )}

        {/* Footer — retake button when in qr stage */}
        {stage === 'qr' && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
