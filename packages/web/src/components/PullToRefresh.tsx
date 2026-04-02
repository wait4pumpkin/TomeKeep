// src/components/PullToRefresh.tsx
// Touch-based pull-to-refresh for mobile.
// Wraps children; on pull down > threshold, triggers onRefresh().

import { useRef, useState, type ReactNode } from 'react'

interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: ReactNode
  disabled?: boolean
}

const THRESHOLD = 64 // px needed to trigger refresh

export function PullToRefresh({ onRefresh, children, disabled }: PullToRefreshProps) {
  const [pullY, setPullY] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  function onTouchStart(e: React.TouchEvent) {
    if (disabled || refreshing) return
    const el = scrollRef.current
    if (!el || el.scrollTop > 0) return
    startY.current = e.touches[0].clientY
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startY.current === null || disabled || refreshing) return
    const delta = e.touches[0].clientY - startY.current
    if (delta <= 0) { startY.current = null; return }
    setPullY(Math.min(delta, THRESHOLD * 1.5))
  }

  async function onTouchEnd() {
    if (startY.current === null) return
    const triggered = pullY >= THRESHOLD
    startY.current = null
    setPullY(0)
    if (triggered) {
      setRefreshing(true)
      try { await onRefresh() } finally { setRefreshing(false) }
    }
  }

  const indicatorOpacity = Math.min(pullY / THRESHOLD, 1)

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={() => { void onTouchEnd() }}
    >
      {/* Pull indicator */}
      <div
        className="flex justify-center items-center overflow-hidden transition-[height] duration-200"
        style={{ height: pullY > 0 || refreshing ? Math.max(pullY, refreshing ? 40 : 0) : 0 }}
      >
        <svg
          className={`w-5 h-5 text-blue-500 ${refreshing ? 'animate-spin' : ''}`}
          style={{ opacity: refreshing ? 1 : indicatorOpacity }}
          fill="none" viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      </div>

      {children}
    </div>
  )
}
