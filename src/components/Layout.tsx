import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { WeatherIcon } from './WeatherIcon'
import { applyTheme, cycleTheme, getStoredTheme, setStoredTheme } from '../lib/theme'
import type { ThemeMode } from '../lib/theme'

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
  // Circle split half-sun half-moon
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="4" />
      <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}

function ThemeLightIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="4" />
      <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}

function ThemeDarkIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
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
      <span className="
        pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md text-xs whitespace-nowrap z-50
        bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900
        opacity-0 group-hover:opacity-100 transition-opacity duration-150
      ">
        {label}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Layout() {
  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme)

  // Keep DOM in sync with theme state and watch system pref changes
  useEffect(() => {
    applyTheme(theme)

    if (theme !== 'auto') return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('auto')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

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
    theme === 'light' ? 'Theme: Light' :
    theme === 'dark'  ? 'Theme: Dark'  :
                        'Theme: Auto'

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center justify-center w-10 h-10 rounded-xl transition-colors ${
      isActive
        ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
        : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50'
    }`

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      {/* Narrow icon-only sidebar */}
      <aside className="w-16 bg-white dark:bg-gray-800 shadow-md flex flex-col items-center py-3 gap-1 border-r border-gray-100 dark:border-gray-700 flex-shrink-0">
        {/* Logo + weather */}
        <div className="flex flex-col items-center gap-1 mb-2">
          <Tip label="TomeKeep">
            <span className="text-sm font-bold text-gray-700 dark:text-gray-200 select-none">TK</span>
          </Tip>
          <WeatherIcon className="w-7 h-7" />
        </div>

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
