// src/pages/Settings.tsx
// Settings page: theme, language, profile management, logout.

import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLang } from '../lib/i18n.tsx'
import { getStoredUser, clearStoredUser } from '../lib/auth.ts'
import { api } from '../lib/api.ts'
import { clearCache } from '../lib/db-cache.ts'
import {
  clearProfiles,
  getActiveProfile,
  getStoredProfiles,
  setActiveProfileId,
  syncProfiles,
  createProfile,
  renameProfile,
  deleteProfile,
  type Profile,
} from '../lib/profiles.ts'
import { getStoredTheme, setStoredTheme, applyTheme, cycleTheme } from '@tomekeep/shared'

export function Settings() {
  const { lang, t, setLang } = useLang()
  const navigate = useNavigate()
  const user = getStoredUser()
  const [themeKey, setThemeKey] = useState(() => getStoredTheme())

  // ── Profile panel state ────────────────────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>(() => getStoredProfiles())
  const [activeProfile, setActiveProfile] = useState<Profile | null>(() => getActiveProfile())

  // Rename existing profile
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Create new profile
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const newInputRef = useRef<HTMLInputElement>(null)

  const panelRef = useRef<HTMLDivElement>(null)

  // Close panel on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closePanel()
      }
    }
    if (panelOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [panelOpen])

  // Sync profiles from server when panel opens
  useEffect(() => {
    if (!panelOpen) return
    syncProfiles()
      .then(ps => {
        setProfiles(ps)
        const cur = getActiveProfile()
        setActiveProfile(cur)
      })
      .catch(() => { /* use cached */ })
  }, [panelOpen])

  // Focus rename input
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus()
  }, [renamingId])

  // Focus new-profile input
  useEffect(() => {
    if (showNew) newInputRef.current?.focus()
  }, [showNew])

  // Keep activeProfile in sync with external changes (e.g. Inventory)
  useEffect(() => {
    function onProfileChange() {
      setActiveProfile(getActiveProfile())
      setProfiles(getStoredProfiles())
    }
    window.addEventListener('tomekeep:profile', onProfileChange)
    return () => window.removeEventListener('tomekeep:profile', onProfileChange)
  }, [])

  function dispatchProfileChange() {
    window.dispatchEvent(new CustomEvent('tomekeep:profile'))
  }

  function closePanel() {
    setPanelOpen(false)
    setRenamingId(null)
    setShowNew(false)
    setNewName('')
    setCreateError(null)
  }

  function handleSwitch(p: Profile) {
    setActiveProfileId(p.id)
    setActiveProfile(p)
    dispatchProfileChange()
    closePanel()
  }

  async function handleRename(id: string) {
    if (!renameValue.trim() || renameBusy) { setRenamingId(null); return }
    const original = profiles.find(p => p.id === id)?.name
    if (renameValue.trim() === original) { setRenamingId(null); return }
    setRenameBusy(true)
    try {
      await renameProfile(id, renameValue.trim())
      const updated = getStoredProfiles()
      setProfiles(updated)
      if (activeProfile?.id === id) {
        const next = updated.find(p => p.id === id) ?? null
        setActiveProfile(next)
        dispatchProfileChange()
      }
    } finally {
      setRenameBusy(false)
      setRenamingId(null)
    }
  }

  async function handleCreate() {
    if (!newName.trim() || createBusy) return
    setCreateBusy(true)
    setCreateError(null)
    try {
      const created = await createProfile(newName.trim())
      const updated = getStoredProfiles()
      setProfiles(updated)
      setActiveProfileId(created.id)
      setActiveProfile(created)
      dispatchProfileChange()
      setShowNew(false)
      setNewName('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setCreateError(msg === 'profile_limit_reached' ? t('profile_limit_reached') : msg)
    } finally {
      setCreateBusy(false)
    }
  }

  async function handleDelete(p: Profile) {
    if (!window.confirm(t('profile_delete_confirm', { name: p.name }))) return
    try {
      await deleteProfile(p.id)
      const updated = getStoredProfiles()
      setProfiles(updated)
      if (activeProfile?.id === p.id) {
        const next = updated[0] ?? null
        setActiveProfile(next)
        setActiveProfileId(next?.id ?? null)
        dispatchProfileChange()
      }
    } catch { /* ignore */ }
  }

  // ── Theme ─────────────────────────────────────────────────────────────────
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

            {/* Logged-in user + logout */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-gray-500 dark:text-gray-400 truncate">{user.name}</span>
              <button
                onClick={() => { void handleLogout() }}
                className="text-sm text-red-500 hover:text-red-600 transition-colors flex-shrink-0 ml-3"
              >
                {t('sync_logout')}
              </button>
            </div>

            {/* Profile row — full-width dropdown trigger */}
            <div ref={panelRef} className="relative">
              <button
                onClick={() => setPanelOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                  </svg>
                  <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                    {activeProfile?.name ?? t('profile_label')}
                  </span>
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${panelOpen ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown panel */}
              {panelOpen && (
                <div className="border-t border-gray-100 dark:border-gray-700">
                  {/* Profile list */}
                  <ul className="py-1">
                    {profiles.map(p => (
                      <li key={p.id} className="group flex items-center gap-1 px-3 py-1.5">
                        {renamingId === p.id ? (
                          /* Rename input */
                          <input
                            ref={renameInputRef}
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') void handleRename(p.id)
                              if (e.key === 'Escape') setRenamingId(null)
                            }}
                            onBlur={() => { void handleRename(p.id) }}
                            disabled={renameBusy}
                            className="flex-1 text-sm px-2 py-0.5 rounded border border-blue-400 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          />
                        ) : (
                          /* Switch button */
                          <button
                            onClick={() => handleSwitch(p)}
                            className={`flex-1 text-left text-sm px-2 py-0.5 rounded truncate transition-colors ${
                              activeProfile?.id === p.id
                                ? 'text-blue-600 dark:text-blue-400 font-medium'
                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                          >
                            {p.name}
                          </button>
                        )}

                        {/* Rename + delete icons — always visible on touch, hover on pointer */}
                        {renamingId !== p.id && (
                          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={e => { e.stopPropagation(); setRenamingId(p.id); setRenameValue(p.name) }}
                              title={t('profile_rename')}
                              className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                              </svg>
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); void handleDelete(p) }}
                              title={t('profile_delete')}
                              className="p-1 rounded text-gray-400 hover:text-red-500"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>

                  {/* New profile row */}
                  <div className="border-t border-gray-100 dark:border-gray-700 px-3 py-2">
                    {profiles.length >= 5 ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500 px-2 py-0.5">
                        {t('profile_limit_reached')}
                      </p>
                    ) : showNew ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                          <input
                            ref={newInputRef}
                            value={newName}
                            onChange={e => { setNewName(e.target.value); setCreateError(null) }}
                            placeholder={t('profile_name_placeholder')}
                            onKeyDown={e => {
                              if (e.key === 'Enter') void handleCreate()
                              if (e.key === 'Escape') { setShowNew(false); setNewName(''); setCreateError(null) }
                            }}
                            className="flex-1 text-sm px-2 py-0.5 rounded border border-blue-400 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          />
                          <button
                            onClick={() => { void handleCreate() }}
                            disabled={createBusy || !newName.trim()}
                            className="text-sm text-blue-500 hover:text-blue-700 disabled:opacity-40 px-1"
                          >
                            {createBusy ? t('profile_saving') : '✓'}
                          </button>
                          <button
                            onClick={() => { setShowNew(false); setNewName(''); setCreateError(null) }}
                            className="text-sm text-gray-400 hover:text-gray-600 px-1"
                          >
                            ✕
                          </button>
                        </div>
                        {createError && (
                          <p className="text-xs text-red-500 px-2">{createError}</p>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowNew(true)}
                        className="flex items-center gap-1.5 text-sm text-blue-500 hover:text-blue-700 dark:hover:text-blue-400 px-2 py-0.5"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        {t('profile_new')}
                      </button>
                    )}
                  </div>
                </div>
              )}
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
