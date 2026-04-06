// components/SettingsBar.tsx
// In-page settings row: theme toggle, language toggle, profile switcher, logout.
// Rendered inside each page's sticky header when settingsOpen === true.

import { useLang } from '../lib/i18n.tsx'
import { getStoredUser, clearStoredUser } from '../lib/auth.ts'
import { api } from '../lib/api.ts'
import { clearCache } from '../lib/db-cache.ts'
import { clearProfiles } from '../lib/profiles.ts'
import { getStoredTheme, setStoredTheme, applyTheme, cycleTheme } from '@tomekeep/shared'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ProfileSwitcher } from './ProfileSwitcher.tsx'

export function SettingsBar() {
  const { lang, t, setLang } = useLang()
  const navigate = useNavigate()
  const user = getStoredUser()
  const [themeKey, setThemeKey] = useState(() => getStoredTheme())

  function handleThemeCycle() {
    const next = cycleTheme(getStoredTheme())
    setStoredTheme(next)
    applyTheme(next)
    setThemeKey(next)
  }

  async function handleLogout() {
    try { await api.post('/auth/logout', {}) } catch { /* ignore */ }
    clearStoredUser()
    clearProfiles()
    await clearCache()
    navigate('/login', { replace: true })
  }

  const themeLabel =
    themeKey === 'light' ? t('theme_light') :
    themeKey === 'dark'  ? t('theme_dark')  : t('theme_auto')

  return (
    <div className="flex items-center gap-3">
      {/* Theme toggle */}
      <button
        onClick={handleThemeCycle}
        title={themeLabel}
        className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        {themeKey === 'light' && (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
          </svg>
        )}
        {themeKey === 'dark' && (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
          </svg>
        )}
        {themeKey === 'auto' && (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M12 2v20" />
            <path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="10" />
          </svg>
        )}
      </button>

      {/* Language toggle */}
      <button
        onClick={() => { void setLang(lang === 'zh' ? 'en' : 'zh') }}
        title={t('lang_toggle')}
        className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
      >
        {lang === 'zh' ? 'EN' : '中'}
      </button>

      {/* Profile switcher */}
      {user && <ProfileSwitcher />}

      {/* User + logout */}
      {user && (
        <button
          onClick={() => { void handleLogout() }}
          title={`${user.name} — 退出登录`}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 transition-colors"
        >
          {user.name}
        </button>
      )}
    </div>
  )
}
