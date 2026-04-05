import { useState, useEffect, useRef } from 'react'
import { useLang } from '../lib/i18n'

// ---------------------------------------------------------------------------
// Settings page — Cloud Sync section
// ---------------------------------------------------------------------------

export function Settings() {
  const { t } = useLang()

  const [loggedIn, setLoggedIn] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [pullBusy, setPullBusy] = useState(false)
  const [pullResult, setPullResult] = useState<string | null>(null)

  // Migration state
  const [migrateBusy, setMigrateBusy] = useState(false)
  const [migrateStatus, setMigrateStatus] = useState<string | null>(null)
  const [migrateError, setMigrateError] = useState<string | null>(null)
  const disposeProgressRef = useRef<(() => void) | null>(null)

  async function loadStatus() {
    const status = await window.sync.getStatus()
    setLoggedIn(status.loggedIn)
    setLastSyncAt(status.lastSyncAt)
  }

  useEffect(() => { void loadStatus() }, [])

  // Cleanup progress listener on unmount
  useEffect(() => () => { disposeProgressRef.current?.() }, [])

  async function handleLogin() {
    if (!username.trim() || !password.trim()) return
    setLoginBusy(true)
    setLoginError(null)
    try {
      const result = await window.sync.login(username.trim(), password)
      if (result.ok) {
        setUsername('')
        setPassword('')
        await loadStatus()
      } else {
        setLoginError(result.error ?? 'unknown_error')
      }
    } finally {
      setLoginBusy(false)
    }
  }

  async function handleLogout() {
    await window.sync.logout()
    await loadStatus()
  }

  async function handlePull() {
    setPullBusy(true)
    setPullResult(null)
    try {
      const result = await window.sync.pull()
      if (result.error) {
        setPullResult(t('sync_pull_error', { error: result.error }))
      } else {
        setPullResult(result.updated ? t('sync_pull_updated') : t('sync_pull_no_changes'))
        await loadStatus()
      }
    } finally {
      setPullBusy(false)
    }
  }

  async function handleMigrate() {
    setMigrateBusy(true)
    setMigrateStatus(null)
    setMigrateError(null)

    // Subscribe to progress events
    disposeProgressRef.current?.()
    disposeProgressRef.current = window.sync.onMigrateProgress((p) => {
      if (p.phase === 'done') return
      const key = p.phase === 'covers' ? 'sync_migrate_phase_covers'
        : p.phase === 'books' ? 'sync_migrate_phase_books'
        : p.phase === 'wishlist' ? 'sync_migrate_phase_wishlist'
        : 'sync_migrate_phase_states'
      setMigrateStatus(t(key, { current: p.current, total: p.total }))
    })

    try {
      const result = await window.sync.migrate()
      disposeProgressRef.current?.()
      disposeProgressRef.current = null

      if (result.ok) {
        setMigrateStatus(t('sync_migrate_done', {
          books: result.books,
          wishlist: result.wishlist,
          covers: result.covers,
        }))
      } else {
        setMigrateError(t('sync_migrate_error', { error: result.error ?? 'unknown' }))
      }
    } finally {
      setMigrateBusy(false)
    }
  }

  const formattedLastSync = lastSyncAt
    ? new Date(lastSyncAt).toLocaleString()
    : t('sync_never')

  return (
    <div className="max-w-lg mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8">
        {t('settings_title')}
      </h1>

      {/* Cloud Sync Section */}
      <section className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
          {t('sync_section_title')}
        </h2>

        {loggedIn ? (
          <div className="space-y-4">
            {/* Sync status indicator */}
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
              <span>{t('sync_connected')}</span>
            </div>

            <div className="text-sm text-gray-500 dark:text-gray-400">
              {t('sync_last_sync')}: {formattedLastSync}
            </div>

            {/* Manual pull */}
            <button
              type="button"
              onClick={() => void handlePull()}
              disabled={pullBusy}
              className="w-full py-2 px-4 rounded-xl bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {pullBusy ? t('sync_pulling') : t('sync_pull_now')}
            </button>

            {pullResult && (
              <p className="text-sm text-gray-600 dark:text-gray-400">{pullResult}</p>
            )}

            {/* Logout */}
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="w-full py-2 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t('sync_logout')}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {t('sync_login_description')}
            </p>

            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder={t('sync_username_placeholder')}
              autoComplete="username"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleLogin() }}
              placeholder={t('sync_password_placeholder')}
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {loginError && (
              <p className="text-sm text-red-500 dark:text-red-400">{loginError}</p>
            )}

            <button
              type="button"
              onClick={() => void handleLogin()}
              disabled={loginBusy || !username.trim() || !password.trim()}
              className="w-full py-2 px-4 rounded-xl bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loginBusy ? t('sync_logging_in') : t('sync_login')}
            </button>
          </div>
        )}
      </section>

      {/* Migration section — only shown when logged in */}
      {loggedIn && (
        <section className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">
            {t('sync_migrate_title')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {t('sync_migrate_description')}
          </p>

          <button
            type="button"
            onClick={() => void handleMigrate()}
            disabled={migrateBusy}
            className="w-full py-2 px-4 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {migrateBusy ? t('sync_migrate_running') : t('sync_migrate_start')}
          </button>

          {migrateStatus && !migrateError && (
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{migrateStatus}</p>
          )}
          {migrateError && (
            <p className="mt-3 text-sm text-red-500 dark:text-red-400">{migrateError}</p>
          )}
        </section>
      )}
    </div>
  )
}
