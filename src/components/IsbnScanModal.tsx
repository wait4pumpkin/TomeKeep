import { useEffect, useMemo, useRef, useState } from 'react'

type BarcodeFormat = 'ean_13' | 'upc_a'

type DetectedBarcode = {
  rawValue: string
  format?: string
}

type BarcodeDetectorConstructor = {
  new (options?: { formats?: BarcodeFormat[] }): { detect: (video: HTMLVideoElement) => Promise<DetectedBarcode[]> }
}

type ScanStatus =
  | { state: 'idle' }
  | { state: 'starting' }
  | { state: 'unsupported'; message: string }
  | { state: 'permission_denied'; message: string }
  | { state: 'running' }
  | { state: 'error'; message: string }

export function IsbnScanModal(props: {
  isOpen: boolean
  onClose: () => void
  onDetected: (rawValue: string) => void
}) {
  const { isOpen, onClose, onDetected } = props
  const videoRef = useRef<HTMLVideoElement | null>(null)
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
          if (!v) return

          try {
            const barcodes = await detector.detect(v)
            const first = barcodes[0]
            if (first?.rawValue) {
              onDetected(first.rawValue)
              onClose()
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
      <div className="relative w-[min(720px,95vw)] rounded-xl bg-white shadow-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Scan ISBN</h3>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="rounded-lg bg-black overflow-hidden aspect-video">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          </div>

          {status.state !== 'running' && (
            <div className="text-sm text-gray-700">
              {status.state === 'starting' && '正在启动摄像头…'}
              {status.state === 'unsupported' && status.message}
              {status.state === 'permission_denied' && status.message}
              {status.state === 'error' && status.message}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
