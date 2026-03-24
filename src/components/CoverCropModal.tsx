import { useEffect, useRef, useState, useCallback } from 'react'

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
  onConfirm: (dataUrl: string) => void
  mode: 'file' | 'camera'
  initialFile?: File
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

type Point = { x: number; y: number }

/** Bilinear-interpolated pixel fetch from ImageData */
function sampleGray(data: Uint8ClampedArray, w: number, h: number, x: number, y: number): number {
  const xi = Math.max(0, Math.min(w - 1, Math.round(x)))
  const yi = Math.max(0, Math.min(h - 1, Math.round(y)))
  const i = (yi * w + xi) * 4
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
}

/**
 * Sobel-based edge detection on ImageData.
 * Returns a Float32Array of edge magnitudes normalised to [0,1].
 */
function sobelEdges(imgData: ImageData): Float32Array {
  const { data, width: w, height: h } = imgData
  const edges = new Float32Array(w * h)
  let maxMag = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -sampleGray(data, w, h, x - 1, y - 1) - 2 * sampleGray(data, w, h, x - 1, y) - sampleGray(data, w, h, x - 1, y + 1) +
         sampleGray(data, w, h, x + 1, y - 1) + 2 * sampleGray(data, w, h, x + 1, y) + sampleGray(data, w, h, x + 1, y + 1)
      const gy =
        -sampleGray(data, w, h, x - 1, y - 1) - 2 * sampleGray(data, w, h, x, y - 1) - sampleGray(data, w, h, x + 1, y - 1) +
         sampleGray(data, w, h, x - 1, y + 1) + 2 * sampleGray(data, w, h, x, y + 1) + sampleGray(data, w, h, x + 1, y + 1)
      const mag = Math.sqrt(gx * gx + gy * gy)
      edges[y * w + x] = mag
      if (mag > maxMag) maxMag = mag
    }
  }
  if (maxMag > 0) for (let i = 0; i < edges.length; i++) edges[i] /= maxMag
  return edges
}

/**
 * Find the largest axis-aligned rectangle with high edge density.
 * Returns corners [tl, tr, br, bl] in image-pixel coordinates.
 * Also returns a confidence score in [0, 1].
 */
function detectRect(imgData: ImageData): { corners: [Point, Point, Point, Point]; confidence: number } {
  const { width: w, height: h } = imgData
  const edges = sobelEdges(imgData)
  const threshold = 0.2

  // Compute row/column edge density profiles
  const rowDensity = new Float32Array(h)
  const colDensity = new Float32Array(w)
  for (let y = 0; y < h; y++) {
    let sum = 0
    for (let x = 0; x < w; x++) sum += edges[y * w + x] > threshold ? 1 : 0
    rowDensity[y] = sum / w
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = 0; y < h; y++) sum += edges[y * w + x] > threshold ? 1 : 0
    colDensity[x] = sum / h
  }

  // Find outermost rows/cols with density above a threshold (edge of the cover)
  const rowThr = 0.08, colThr = 0.06
  let top = Math.round(h * 0.05), bottom = Math.round(h * 0.95)
  let left = Math.round(w * 0.05), right = Math.round(w * 0.95)

  for (let y = 0; y < h; y++) { if (rowDensity[y] > rowThr) { top = y; break } }
  for (let y = h - 1; y >= 0; y--) { if (rowDensity[y] > rowThr) { bottom = y; break } }
  for (let x = 0; x < w; x++) { if (colDensity[x] > colThr) { left = x; break } }
  for (let x = w - 1; x >= 0; x--) { if (colDensity[x] > colThr) { right = x; break } }

  // Clamp with margin
  const margin = 4
  top    = Math.max(margin, top - margin)
  bottom = Math.min(h - margin, bottom + margin)
  left   = Math.max(margin, left - margin)
  right  = Math.min(w - margin, right + margin)

  const rectW = right - left
  const rectH = bottom - top
  const area = (rectW * rectH) / (w * h)
  const aspect = rectW / rectH
  // Good cover: covers ≥40% of image, aspect ratio book-like (0.45–0.9)
  const confidence = area >= 0.4 && aspect >= 0.45 && aspect <= 0.9 ? Math.min(1, area * 1.5) : 0

  return {
    corners: [
      { x: left,  y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left,  y: bottom },
    ],
    confidence,
  }
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
// Perspective transform (homography) — pure Canvas 2D
// Adapted from standard 4-point DLT algorithm.
// ---------------------------------------------------------------------------

type Mat3 = [number, number, number, number, number, number, number, number, number]

/** Compute the homography H mapping srcPts → [0,0,1,0,1,1,0,1] unit square */
function computeHomography(src: [Point, Point, Point, Point], dstW: number, dstH: number): Mat3 {
  // We solve H such that H * src[i] ~ dst[i] using the 4-point normalized DLT.
  // For simplicity we use the closed-form unit-square approach.
  // dst points: (0,0),(dstW,0),(dstW,dstH),(0,dstH)
  const dst: [Point, Point, Point, Point] = [
    { x: 0,    y: 0 },
    { x: dstW, y: 0 },
    { x: dstW, y: dstH },
    { x: 0,    y: dstH },
  ]

  // Build 8×9 matrix A for the DLT, solve via Gaussian elimination
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i]
    const { x: dx, y: dy } = dst[i]
    A.push([-sx, -sy, -1,   0,   0,  0, dx*sx, dx*sy, dx])
    A.push([  0,   0,  0, -sx, -sy, -1, dy*sx, dy*sy, dy])
  }

  // Gaussian elimination with partial pivoting on 8×9 augmented matrix
  const n = 8
  for (let col = 0; col < n; col++) {
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
      const factor = A[row][col]
      for (let j = col; j <= n; j++) A[row][j] -= factor * A[col][j]
    }
  }

  const h = A.map(r => r[n])
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] as Mat3
}

/**
 * Warp source ImageData using the inverse homography via per-pixel sampling.
 * Output is a new canvas of size outW × outH.
 */
function perspectiveWarp(
  srcCanvas: HTMLCanvasElement,
  corners: [Point, Point, Point, Point],
  outW: number,
  outH: number,
): HTMLCanvasElement {
  const H = computeHomography(corners, outW, outH)

  // Compute inverse H for backward mapping
  // Inverse of 3×3 via cofactors
  const [h0,h1,h2,h3,h4,h5,h6,h7,h8] = H
  const det = h0*(h4*h8-h5*h7) - h1*(h3*h8-h5*h6) + h2*(h3*h7-h4*h6)
  const inv: Mat3 = [
     (h4*h8-h5*h7)/det, -(h1*h8-h2*h7)/det,  (h1*h5-h2*h4)/det,
    -(h3*h8-h5*h6)/det,  (h0*h8-h2*h6)/det, -(h0*h5-h2*h3)/det,
     (h3*h7-h4*h6)/det, -(h0*h7-h1*h6)/det,  (h0*h4-h1*h3)/det,
  ]

  const srcCtx = srcCanvas.getContext('2d')!
  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height)

  const out = document.createElement('canvas')
  out.width = outW; out.height = outH
  const outCtx = out.getContext('2d')!
  const outData = outCtx.createImageData(outW, outH)

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      const wx = inv[0]*dx + inv[1]*dy + inv[2]
      const wy = inv[3]*dx + inv[4]*dy + inv[5]
      const ww = inv[6]*dx + inv[7]*dy + inv[8]
      const sx = wx / ww
      const sy = wy / ww
      // Bilinear sample
      const x0 = Math.floor(sx), y0 = Math.floor(sy)
      const x1 = x0 + 1, y1 = y0 + 1
      const fx = sx - x0, fy = sy - y0
      const sw = srcCanvas.width, sh = srcCanvas.height
      const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v))
      const idx = (x: number, y: number) => (clamp(y, sh) * sw + clamp(x, sw)) * 4
      const i00 = idx(x0,y0), i10 = idx(x1,y0), i01 = idx(x0,y1), i11 = idx(x1,y1)
      const oi = (dy * outW + dx) * 4
      for (let c = 0; c < 3; c++) {
        outData.data[oi+c] = Math.round(
          srcData.data[i00+c]*(1-fx)*(1-fy) + srcData.data[i10+c]*fx*(1-fy) +
          srcData.data[i01+c]*(1-fx)*fy     + srcData.data[i11+c]*fx*fy
        )
      }
      outData.data[oi+3] = 255
    }
  }
  outCtx.putImageData(outData, 0, 0)
  return out
}

/**
 * Compress a canvas to a JPEG data URL.
 * Output is capped at maxW×maxH, preserving aspect ratio.
 */
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
  | 'loading'       // decoding file / starting camera
  | 'detecting'     // camera: running live detection
  | 'adjusting'     // showing 4-point adjuster (file or frozen camera frame)
  | 'processing'    // running perspective warp + compress
  | 'error'

export function CoverCropModal({ isOpen, onClose, onConfirm, mode, initialFile }: CoverCropModalProps) {
  const [stage, setStage] = useState<Stage>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)      // data URL of the source image for adjuster
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null)
  const [corners, setCorners] = useState<[Point, Point, Point, Point]>([[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>({x,y})) as [Point,Point,Point,Point])
  const [detectLabel, setDetectLabel] = useState('检测中…')
  const [isMirrored, setIsMirrored] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const stageRef = useRef<Stage>('loading')
  const consecutiveHitsRef = useRef(0)
  // Ref mirror of isMirrored so rAF callbacks always read the latest value
  const isMirroredRef = useRef(false)

  // Keep stageRef and isMirroredRef in sync
  useEffect(() => { stageRef.current = stage }, [stage])
  useEffect(() => { isMirroredRef.current = isMirrored }, [isMirrored])

  // ── Reset on open/close ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      stopCamera()
      setStage('loading')
      setSourceUrl(null)
      setSourceCanvas(null)
      setErrorMsg('')
      setDetectLabel('检测中…')
      consecutiveHitsRef.current = 0
      return
    }
    if (mode === 'file' && initialFile) {
      loadFile(initialFile)
    } else if (mode === 'camera') {
      startCamera()
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
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d')!.drawImage(img, 0, 0)
        const imgData = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
        const { corners: detected, confidence } = detectRect(imgData)
        setSourceCanvas(canvas)
        setSourceUrl(dataUrl)
        setCorners(confidence >= 0.4 ? detected : insetCorners(canvas.width, canvas.height))
        setStage('adjusting')
      }
      img.onerror = () => { setErrorMsg('无法读取图片文件'); setStage('error') }
      img.src = dataUrl
    }
    reader.onerror = () => { setErrorMsg('文件读取失败'); setStage('error') }
    reader.readAsDataURL(file)
  }

  // ── Camera mode ───────────────────────────────────────────────────────────
  async function startCamera() {
    setStage('loading')
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg('此环境不支持摄像头访问'); setStage('error'); return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      const track = stream.getVideoTracks()[0]
      const settings = track.getSettings()
      const facingMode = settings.facingMode ?? ''
      const mirrored = facingMode === 'user'
      setIsMirrored(mirrored)
      isMirroredRef.current = mirrored

      // The <video> element is always rendered (hidden when not in use),
      // so videoRef.current is guaranteed to exist here.
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()
      setStage('detecting')
      consecutiveHitsRef.current = 0
      let frameCount = 0
      const tick = () => {
        if (stageRef.current !== 'detecting') return
        frameCount++
        if (frameCount % 5 === 0) runDetection()
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setErrorMsg('摄像头权限被拒绝，请在系统设置中允许后重试')
      } else {
        setErrorMsg('摄像头启动失败：' + ((e as Error).message || '未知错误'))
      }
      setStage('error')
    }
  }

  function runDetection() {
    const video = videoRef.current
    if (!video || video.readyState < video.HAVE_CURRENT_DATA) return
    const canvas = document.createElement('canvas')
    // Detect at half resolution for speed
    canvas.width  = Math.round(video.videoWidth  * 0.5)
    canvas.height = Math.round(video.videoHeight * 0.5)
    if (!canvas.width || !canvas.height) return
    const ctx = canvas.getContext('2d')!
    if (isMirroredRef.current) {
      ctx.translate(canvas.width, 0); ctx.scale(-1, 1)
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const { corners: detected, confidence } = detectRect(imgData)

    if (confidence >= 0.4) {
      consecutiveHitsRef.current++
      setDetectLabel(`已识别封面${consecutiveHitsRef.current < 3 ? '…' : '，请确认'}`)
      if (consecutiveHitsRef.current >= 3) {
        freezeFrame(canvas, detected)
      }
    } else {
      consecutiveHitsRef.current = 0
      setDetectLabel('检测中…')
    }
  }

  function captureManual() {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')!
    if (isMirroredRef.current) {
      ctx.translate(canvas.width, 0); ctx.scale(-1, 1)
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const fallback = insetCorners(canvas.width, canvas.height)
    // Try to detect on the full-res capture
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const { corners: detected, confidence } = detectRect(imgData)
    freezeFrame(canvas, confidence >= 0.4 ? detected : fallback)
  }

  function freezeFrame(canvas: HTMLCanvasElement, detectedCorners: [Point, Point, Point, Point]) {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    stopCamera()
    setSourceCanvas(canvas)
    setSourceUrl(canvas.toDataURL('image/jpeg', 0.92))
    setCorners(detectedCorners)
    setStage('adjusting')
  }

  function stopCamera() {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
  }

  // ── Confirm: perspective warp + compress ──────────────────────────────────
  function handleConfirm() {
    if (!sourceCanvas) return
    setStage('processing')
    // Compute output size from corners aspect ratio
    const [tl, tr, br, bl] = corners
    const wTop    = Math.hypot(tr.x - tl.x, tr.y - tl.y)
    const wBottom = Math.hypot(br.x - bl.x, br.y - bl.y)
    const hLeft   = Math.hypot(bl.x - tl.x, bl.y - tl.y)
    const hRight  = Math.hypot(br.x - tr.x, br.y - tr.y)
    const outW = Math.round(Math.max(wTop, wBottom))
    const outH = Math.round(Math.max(hLeft, hRight))
    if (outW < 10 || outH < 10) { setErrorMsg('裁剪区域太小'); setStage('error'); return }
    const warped = perspectiveWarp(sourceCanvas, corners, outW, outH)
    const dataUrl = compressCanvas(warped)
    onConfirm(dataUrl)
    onClose()
  }

  if (!isOpen) return null

  const mirrorClass = isMirrored ? 'scale-x-[-1]' : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {mode === 'file' ? '裁剪封面' : '拍摄封面'}
          </h2>
          <button
            onClick={() => { stopCamera(); onClose() }}
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
              <span className="text-sm">{mode === 'camera' ? '正在启动摄像头…' : '正在加载图片…'}</span>
            </div>
          )}

          {/* Camera: video element always mounted so videoRef is available before play() */}
          {mode === 'camera' && (
            <div className={stage === 'detecting' ? 'space-y-2' : 'hidden'}>
              <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
                <video
                  ref={videoRef}
                  muted playsInline
                  className={`w-full h-full object-cover ${mirrorClass}`}
                />
                {/* Viewfinder corners */}
                <div className="absolute inset-0 pointer-events-none">
                  {[['top-3 left-3 border-t-2 border-l-2 rounded-tl'], ['top-3 right-3 border-t-2 border-r-2 rounded-tr'], ['bottom-3 left-3 border-b-2 border-l-2 rounded-bl'], ['bottom-3 right-3 border-b-2 border-r-2 rounded-br']].map(([cls], i) => (
                    <div key={i} className={`absolute w-5 h-5 border-white/60 ${cls}`} />
                  ))}
                </div>
                {/* Status badge */}
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-3 py-1 rounded-full backdrop-blur-sm">
                  {detectLabel}
                </div>
              </div>
              <button
                type="button"
                onClick={captureManual}
                className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                手动拍摄
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
              <span className="text-sm">正在处理图片…</span>
            </div>
          )}

          {/* Error */}
          {stage === 'error' && (
            <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-4 text-sm text-red-600 dark:text-red-400">
              {errorMsg || '发生未知错误'}
            </div>
          )}
        </div>

        {/* Footer */}
        {stage === 'adjusting' && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
            <button
              type="button"
              onClick={() => { stopCamera(); onClose() }}
              className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              确认裁剪
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
