// src/components/Layout.tsx
// Main shell: bottom tab bar (mobile) + sidebar (desktop), theme toggle, sync.

import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useCallback, useState } from 'react'
import { useLang } from '../lib/i18n.tsx'
import { getStoredUser, clearStoredUser } from '../lib/auth.ts'
import { api } from '../lib/api.ts'
import { clearCache } from '../lib/db-cache.ts'
import { runSync, setupVisibilitySyncListener } from '../lib/sync.ts'
import { InstallPrompt } from './InstallPrompt.tsx'
import { ProfileSwitcher } from './ProfileSwitcher.tsx'
import { clearProfiles } from '../lib/profiles.ts'
import { getStoredTheme, setStoredTheme, applyTheme, cycleTheme } from '@tomekeep/shared'
import { syncProfiles, getActiveProfile } from '../lib/profiles.ts'

export function Layout() {
  const { lang, t, setLang } = useLang()
  const navigate = useNavigate()
  const user = getStoredUser()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState(false)
  const [themeKey, setThemeKey] = useState(() => getStoredTheme())

  // Apply theme on mount
  useEffect(() => {
    applyTheme(getStoredTheme())
    // Re-apply when the OS dark/light preference changes (only matters in auto mode)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function onSystemThemeChange() {
      applyTheme(getStoredTheme())
    }
    mq.addEventListener('change', onSystemThemeChange)
    return () => mq.removeEventListener('change', onSystemThemeChange)
  }, [])

  // Initial sync on mount
  useEffect(() => {
    const profileBefore = getActiveProfile()?.id ?? null
    setSyncing(true)
    // Sync profiles first so ProfileSwitcher and Inventory have the right active profile
    syncProfiles()
      .then(profiles => {
        // If we now have a profile that wasn't set before, notify pages to reload
        const profileAfter = profiles.length > 0
          ? (profiles.find(p => p.id === profileBefore) ? profileBefore : profiles[0]?.id ?? null)
          : null
        if (profileAfter !== profileBefore) {
          window.dispatchEvent(new CustomEvent('tomekeep:profile'))
        }
      })
      .catch(() => { /* offline — use cached profiles */ })
    runSync()
      .then(updated => {
        setSyncing(false)
        setSyncError(false)
        if (updated) window.dispatchEvent(new CustomEvent('tomekeep:sync'))
      })
      .catch(() => { setSyncing(false); setSyncError(true) })
  }, [])

  // Visibility-based background sync
  const handleVisibilitySync = useCallback(() => {
    setSyncing(true)
    runSync()
      .then(updated => {
        setSyncing(false)
        setSyncError(false)
        if (updated) window.dispatchEvent(new CustomEvent('tomekeep:sync'))
      })
      .catch(() => { setSyncing(false); setSyncError(true) })
  }, [])

  useEffect(() => {
    return setupVisibilitySyncListener(handleVisibilitySync)
  }, [handleVisibilitySync])

  async function handleLogout() {
    try { await api.post('/auth/logout', {}) } catch { /* ignore */ }
    clearStoredUser()
    clearProfiles()
    await clearCache()
    navigate('/login', { replace: true })
  }

  function handleThemeCycle() {
    const next = cycleTheme(getStoredTheme())
    setStoredTheme(next)
    applyTheme(next)
    setThemeKey(next)
  }

  const themeLabel = themeKey === 'light' ? t('theme_light') : themeKey === 'dark' ? t('theme_dark') : t('theme_auto')

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Top bar */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 h-12 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
        style={{ paddingTop: 'var(--sat, 0)' }}
      >
        <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">TomeKeep</span>

        <div className="flex items-center gap-3">
          {/* Sync indicator */}
          {syncing && (
            <svg className="w-4 h-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          {syncError && !syncing && (
            <svg className="w-4 h-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          )}

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
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* Bottom tab bar */}
      <nav
        className="flex-shrink-0 flex border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
        style={{ paddingBottom: 'var(--sab, 0)' }}
      >
        <NavLink
          to="/"
          end
          className={({ isActive }: { isActive: boolean }) =>
            `flex-1 flex flex-col items-center justify-center py-2 text-xs gap-0.5 transition-colors ${
              isActive
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400'
            }`
          }
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
          </svg>
          <span>{t('nav_library')}</span>
        </NavLink>

        <NavLink
          to="/wishlist"
          className={({ isActive }: { isActive: boolean }) =>
            `flex-1 flex flex-col items-center justify-center py-2 text-xs gap-0.5 transition-colors ${
              isActive
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400'
            }`
          }
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
          </svg>
          <span>{t('nav_wishlist')}</span>
        </NavLink>
      </nav>

      {/* iOS install prompt */}
      <InstallPrompt />
    </div>
  )
}
