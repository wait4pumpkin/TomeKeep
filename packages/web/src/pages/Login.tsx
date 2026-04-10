// src/pages/Login.tsx

import { useState, type FormEvent } from 'react'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { api } from '../lib/api.ts'
import { setStoredUser, type AuthUser } from '../lib/auth.ts'
import { useLang } from '../lib/i18n.tsx'
import { ensureDefaultProfile } from '../lib/profiles.ts'

const GITHUB_URL = 'https://github.com/wait4pumpkin/TomeKeep'
const RELEASES_URL = 'https://github.com/wait4pumpkin/TomeKeep/releases/latest'

export function Login() {
  const { t, lang, setLang } = useLang()
  const navigate = useNavigate()
  const location = useLocation()
  const registered = (location.state as { registered?: boolean } | null)?.registered === true
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username || !password) return
    setLoading(true)
    setError(null)
    try {
      await api.post<{ token: string }>('/auth/login', { username, password })
      const me = await api.get<AuthUser>('/auth/me')
      if (me.is_admin) {
        // Silently reject admin logins on the regular login page — do not
        // reveal that the account exists or that it is an admin account.
        await api.post('/auth/logout', {})
        setError(t('invalid_credentials'))
        return
      }
      setStoredUser(me)
      await ensureDefaultProfile()
      navigate('/', { replace: true })
    } catch (err) {
      setError(t('invalid_credentials'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-sm">

        {/* Language toggle */}
        <div className="flex justify-end mb-2">
          <button
            onClick={() => { void setLang(lang === 'zh' ? 'en' : 'zh') }}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors px-2 py-1 rounded"
          >
            {lang === 'zh' ? 'English' : '中文'}
          </button>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">TomeKeep</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('nav_library')}
          </p>
        </div>

        {registered && (
          <div className="mb-4 px-4 py-2 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 text-sm text-green-700 dark:text-green-300 text-center">
            {t('register_success_banner')}
          </div>
        )}

        <form
          onSubmit={(e) => { void handleSubmit(e) }}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('login_username')}
            </label>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('login_password')}
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? t('login_submitting') : t('login_submit')}
          </button>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            {t('login_no_account')}{' '}
            <Link to="/register" className="text-blue-600 hover:underline">
              {t('login_register')}
            </Link>
          </p>
        </form>

        {/* GitHub / download links */}
        <div className="mt-4 flex justify-center gap-6">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            {/* GitHub mark */}
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
                -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
                .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
                -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09
                2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82
                2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01
                2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            {t('login_github')}
          </a>
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            {/* Monitor / desktop icon */}
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            {t('login_download_mac')}
          </a>
        </div>

      </div>
    </div>
  )
}
