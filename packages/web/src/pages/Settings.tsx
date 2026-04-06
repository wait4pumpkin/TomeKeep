// src/pages/Settings.tsx
// Settings page: theme, language, profile management, logout.

import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLang } from '../lib/i18n.tsx'
import { getStoredUser, clearStoredUser } from '../lib/auth.ts'
import { api } from '../lib/api.ts'
import { clearCache } from '../lib/db-cache.ts'
import { clearProfiles, getActiveProfile, renameProfile } from '../lib/profiles.ts'
import { getStoredTheme, setStoredTheme, applyTheme, cycleTheme } from '@tomekeep/shared'
import { ProfileSwitcher } from '../components/ProfileSwitcher.tsx'

export function Settings() {
  const { lang, t, setLang } = useLang()
  const navigate = useNavigate()
  const user = getStoredUser()
  const [themeKey, setThemeKey] = useState(() => getStoredTheme())

  // Profile rename state
  const [activeProfile, setActiveProfile] = useState(() => getActiveProfile())
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus()
  }, [renaming])

  // Keep activeProfile in sync when ProfileSwitcher changes it
  useEffect(() => {
    function onProfileChange() {
      setActiveProfile(getActiveProfile())
    }
    window.addEventListener('tomekeep:profile', onProfileChange)
    return () => window.removeEventListener('tomekeep:profile', onProfileChange)
  }, [])

  function startRename() {
    setRenameValue(activeProfile?.name ?? '')
    setRenaming(true)
  }

  async function commitRename() {
    if (!activeProfile || !renameValue.trim() || renameBusy) {
      setRenaming(false)
      return
    }
    if (renameValue.trim() === activeProfile.name) {
      setRenaming(false)
      return
    }
    setRenameBusy(true)
    try {
      await renameProfile(activeProfile.id, renameValue.trim())
      setActiveProfile(getActiveProfile())
      // Notify other components that profile data changed
      window.dispatchEvent(new CustomEvent('tomekeep:profile'))
    } finally {
      setRenameBusy(false)
      setRenaming(false)
    }
  }

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

  const themeIcon = (
    themeKey === 'light' ? (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
      </svg>
    ) : themeKey === 'dark' ? (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
      </svg>
    ) : (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" d="M12 2v20" />
        <path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="10" />
      </svg>
    )
  )

  return (
    <div className="px-4 pt-5 pb-8 space-y-6">
      {/* Page title */}
      <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">
        {t('settings_title')}
      </h1>

      {/* Account section */}
      {user && (
        <section className="space-y-1">
          <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide px-1">
            {t('profile_label')}
          </p>
          <div className="bg-white dark:bg-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700">

            {/* Logged-in user + logout — first row */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-gray-500 dark:text-gray-400 truncate">{user.name}</span>
              <button
                onClick={() => { void handleLogout() }}
                className="text-sm text-red-500 hover:text-red-600 transition-colors flex-shrink-0 ml-3"
              >
                {t('sync_logout')}
              </button>
            </div>

            {/* Active profile rename + switcher — second row */}
            <div className="flex items-center justify-between px-4 py-3 gap-3">
              {/* Inline rename */}
              {renaming ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void commitRename()
                    if (e.key === 'Escape') setRenaming(false)
                  }}
                  onBlur={() => { void commitRename() }}
                  disabled={renameBusy}
                  className="flex-1 min-w-0 text-sm px-2 py-0.5 rounded border border-blue-400 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              ) : (
                <button
                  onClick={startRename}
                  title={t('profile_rename')}
                  className="flex-1 min-w-0 text-left text-sm text-gray-700 dark:text-gray-300 truncate hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  {activeProfile?.name ?? t('profile_label')}
                </button>
              )}
              {/* Profile switcher dropdown */}
              <ProfileSwitcher />
            </div>
          </div>
        </section>
      )}

      {/* Appearance section */}
      <section className="space-y-1">
        <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide px-1">
          {lang === 'zh' ? '外观' : 'Appearance'}
        </p>
        <div className="bg-white dark:bg-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700">
          {/* Theme */}
          <button
            onClick={handleThemeCycle}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-gray-500 dark:text-gray-400">{themeIcon}</span>
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {lang === 'zh' ? '主题' : 'Theme'}
              </span>
            </div>
            <span className="text-sm text-gray-400 dark:text-gray-500">
              {themeKey === 'light'
                ? (lang === 'zh' ? '浅色' : 'Light')
                : themeKey === 'dark'
                  ? (lang === 'zh' ? '深色' : 'Dark')
                  : (lang === 'zh' ? '自动' : 'Auto')}
            </span>
          </button>

          {/* Language */}
          <button
            onClick={() => { void setLang(lang === 'zh' ? 'en' : 'zh') }}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802" />
              </svg>
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {lang === 'zh' ? '语言' : 'Language'}
              </span>
            </div>
            <span className="text-sm text-gray-400 dark:text-gray-500">
              {lang === 'zh' ? '中文' : 'English'}
            </span>
          </button>
        </div>
      </section>
    </div>
  )
}
