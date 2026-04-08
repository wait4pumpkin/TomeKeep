import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { DynamicBrandIcon } from './DynamicBrandIcon'
import { applyTheme, cycleTheme, getStoredTheme, setStoredTheme } from '../lib/theme'
import type { ThemeMode } from '../lib/theme'
import { fetchWeather } from '../lib/weather'
import type { WeatherData } from '../lib/weather'
import type { UserProfile } from '../../electron/db'
import { useLang } from '../lib/i18n'

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

function SettingsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  )
}

function ThemeAutoIcon() {
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

function PersonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
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

function LogoBadge() {
  return (
    <Tip label="TomeKeep">
      <div className="relative w-16 h-16 flex items-center justify-center select-none">
        <DynamicBrandIcon size={64} />
      </div>
    </Tip>
  )
}

// ---------------------------------------------------------------------------
// UserSwitcher — always rendered; always ≥ 1 user (default created on startup)
// ---------------------------------------------------------------------------

function UserSwitcher() {
  const { t } = useLang()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [activeUser, setActiveUser] = useState<UserProfile | null>(null)
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  // Inline rename: stores the id being renamed and the draft name
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  async function load() {
    const [us, active] = await Promise.all([window.db.getUsers(), window.db.getActiveUser()])
    setUsers(us)
    setActiveUser(active)
  }

  useEffect(() => { void load() }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
        setRenamingId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function handleSwitch(user: UserProfile) {
    await window.db.setActiveUser(user.id)
    setActiveUser(user)
    setOpen(false)
    window.dispatchEvent(new CustomEvent('active-user-changed', { detail: user }))
  }

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return
    const user = await window.db.addUser(name)
    setNewName('')
    await load()
    await handleSwitch(user)
  }

  function startRename(user: UserProfile, e: React.MouseEvent) {
    e.stopPropagation()
    setRenamingId(user.id)
    setRenameDraft(user.name)
  }

  async function commitRename(id: string) {
    const name = renameDraft.trim()
    if (name) {
      const updated = await window.db.renameUser(id, name)
      if (updated) {
        setUsers(prev => prev.map(u => u.id === id ? updated : u))
        if (activeUser?.id === id) {
          setActiveUser(updated)
          window.dispatchEvent(new CustomEvent('active-user-changed', { detail: updated }))
        }
      }
    }
    setRenamingId(null)
  }

  async function handleDelete(user: UserProfile, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(t('delete_user_confirm', { name: user.name }))) return
    const ok = await window.db.deleteUser(user.id)
    if (!ok) return   // server rejected (last user)
    const [us, active] = await Promise.all([window.db.getUsers(), window.db.getActiveUser()])
    setUsers(us)
    setActiveUser(active)
    window.dispatchEvent(new CustomEvent('active-user-changed', { detail: active }))
  }

  return (
    <div ref={panelRef} className="relative flex items-center justify-center">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setRenamingId(null) }}
        title={activeUser ? t('user_tooltip', { name: activeUser.name }) : t('user_label')}
        className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
          open
            ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
            : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50'
        }`}
      >
        <PersonIcon />
      </button>

      {open && (
        <div className="absolute left-full bottom-0 ml-2 w-52 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl z-50 overflow-hidden">
          <ul className="max-h-52 overflow-y-auto py-1">
            {users.map(u => (
              <li key={u.id}>
                {renamingId === u.id ? (
                  // Inline rename input
                  <div className="flex items-center gap-1.5 px-3 py-1.5">
                    <input
                      type="text"
                      value={renameDraft}
                      autoFocus
                      onChange={e => setRenameDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void commitRename(u.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      onBlur={() => void commitRename(u.id)}
                      className="flex-1 min-w-0 px-2 py-0.5 text-xs rounded-md border border-blue-400 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                ) : (
                  <div
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                      u.id === activeUser?.id
                        ? 'text-blue-600 dark:text-blue-400 font-medium'
                        : 'text-gray-700 dark:text-gray-200'
                    }`}
                    onClick={() => void handleSwitch(u)}
                    role="button"
                  >
                    <span className="flex-1 truncate text-left">{u.name}</span>
                    {/* Rename */}
                    <button
                      type="button"
                      onClick={e => startRename(u, e)}
                      title={t('rename')}
                      className="p-0.5 rounded text-gray-300 hover:text-blue-500 dark:hover:text-blue-400 transition-colors flex-shrink-0"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487z" />
                      </svg>
                    </button>
                    {/* Delete — only shown when > 1 user */}
                    {users.length > 1 && (
                      <button
                        type="button"
                        onClick={e => void handleDelete(u, e)}
                        title={t('delete_user_title', { name: u.name })}
                        className="p-0.5 rounded text-gray-300 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Add user row */}
          <div className="border-t border-gray-100 dark:border-gray-700 px-3 py-2 flex items-center gap-1.5">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleAdd()
                if (e.key === 'Escape') setOpen(false)
              }}
              placeholder={t('new_user_placeholder')}
              className="flex-1 min-w-0 px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={!newName.trim()}
              className="p-1 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              title={t('add_user')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Layout() {
  const { lang, t, setLang } = useLang()
  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme)
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [watermarkName, setWatermarkName] = useState<string | null>(null)
  const [doubanLoggedIn, setDoubanLoggedIn] = useState(false)
  const [doubanLoggingIn, setDoubanLoggingIn] = useState(false)

  useEffect(() => {
    // Check Douban session status on mount
    void window.meta.doubanStatus().then(s => setDoubanLoggedIn(s.loggedIn))
  }, [])

  useEffect(() => {
    // Read initial active user for watermark
    void window.db.getActiveUser().then(u => {
      if (u) setWatermarkName(u.name)
    })
    function handleUserChange(e: Event) {
      const user = (e as CustomEvent<UserProfile | null>).detail
      setWatermarkName(user ? user.name : null)
    }
    window.addEventListener('active-user-changed', handleUserChange)
    return () => window.removeEventListener('active-user-changed', handleUserChange)
  }, [])

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('auto')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  useEffect(() => {
    fetchWeather().then(setWeather).catch(() => undefined)
    const interval = setInterval(
      () => { fetchWeather().then(setWeather).catch(() => undefined) },
      1000 * 60 * 30, // 30 minutes
    )
    return () => clearInterval(interval)
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
    theme === 'light' ? t('theme_light') :
    theme === 'dark'  ? t('theme_dark') :
                        t('theme_auto')

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center justify-center w-10 h-10 rounded-xl transition-colors ${
      isActive
        ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
        : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50'
    }`

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      {/* Narrow icon-only sidebar */}
      <aside className="w-16 bg-white dark:bg-gray-800 shadow-md flex flex-col items-center gap-1 border-r border-gray-100 dark:border-gray-700 flex-shrink-0">

        {/* Combined logo — square dark block, full sidebar width */}
        <div className="w-16 h-16 flex items-center justify-center bg-gray-800 flex-shrink-0">
          <LogoBadge />
        </div>

        <div className="mt-2 mb-0 w-8 border-t border-gray-100 dark:border-gray-700" />

        {/* Nav links */}
        <nav className="flex flex-col items-center gap-2 flex-1">
          <Tip label={t('nav_library')}>
            <NavLink to="/" end className={navLinkClass}>
              <BookshelfIcon />
            </NavLink>
          </Tip>
          <Tip label={t('nav_wishlist')}>
            <NavLink to="/wishlist" className={navLinkClass}>
              <StarIcon />
            </NavLink>
          </Tip>
          <Tip label={t('nav_settings')}>
            <NavLink to="/settings" className={navLinkClass}>
              <SettingsIcon />
            </NavLink>
          </Tip>
        </nav>

        {/* User switcher */}
        <UserSwitcher />

        {/* Language toggle */}
        <Tip label={t('lang_toggle')}>
          <button
            type="button"
            onClick={() => void setLang(lang === 'zh' ? 'en' : 'zh')}
            className="flex items-center justify-center w-10 h-10 rounded-xl text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50 transition-colors text-xs font-semibold"
          >
            {lang === 'zh' ? 'EN' : '中'}
          </button>
        </Tip>

        {/* Douban login toggle */}
        <Tip label={doubanLoggedIn ? t('douban_logged_in') : doubanLoggingIn ? t('douban_logging_in') : t('douban_login')}>
          <button
            type="button"
            disabled={doubanLoggingIn}
            onClick={async () => {
              if (doubanLoggedIn) return
              setDoubanLoggingIn(true)
              await window.meta.loginDouban()
              const status = await window.meta.doubanStatus()
              setDoubanLoggedIn(status.loggedIn)
              setDoubanLoggingIn(false)
            }}
            className={`relative flex items-center justify-center w-10 h-10 rounded-xl transition-colors text-xs font-bold
              ${doubanLoggingIn ? 'opacity-50 cursor-wait' : 'hover:bg-gray-100 dark:hover:bg-gray-700/50 cursor-pointer'}
              ${doubanLoggedIn ? 'text-green-500 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}
            `}
          >
            豆
            <span className={`absolute bottom-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${doubanLoggedIn ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
          </button>
        </Tip>

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
        <Outlet context={{ watermarkName, weather }} />
      </main>
    </div>
  )
}
