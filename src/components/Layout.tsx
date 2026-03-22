import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { WeatherIcon } from './WeatherIcon'
import { applyTheme, cycleTheme, getStoredTheme, setStoredTheme } from '../lib/theme'
import type { ThemeMode } from '../lib/theme'
import { fetchWeather } from '../lib/weather'
import type { WeatherState } from '../lib/weather'

// ---------------------------------------------------------------------------
// SVG icons
// ---------------------------------------------------------------------------

function BookshelfIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  )
}

function StarIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5z" />
    </svg>
  )
}

function ThemeAutoIcon() {
  // Half-filled circle: represents system/auto
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M12 2v20" strokeLinecap="round" />
      <path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" />
      <circle cx="12" cy="12" r="10" />
    </svg>
  )
}

function ThemeLightIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}

function ThemeDarkIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Tooltip wrapper
// ---------------------------------------------------------------------------

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative group flex items-center justify-center">
      {children}
      <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md text-xs whitespace-nowrap z-50 bg-gray-800 text-white dark:bg-gray-100 dark:text-gray-900 opacity-0 group-hover:opacity-100 transition-opacity duration-100 delay-0">
        {label}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Combined logo: book-stack SVG + animated weather badge at bottom-right
// ---------------------------------------------------------------------------

function LogoBadge({ weather }: { weather: WeatherState | null }) {
  const tipLabel = weather
    ? `TomeKeep · ${weather.condition.replace(/-/g, ' ')}${weather.isDay ? '' : ' · night'}`
    : 'TomeKeep'

  return (
    <Tip label={tipLabel}>
      <div className="relative w-10 h-10 flex items-center justify-center select-none">
        {/* Book-stack SVG — the app logo body */}
        <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-10 h-10">
          {/* Back book (blue) */}
          <rect x="8" y="10" width="17" height="22" rx="2" fill="#93C5FD" stroke="#3B82F6" strokeWidth="1" />
          {/* Middle book (amber) */}
          <rect x="12" y="7" width="17" height="22" rx="2" fill="#FDE68A" stroke="#F59E0B" strokeWidth="1" />
          {/* Front book (white/light) */}
          <rect x="15" y="4" width="16" height="24" rx="2" fill="#F9FAFB" stroke="#9CA3AF" strokeWidth="1" />
          {/* Text lines on front book */}
          <line x1="18" y1="10" x2="28" y2="10" stroke="#D1D5DB" strokeWidth="1" strokeLinecap="round" />
          <line x1="18" y1="13" x2="28" y2="13" stroke="#D1D5DB" strokeWidth="1" strokeLinecap="round" />
          <line x1="18" y1="16" x2="25" y2="16" stroke="#D1D5DB" strokeWidth="1" strokeLinecap="round" />
          {/* TK monogram */}
          <text x="23" y="26" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#374151" fontFamily="system-ui,sans-serif">TK</text>
        </svg>

        {/* Weather badge pinned to bottom-right of the logo — only shown once loaded */}
        {weather && (
          <div className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-600 flex items-center justify-center overflow-visible">
            <WeatherIcon className="w-[14px] h-[14px]" />
          </div>
        )}
      </div>
    </Tip>
  )
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Layout() {
  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme)
  const [weather, setWeather] = useState<WeatherState | null>(null)

  // Keep DOM in sync with theme state, and watch system pref when in auto mode
  useEffect(() => {
    applyTheme(theme)

    if (theme !== 'auto') return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('auto')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  // Fetch weather once on mount; silently ignore if geolocation denied / offline
  useEffect(() => {
    fetchWeather().then(setWeather).catch(() => undefined)
  }, [])

  function handleThemeCycle() {
    const next = cycleTheme(theme)
    setStoredTheme(next)
    setTheme(next)
  }

  const themeIcon =
    theme === 'light' ? <ThemeLightIcon /> :
    theme === 'dark'  ? <ThemeDarkIcon />  :
                        <ThemeAutoIcon />

  const themeLabel =
    theme === 'light' ? 'Light — click for Dark' :
    theme === 'dark'  ? 'Dark — click for Auto'  :
                        'Auto — click for Light'

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center justify-center w-10 h-10 rounded-xl transition-colors ${
      isActive
        ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
        : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50'
    }`

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      {/* Narrow icon-only sidebar */}
      <aside className="w-16 bg-white dark:bg-gray-800 shadow-md flex flex-col items-center py-4 gap-1 border-r border-gray-100 dark:border-gray-700 flex-shrink-0">

        {/* Combined logo + weather badge */}
        <LogoBadge weather={weather} />

        <div className="my-2 w-8 border-t border-gray-100 dark:border-gray-700" />

        {/* Nav links */}
        <nav className="flex flex-col items-center gap-2 flex-1">
          <Tip label="Inventory">
            <NavLink to="/" end className={navLinkClass}>
              <BookshelfIcon />
            </NavLink>
          </Tip>
          <Tip label="Wishlist">
            <NavLink to="/wishlist" className={navLinkClass}>
              <StarIcon />
            </NavLink>
          </Tip>
        </nav>

        {/* Theme toggle at bottom */}
        <Tip label={themeLabel}>
          <button
            type="button"
            onClick={handleThemeCycle}
            className="flex items-center justify-center w-10 h-10 rounded-xl text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50 transition-colors"
          >
            {themeIcon}
          </button>
        </Tip>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8 bg-gray-50 dark:bg-gray-900">
        <Outlet />
      </main>
    </div>
  )
}
