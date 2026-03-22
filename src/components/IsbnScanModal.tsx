import { useEffect, useMemo, useRef, useState } from 'react'

type BarcodeFormat = 'ean_13' | 'upc_a'

type Point2D = { x: number; y: number }

type DetectedBarcode = {
  rawValue: string
  format?: string
  boundingBox?: DOMRectReadOnly
  cornerPoints?: Point2D[]
}

type BarcodeDetectorConstructor = {
  new (options?: { formats?: BarcodeFormat[] }): {
    detect: (video: HTMLVideoElement) => Promise<DetectedBarcode[]>
  }
}

type ScanStatus =
  | { state: 'idle' }
  | { state: 'starting' }
  | { state: 'unsupported'; message: string }
  | { state: 'permission_denied'; message: string }
  | { state: 'running' }
  | { state: 'error'; message: string }

/** Play a short two-tone beep using Web Audio API (no file dependency). */
function playBeep() {
  try {
    const ctx = new AudioContext()
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
    gain.connect(ctx.destination)

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.linearRampToValueAtTime(1320, ctx.currentTime + 0.06)
    osc.connect(gain)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.12)
    osc.onended = () => void ctx.close()
  } catch {
    // AudioContext not available — silently skip
  }
}

/** Draw barcode candidate overlays onto the canvas, scaled to the video display size. */
function drawOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  barcodes: DetectedBarcode[],
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Sync canvas size to the video element's rendered (CSS) size
  const { clientWidth: w, clientHeight: h } = video
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }

  ctx.clearRect(0, 0, w, h)
  if (barcodes.length === 0) return

  // Scale factors from video intrinsic → display size
  const scaleX = video.videoWidth > 0 ? w / video.videoWidth : 1
  const scaleY = video.videoHeight > 0 ? h / video.videoHeight : 1

  for (const barcode of barcodes) {
    ctx.save()

    if (barcode.cornerPoints && barcode.cornerPoints.length >= 4) {
      // Draw polygon around detected barcode
      ctx.beginPath()
      ctx.moveTo(barcode.cornerPoints[0].x * scaleX, barcode.cornerPoints[0].y * scaleY)
      for (let i = 1; i < barcode.cornerPoints.length; i++) {
        ctx.lineTo(barcode.cornerPoints[i].x * scaleX, barcode.cornerPoints[i].y * scaleY)
      }
      ctx.closePath()
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.9)'  // green-400
      ctx.lineWidth = 2.5
      ctx.stroke()
      ctx.fillStyle = 'rgba(74, 222, 128, 0.12)'
      ctx.fill()
    } else if (barcode.boundingBox) {
      // Fallback: bounding box rectangle
      const { x, y, width, height } = barcode.boundingBox
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.9)'
      ctx.lineWidth = 2.5
      ctx.strokeRect(x * scaleX, y * scaleY, width * scaleX, height * scaleY)
      ctx.fillStyle = 'rgba(74, 222, 128, 0.12)'
      ctx.fillRect(x * scaleX, y * scaleY, width * scaleX, height * scaleY)
    }

    // Label: show raw value above the bounding area
    const labelX = barcode.boundingBox
      ? barcode.boundingBox.x * scaleX
      : (barcode.cornerPoints?.[0].x ?? 0) * scaleX
    const labelY = barcode.boundingBox
      ? barcode.boundingBox.y * scaleY - 6
      : (barcode.cornerPoints?.[0].y ?? 0) * scaleY - 6

    ctx.font = '11px monospace'
    ctx.fillStyle = 'rgba(74, 222, 128, 1)'
    ctx.fillText(barcode.rawValue, labelX, Math.max(labelY, 14))

    ctx.restore()
  }
}

export function IsbnScanModal(props: {
  isOpen: boolean
  onClose: () => void
  onDetected: (rawValue: string) => void
}) {
  const { isOpen, onClose, onDetected } = props
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const [status, setStatus] = useState<ScanStatus>({ state: 'idle' })

  const BarcodeDetectorCtor = useMemo(() => {
    const maybe = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
    return maybe ?? null
  }, [])

  useEffect(() => {
    if (!isOpen) return

    let cancelled = false

    async function start() {
      setStatus({ state: 'starting' })

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({ state: 'unsupported', message: '当前环境不支持摄像头访问。' })
        return
      }
      if (!BarcodeDetectorCtor) {
        setStatus({ state: 'unsupported', message: '当前环境不支持条码识别（BarcodeDetector）。' })
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop())
          return
        }

        streamRef.current = stream

        const video = videoRef.current
        if (!video) {
          stream.getTracks().forEach(t => t.stop())
          streamRef.current = null
          setStatus({ state: 'error', message: '未能初始化预览画面。' })
          return
        }

        video.srcObject = stream
        await video.play()

        const detector = new BarcodeDetectorCtor({ formats: ['ean_13', 'upc_a'] })
        setStatus({ state: 'running' })

        const tick = async () => {
          if (cancelled) return
          const v = videoRef.current
          const cvs = canvasRef.current
          if (!v) return

          try {
            const barcodes = await detector.detect(v)

            // Draw candidate overlays on every frame (even if no match yet)
            if (cvs) drawOverlay(cvs, v, barcodes)

            const first = barcodes[0]
            if (first?.rawValue) {
              // Draw the final confirmed barcode, play beep, then close
              if (cvs) drawOverlay(cvs, v, [first])
              playBeep()
              // Small delay so the green overlay is visible before modal closes
              setTimeout(() => {
                onDetected(first.rawValue)
                onClose()
              }, 180)
              return
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : '未知错误'
            setStatus({ state: 'error', message })
            return
          }

          rafRef.current = requestAnimationFrame(() => {
            void tick()
          })
        }

        void tick()
      } catch (e) {
        if (cancelled) return
        const message = e instanceof Error ? e.message : '未知错误'
        const name = e instanceof DOMException ? e.name : ''
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setStatus({ state: 'permission_denied', message: '摄像头权限被拒绝，请在系统设置中开启后重试。' })
          return
        }
        setStatus({ state: 'error', message })
      }
    }

    void start()

    return () => {
      cancelled = true
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
      setStatus({ state: 'idle' })
    }
  }, [BarcodeDetectorCtor, isOpen, onClose, onDetected])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-[min(720px,95vw)] rounded-xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">扫描 ISBN</h3>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            关闭
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Video + canvas overlay stacked */}
          <div className="relative rounded-lg bg-black overflow-hidden aspect-video">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
          </div>

          {status.state !== 'running' && (
            <div className="text-sm text-gray-700 dark:text-gray-300">
              {status.state === 'starting' && '正在启动摄像头…'}
              {status.state === 'unsupported' && status.message}
              {status.state === 'permission_denied' && status.message}
              {status.state === 'error' && status.message}
            </div>
          )}
          {status.state === 'running' && (
            <div className="text-sm text-gray-400 dark:text-gray-500 text-center">
              将条形码对准摄像头，自动识别后关闭
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
