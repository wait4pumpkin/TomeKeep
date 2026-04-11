// src/components/Layout.tsx
// Main shell: bottom tab bar, sync management.

import { Outlet, NavLink } from 'react-router-dom'
import { useEffect, useCallback, useState } from 'react'
import { runSync, setupVisibilitySyncListener } from '../lib/sync.ts'
import { InstallPrompt } from './InstallPrompt.tsx'
import { getStoredTheme, applyTheme } from '@tomekeep/shared'
import { syncProfiles, getActiveProfile, syncAndActivateProfile } from '../lib/profiles.ts'
import { getSyncCursors, setSyncCursors } from '../lib/db-cache.ts'

export function Layout() {
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState(false)

  // Apply theme on mount
  useEffect(() => {
    applyTheme(getStoredTheme())
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function onSystemThemeChange() { applyTheme(getStoredTheme()) }
    mq.addEventListener('change', onSystemThemeChange)
    return () => mq.removeEventListener('change', onSystemThemeChange)
  }, [])

  // Initial sync on mount
  useEffect(() => {
    setSyncing(true)
    void (async () => {
        try {
          const profileBefore = getActiveProfile()?.id ?? null
          let profileChanged = false
          try {
            const profiles = await syncProfiles()
            const profileAfter = profiles.length > 0
              ? (profiles.find(p => p.id === profileBefore) ? profileBefore : profiles[0]?.id ?? null)
              : null
            const cursors = await getSyncCursors()
            cursors.readingStates = null
            await setSyncCursors(cursors)
            profileChanged = profileAfter !== profileBefore
          } catch { /* offline — use cached profiles */ }

          // Ensure an active profile is set (handles accounts without profiles on load)
          await syncAndActivateProfile().catch(() => { /* best-effort */ })

        const updated = await runSync()
        setSyncing(false)
        setSyncError(false)
        if (updated) window.dispatchEvent(new CustomEvent('tomekeep:sync'))
        if (profileChanged) window.dispatchEvent(new CustomEvent('tomekeep:profile'))
      } catch {
        setSyncing(false)
        setSyncError(true)
      }
    })()
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

  return (
    <div className="flex flex-col h-dvh bg-gray-50 dark:bg-gray-900"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* Sync indicators — floating top-right, only when active */}
      {(syncing || syncError) && (
        <div className="fixed top-2 right-3 z-50 flex items-center gap-1"
          style={{ top: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
        >
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
        </div>
      )}

      {/* Page content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* Bottom tab bar */}
      <nav
        className="flex-shrink-0 flex flex-col border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex h-11">
          {/* Library */}
          <NavLink to="/" end className="flex-1 flex items-center justify-center">
            {({ isActive }: { isActive: boolean }) => (
              <span className={`flex items-center justify-center w-12 h-8 rounded-full transition-colors duration-200 ${
                isActive ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'
              }`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                </svg>
              </span>
            )}
          </NavLink>

          {/* Wishlist */}
          <NavLink to="/wishlist" className="flex-1 flex items-center justify-center">
            {({ isActive }: { isActive: boolean }) => (
              <span className={`flex items-center justify-center w-12 h-8 rounded-full transition-colors duration-200 ${
                isActive ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'
              }`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
                </svg>
              </span>
            )}
          </NavLink>

          {/* Settings */}
          <NavLink to="/settings" className="flex-1 flex items-center justify-center">
            {({ isActive }: { isActive: boolean }) => (
              <span className={`flex items-center justify-center w-12 h-8 rounded-full transition-colors duration-200 ${
                isActive ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'
              }`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              </span>
            )}
          </NavLink>
        </div>
      </nav>

      {/* iOS install prompt */}
      <InstallPrompt />
    </div>
  )
}
