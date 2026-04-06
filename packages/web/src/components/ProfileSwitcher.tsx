// src/components/ProfileSwitcher.tsx
// Dropdown for switching, creating, renaming and deleting reading profiles.
// Dispatches 'tomekeep:profile' on window when the active profile changes so
// Inventory (and any future page) can reload its reading states.

import { useState, useRef, useEffect } from 'react'
import { useLang } from '../lib/i18n.tsx'
import {
  getStoredProfiles,
  getActiveProfile,
  setActiveProfileId,
  syncProfiles,
  createProfile,
  renameProfile,
  deleteProfile,
  type Profile,
} from '../lib/profiles.ts'

export function ProfileSwitcher() {
  const { t } = useLang()

  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>(() => getStoredProfiles())
  const [active, setActive] = useState<Profile | null>(() => getActiveProfile())

  // Inline edit state
  const [newName, setNewName] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [busy, setBusy] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const newInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowNew(false)
        setRenamingId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Sync profiles from server on first open
  useEffect(() => {
    if (!open) return
    syncProfiles()
      .then(ps => {
        setProfiles(ps)
        // If active no longer exists after sync, clear it
        const activeId = getActiveProfile()?.id
        if (activeId && !ps.find(p => p.id === activeId)) {
          setActiveProfileId(null)
          setActive(ps[0] ?? null)
        }
      })
      .catch(() => { /* network failure — use cached list */ })
  }, [open])

  // Focus new-profile input when shown
  useEffect(() => {
    if (showNew) newInputRef.current?.focus()
  }, [showNew])

  // Focus rename input when shown
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus()
  }, [renamingId])

  function dispatchProfileChange() {
    window.dispatchEvent(new CustomEvent('tomekeep:profile'))
  }

  function handleSwitch(profile: Profile) {
    setActiveProfileId(profile.id)
    setActive(profile)
    setOpen(false)
    dispatchProfileChange()
  }

  async function handleCreate() {
    if (!newName.trim() || busy) return
    setBusy(true)
    try {
      const created = await createProfile(newName.trim())
      const updated = getStoredProfiles()
      setProfiles(updated)
      setNewName('')
      setShowNew(false)
      // Auto-switch to newly created profile
      setActiveProfileId(created.id)
      setActive(created)
      dispatchProfileChange()
    } finally {
      setBusy(false)
    }
  }

  async function handleRename(id: string) {
    if (!renameValue.trim() || busy) return
    setBusy(true)
    try {
      await renameProfile(id, renameValue.trim())
      const updated = getStoredProfiles()
      setProfiles(updated)
      if (active?.id === id) setActive(updated.find(p => p.id === id) ?? null)
      setRenamingId(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(profile: Profile) {
    if (!window.confirm(t('profile_delete_confirm', { name: profile.name }))) return
    setBusy(true)
    try {
      await deleteProfile(profile.id)
      const updated = getStoredProfiles()
      setProfiles(updated)
      if (active?.id === profile.id) {
        const next = updated[0] ?? null
        setActive(next)
        setActiveProfileId(next?.id ?? null)
        dispatchProfileChange()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        title={t('profile_switch')}
        className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors px-1"
      >
        {/* Person icon */}
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
        </svg>
        <span className="max-w-[6rem] truncate">{active?.name ?? t('profile_label')}</span>
        <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50 overflow-hidden">
          {/* Existing profiles */}
          {profiles.length > 0 && (
            <ul className="py-1">
              {profiles.map(p => (
                <li key={p.id} className="group flex items-center gap-1 px-2 py-1.5">
                  {renamingId === p.id ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void handleRename(p.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      onBlur={() => setRenamingId(null)}
                      className="flex-1 text-xs px-1.5 py-0.5 rounded border border-blue-400 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  ) : (
                    <button
                      onClick={() => handleSwitch(p)}
                      className={`flex-1 text-left text-xs px-1.5 py-0.5 rounded truncate transition-colors ${
                        active?.id === p.id
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {p.name}
                    </button>
                  )}
                  {renamingId !== p.id && (
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Rename */}
                      <button
                        onClick={() => { setRenamingId(p.id); setRenameValue(p.name) }}
                        title={t('profile_rename')}
                        className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                        </svg>
                      </button>
                      {/* Delete */}
                      <button
                        onClick={() => { void handleDelete(p) }}
                        title={t('profile_delete')}
                        className="p-0.5 rounded text-gray-400 hover:text-red-500"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Divider */}
          {profiles.length > 0 && <div className="border-t border-gray-100 dark:border-gray-700" />}

          {/* New profile */}
          <div className="px-2 py-1.5">
            {showNew ? (
              <div className="flex items-center gap-1">
                <input
                  ref={newInputRef}
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder={t('profile_name_placeholder')}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void handleCreate()
                    if (e.key === 'Escape') { setShowNew(false); setNewName('') }
                  }}
                  className="flex-1 text-xs px-1.5 py-0.5 rounded border border-blue-400 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
                <button
                  onClick={() => { void handleCreate() }}
                  disabled={busy || !newName.trim()}
                  className="text-xs text-blue-500 hover:text-blue-700 disabled:opacity-50"
                >
                  {busy ? t('profile_saving') : '✓'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNew(true)}
                className="w-full text-left text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-400 px-1.5 py-0.5 flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {t('profile_new')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
