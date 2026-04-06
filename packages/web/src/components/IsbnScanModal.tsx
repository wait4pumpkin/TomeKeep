// src/components/IsbnScanModal.tsx
// Barcode scanner modal for web/PWA.
//
// Uses the native BarcodeDetector API where available (Chrome Android),
// and falls back to the barcode-detector polyfill (ZXing-WASM) on iOS Safari.
// The WASM binary is self-hosted at /zxing_reader.wasm to avoid CDN dependency.

import { useEffect, useRef, useState } from 'react'
import { useLang } from '../lib/i18n.tsx'

// ---------------------------------------------------------------------------
// Types (mirrored from the BarcodeDetector spec)
// ---------------------------------------------------------------------------

type BarcodeFormat = 'ean_13' | 'upc_a'

type Point2D = { x: number; y: number }

type DetectedBarcode = {
  rawValue: string
  format?: string
  boundingBox?: DOMRectReadOnly
  cornerPoints?: Point2D[]
}

type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>
}

type ScanStatus =
  | { state: 'idle' }
  | { state: 'starting' }
  | { state: 'unsupported'; message: string }
  | { state: 'permission_denied'; message: string }
  | { state: 'running' }
  | { state: 'error'; message: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Play a short beep via Web Audio API. */
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
    // AudioContext unavailable — skip silently
  }
}

/** Draw detected barcode overlays onto a canvas scaled to the video display. */
function drawOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  barcodes: DetectedBarcode[],
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { clientWidth: w, clientHeight: h } = video
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  ctx.clearRect(0, 0, w, h)
  if (barcodes.length === 0) return
  const scaleX = video.videoWidth > 0 ? w / video.videoWidth : 1
  const scaleY = video.videoHeight > 0 ? h / video.videoHeight : 1
  for (const barcode of barcodes) {
    ctx.save()
    if (barcode.cornerPoints && barcode.cornerPoints.length >= 4) {
      ctx.beginPath()
      ctx.moveTo(barcode.cornerPoints[0].x * scaleX, barcode.cornerPoints[0].y * scaleY)
      for (let i = 1; i < barcode.cornerPoints.length; i++) {
        ctx.lineTo(barcode.cornerPoints[i].x * scaleX, barcode.cornerPoints[i].y * scaleY)
      }
      ctx.closePath()
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.9)'
      ctx.lineWidth = 2.5
      ctx.stroke()
      ctx.fillStyle = 'rgba(74, 222, 128, 0.12)'
      ctx.fill()
    } else if (barcode.boundingBox) {
      const { x, y, width, height } = barcode.boundingBox
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.9)'
      ctx.lineWidth = 2.5
      ctx.strokeRect(x * scaleX, y * scaleY, width * scaleX, height * scaleY)
      ctx.fillStyle = 'rgba(74, 222, 128, 0.12)'
      ctx.fillRect(x * scaleX, y * scaleY, width * scaleX, height * scaleY)
    }
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

// ---------------------------------------------------------------------------
// Build a BarcodeDetector instance, using polyfill on browsers without native support.
// The WASM binary is served from /zxing_reader.wasm (self-hosted).
// ---------------------------------------------------------------------------

async function buildDetector(formats: BarcodeFormat[]): Promise<BarcodeDetectorInstance> {
  // Try native first (Chrome Android, some Chromium builds)
  const native = (globalThis as Record<string, unknown>).BarcodeDetector as
    | (new (opts: { formats: BarcodeFormat[] }) => BarcodeDetectorInstance)
    | undefined
  if (native) {
    return new native({ formats })
  }

  // Polyfill: barcode-detector (ZXing-WASM), point WASM at self-hosted binary
  const { setZXingModuleOverrides } = await import('barcode-detector/ponyfill')
  setZXingModuleOverrides({ locateFile: () => '/zxing_reader.wasm' })
  const { BarcodeDetector: Polyfill } = await import('barcode-detector/ponyfill')
  return new Polyfill({ formats })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface IsbnScanModalProps {
  isOpen: boolean
  onClose: () => void
  /** Called for every successfully decoded barcode rawValue. */
  onDetected: (rawValue: string) => void
  /** 'single' closes after first scan; 'batch' keeps scanning until user taps Done. */
  mode?: 'single' | 'batch'
}

export function IsbnScanModal({ isOpen, onClose, onDetected, mode = 'single' }: IsbnScanModalProps) {
  const { t } = useLang()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const [status, setStatus] = useState<ScanStatus>({ state: 'idle' })
  const [isMirrored, setIsMirrored] = useState(false)
  const [scanned, setScanned] = useState<string[]>([])
  const cooldownRef = useRef(false)
  const isDetectingRef = useRef(false)

  // Reset scanned list on open
  useEffect(() => {
    if (isOpen) setScanned([])
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    async function start() {
      setStatus({ state: 'starting' })

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({ state: 'unsupported', message: t('scan_unsupported_camera') })
        return
      }

      let detector: BarcodeDetectorInstance
      try {
        detector = await buildDetector(['ean_13', 'upc_a'])
      } catch {
        setStatus({ state: 'unsupported', message: t('scan_unsupported_barcode') })
        return
      }

      if (cancelled) return

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach(tr => tr.stop())
          return
        }

        streamRef.current = stream

        const facing = stream.getVideoTracks()[0]?.getSettings().facingMode
        setIsMirrored(facing !== 'environment')

        const video = videoRef.current
        if (!video) {
          stream.getTracks().forEach(tr => tr.stop())
          streamRef.current = null
          setStatus({ state: 'error', message: '未能初始化预览画面。' })
          return
        }

        video.srcObject = stream
        await video.play()
        setStatus({ state: 'running' })

        const tick = async () => {
          if (cancelled) return
          const v = videoRef.current
          const cvs = canvasRef.current
          if (!v) return

          if (!isDetectingRef.current) {
            isDetectingRef.current = true
            try {
              const barcodes = await detector.detect(v)
              if (cvs) drawOverlay(cvs, v, barcodes)

              const first = barcodes[0]
              if (first?.rawValue && !cooldownRef.current) {
                cooldownRef.current = true
                if (cvs) drawOverlay(cvs, v, [first])
                playBeep()

                if (mode === 'single') {
                  setTimeout(() => {
                    onDetected(first.rawValue)
                    onClose()
                  }, 180)
                  return
                } else {
                  onDetected(first.rawValue)
                  setScanned(prev =>
                    prev.includes(first.rawValue) ? prev : [...prev, first.rawValue],
                  )
                  setTimeout(() => {
                    cooldownRef.current = false
                    if (!cancelled) {
                      rafRef.current = requestAnimationFrame(() => { void tick() })
                    }
                  }, 1200)
                  return
                }
              }
            } catch (e) {
              const message = e instanceof Error ? e.message : '未知错误'
              setStatus({ state: 'error', message })
              return
            } finally {
              isDetectingRef.current = false
            }
          }

          rafRef.current = requestAnimationFrame(() => { void tick() })
        }

        void tick()
      } catch (e) {
        if (cancelled) return
        const name = e instanceof DOMException ? e.name : ''
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setStatus({ state: 'permission_denied', message: t('scan_permission_denied') })
          return
        }
        setStatus({ state: 'error', message: e instanceof Error ? e.message : '未知错误' })
      }
    }

    void start()

    return () => {
      cancelled = true
      cooldownRef.current = false
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(tr => tr.stop())
        streamRef.current = null
      }
      setStatus({ state: 'idle' })
    }
  }, [isOpen, onClose, onDetected, mode, t])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet — slides up on mobile, centered on larger screens */}
      <div className="relative w-full sm:w-[min(480px,95vw)] rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {mode === 'batch' ? t('scan_title_batch') : t('scan_title_single')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {mode === 'batch' ? t('scan_done') : t('scan_close')}
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Video preview + canvas overlay */}
          <div className="relative rounded-xl bg-black overflow-hidden aspect-video">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              style={isMirrored ? { transform: 'scaleX(-1)' } : undefined}
              muted
              playsInline
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={isMirrored ? { transform: 'scaleX(-1)' } : undefined}
            />
            {/* Scan guide line */}
            {status.state === 'running' && (
              <div className="absolute inset-x-6 top-1/2 -translate-y-px h-0.5 bg-green-400/70 rounded-full" />
            )}
          </div>

          {/* Status messages */}
          {status.state !== 'running' && (
            <p className="text-sm text-center text-gray-600 dark:text-gray-400">
              {status.state === 'starting' && t('scan_starting')}
              {(status.state === 'unsupported' || status.state === 'permission_denied' || status.state === 'error') && status.message}
            </p>
          )}
          {status.state === 'running' && (
            <p className="text-xs text-center text-gray-400 dark:text-gray-500">
              {mode === 'batch' ? t('scan_hint_batch') : t('scan_hint_single')}
            </p>
          )}

          {/* Batch scanned list */}
          {mode === 'batch' && scanned.length > 0 && (
            <div className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500 dark:text-gray-400">
                {t('scan_count', { n: scanned.length })}
              </div>
              <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-32 overflow-y-auto">
                {scanned.map((isbn, i) => (
                  <li key={isbn} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300">
                    <span className="text-gray-400 dark:text-gray-500 w-4 text-right shrink-0">{i + 1}</span>
                    <span className="font-mono">{isbn}</span>
                    <svg className="w-3 h-3 text-green-500 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              {mode === 'batch' ? t('scan_done') : t('scan_cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
