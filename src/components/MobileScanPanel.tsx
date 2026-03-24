import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

type ServerState =
  | { phase: 'starting' }
  | { phase: 'error'; message: string }
  | { phase: 'running'; url: string }
  | { phase: 'stopped' }

type ScannedEntry = {
  isbn: string
  /** Book title once metadata is resolved; undefined while pending */
  title: string | undefined
  /** undefined = pending ack; true = saved with metadata; false = saved ISBN-only */
  hasMetadata: boolean | undefined
}

/**
 * MobileScanPanel
 *
 * Displays a QR code that the user scans with their phone to open the companion
 * scanning page. ISBNs received from the phone are forwarded to `onDetected`.
 *
 * The panel starts the HTTPS companion server on mount and stops it on unmount.
 */
export function MobileScanPanel(props: {
  onDetected: (isbn: string) => void
  /** Called with (isbn, hasMetadata) after the desktop finishes processing a scan. */
  onScanProcessed?: (isbn: string, hasMetadata: boolean) => void
  /** Called when the user wants to remove a failed (no-metadata) entry from the library. */
  onDeleteEntry?: (isbn: string) => void
  onClose: () => void
}) {
  const { onDetected, onScanProcessed, onDeleteEntry, onClose } = props

  const [serverState, setServerState] = useState<ServerState>({ phase: 'starting' })
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [scanned, setScanned] = useState<ScannedEntry[]>([])
  const disposeRef = useRef<(() => void) | null>(null)

  // Start server and register ISBN listener on mount
  useEffect(() => {
    let unmounted = false

    async function start() {
      const result = await window.companion.start()
      if (unmounted) return

      if (!result.ok) {
        setServerState({ phase: 'error', message: result.error })
        return
      }

      setServerState({ phase: 'running', url: result.url })

      // Generate QR code image
      try {
        const dataUrl = await QRCode.toDataURL(result.url, {
          width: 240,
          margin: 2,
          color: { dark: '#0f172a', light: '#f8fafc' },
        })
        if (!unmounted) setQrDataUrl(dataUrl)
      } catch {
        // QR generation failed — not fatal, URL is still shown as text
      }

      // Register phone → desktop ISBN listener
      const dispose = window.companion.onIsbnReceived((isbn) => {
        if (unmounted) return
        // Add to pending list immediately
        setScanned(prev =>
          prev.some(e => e.isbn === isbn)
            ? prev
            : [{ isbn, title: undefined, hasMetadata: undefined }, ...prev]
        )
        onDetected(isbn)
      })

      // Register phone-initiated delete listener
      const disposeDelete = window.companion.onDeleteEntryReceived((isbn) => {
        if (unmounted) return
        setScanned(prev => prev.filter(e => e.isbn !== isbn))
        onDeleteEntry?.(isbn)
      })

      disposeRef.current = () => { dispose(); disposeDelete() }
    }

    void start()

    return () => {
      unmounted = true
      disposeRef.current?.()
      disposeRef.current = null
      void window.companion.stop()
    }
  }, [onDetected])

  // Allow parent to signal ack (hasMetadata result) back to the phone
  const acknowledgeIsbn = useCallback((isbn: string, hasMetadata: boolean, title?: string) => {
    setScanned(prev =>
      prev.map(e => e.isbn === isbn ? { ...e, hasMetadata, title: title ?? e.title } : e)
    )
    window.companion.sendScanAck(isbn, hasMetadata, title)
    onScanProcessed?.(isbn, hasMetadata)
  }, [onScanProcessed])

  // Keep window.__mobileScanAck always pointing to the latest acknowledgeIsbn.
  const ackRef = useRef(acknowledgeIsbn)
  useEffect(() => { ackRef.current = acknowledgeIsbn }, [acknowledgeIsbn])

  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__mobileScanAck =
      (isbn: string, hasMetadata: boolean, title?: string) => ackRef.current(isbn, hasMetadata, title)
    return () => {
      delete (window as unknown as Record<string, unknown>).__mobileScanAck
    }
  }, [])

  const scannedCount = scanned.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop — intentionally no onClick to prevent accidental close */}
      <div className="absolute inset-0 bg-black/40" />

      <div className="relative w-[min(480px,96vw)] rounded-2xl bg-white dark:bg-gray-800 shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            {/* Phone icon */}
            <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 20.25h3" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">手机扫码入库</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">扫描下方二维码，用手机摄像头批量录入</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="关闭"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          <div className="px-5 py-5 space-y-5">

            {/* QR code / loading / error area */}
            {serverState.phase === 'starting' && (
              <div className="flex flex-col items-center gap-3 py-8">
                <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-500 dark:text-gray-400">正在启动服务…</p>
              </div>
            )}

            {serverState.phase === 'error' && (
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-center">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">启动失败</p>
                <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-1">{serverState.message}</p>
                <button
                  type="button"
                  onClick={async () => {
                    setServerState({ phase: 'starting' })
                    const r = await window.companion.start()
                    if (r.ok) {
                      setServerState({ phase: 'running', url: r.url })
                      try {
                        const d = await QRCode.toDataURL(r.url, { width: 240, margin: 2, color: { dark: '#0f172a', light: '#f8fafc' } })
                        setQrDataUrl(d)
                      } catch { /* ignore */ }
                    } else {
                      setServerState({ phase: 'error', message: r.error })
                    }
                  }}
                  className="mt-3 text-xs text-red-600 dark:text-red-400 underline"
                >
                  重试
                </button>
              </div>
            )}

            {serverState.phase === 'running' && (
              <>
                {/* Server status badge */}
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-2.5 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    服务运行中
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 truncate select-all" title={serverState.url}>
                    {serverState.url.replace(/\?token=.*/, '')}
                  </span>
                </div>

                {/* QR code */}
                <div className="flex flex-col items-center gap-3">
                  {qrDataUrl ? (
                    <div className="p-3 bg-slate-50 dark:bg-slate-100 rounded-xl border border-gray-200 dark:border-gray-600 shadow-sm">
                      <img src={qrDataUrl} alt="扫码连接" className="w-[200px] h-[200px]" />
                    </div>
                  ) : (
                    <div className="w-[224px] h-[224px] rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400 text-xs">
                      生成二维码…
                    </div>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center max-w-[260px]">
                    用手机扫描二维码，打开扫码页面<br />
                    iOS 需信任证书（首次）
                  </p>
                </div>

                {/* iOS trust guide */}
                <details className="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <summary className="px-4 py-2.5 text-xs font-medium text-gray-600 dark:text-gray-400 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                    </svg>
                    iOS 首次使用：如何信任证书？
                  </summary>
                  <div className="px-4 pb-3 pt-1 text-xs text-gray-500 dark:text-gray-400 space-y-1 leading-relaxed border-t border-gray-100 dark:border-gray-700">
                    <p>1. 扫码后 Safari 显示"此连接不是私密的"</p>
                    <p>2. 点击「显示详细信息」→「访问此网站」</p>
                    <p>3. 输入设备密码确认，允许摄像头权限</p>
                    <p className="text-gray-400">后续连接无需重复操作。</p>
                  </div>
                </details>
              </>
            )}

            {/* Scanned list */}
            {scannedCount > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">已扫描</span>
                  <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-600">
                    {scannedCount} 本
                  </span>
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                  {scanned.map(entry => (
                    <li key={entry.isbn} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-gray-800">
                      {/* Status icon */}
                      {entry.hasMetadata === undefined && (
                        <span className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      )}
                      {entry.hasMetadata === true && (
                        <span className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      )}
                      {entry.hasMetadata === false && (
                        <span className="w-5 h-5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center flex-shrink-0">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-yellow-600 dark:text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                          </svg>
                        </span>
                      )}
                      <div className="flex-1 min-w-0 flex items-baseline gap-1.5 overflow-hidden">
                        {entry.title && (
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate min-w-0">
                            {entry.title}
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap flex-shrink-0">
                          {entry.isbn}
                        </span>
                      </div>
                      {/* Delete button — only for failed entries */}
                      {entry.hasMetadata === false && onDeleteEntry && (
                        <button
                          type="button"
                          title="从书库移除"
                          onClick={() => {
                            onDeleteEntry(entry.isbn)
                            setScanned(prev => prev.filter(e => e.isbn !== entry.isbn))
                          }}
                          className="flex-shrink-0 p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m19 7-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
