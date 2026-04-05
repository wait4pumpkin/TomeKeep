// src/components/AdminLayout.tsx
// Independent admin shell — no library/wishlist tabs.
// Logout redirects to /admin/login; theme toggle uses desktop-style icons.

import { Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useLang } from '../lib/i18n.tsx'
import { getStoredAdmin, clearStoredAdmin } from '../lib/auth.ts'
import { api } from '../lib/api.ts'
import { getStoredTheme, setStoredTheme, applyTheme, cycleTheme, type ThemeMode } from '@tomekeep/shared'

// Desktop-style theme icons — all w-4 h-4 to match the logout icon
function ThemeLightIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}

function ThemeDarkIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
    </svg>
  )
}

function ThemeAutoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M12 2v20" strokeLinecap="round" />
      <path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" />
      <circle cx="12" cy="12" r="10" />
    </svg>
  )
}

export function AdminLayout() {
  const { lang, t, setLang } = useLang()
  const navigate = useNavigate()
  const user = getStoredAdmin()
  const [themeKey, setThemeKey] = useState<ThemeMode>(getStoredTheme)

  // Apply theme whenever themeKey changes (also runs on mount)
  useEffect(() => {
    applyTheme(themeKey)
  }, [themeKey])

  async function handleLogout() {
    try { await api.post('/auth/logout', {}) } catch { /* ignore */ }
    clearStoredAdmin()
    navigate('/admin/login', { replace: true })
  }

  function handleThemeCycle() {
    const next = cycleTheme(themeKey)
    setStoredTheme(next)
    setThemeKey(next)
  }

  const themeLabel = themeKey === 'light' ? t('theme_light') : themeKey === 'dark' ? t('theme_dark') : t('theme_auto')

  // Shared icon-button class — keeps all three buttons the same visual weight
  const iconBtn = 'p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 transition-colors'

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Top bar */}
      <header
        className="flex-shrink-0 flex items-center justify-between px-4 h-12 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
        style={{ paddingTop: 'var(--sat, 0)' }}
      >
        {/* Left: brand + admin badge */}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">TomeKeep</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium select-none">
            {t('page_admin')}
          </span>
        </div>

        {/* Right: lang · theme · logout  (all same size) */}
        <div className="flex items-center gap-1">
          {/* Language toggle — wrapped in same-size button */}
          <button
            onClick={() => { void setLang(lang === 'zh' ? 'en' : 'zh') }}
            title={t('lang_toggle')}
            className={`${iconBtn} text-xs font-semibold w-7 h-7 flex items-center justify-center`}
          >
            {lang === 'zh' ? 'EN' : '中'}
          </button>

          {/* Theme toggle */}
          <button
            onClick={handleThemeCycle}
            title={themeLabel}
            className={iconBtn}
          >
            {themeKey === 'light' && <ThemeLightIcon />}
            {themeKey === 'dark' && <ThemeDarkIcon />}
            {themeKey === 'auto' && <ThemeAutoIcon />}
          </button>

          {/* Logout */}
          {user && (
            <button
              onClick={() => { void handleLogout() }}
              title={t('admin_logout')}
              className={`${iconBtn} hover:!text-red-500 dark:hover:!text-red-400`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
