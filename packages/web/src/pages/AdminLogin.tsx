// src/pages/AdminLogin.tsx
// Separate login page for the admin backend.
// Lives at /admin/login — visually distinct from the user-facing /login page.

import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.ts'
import { setStoredAdmin, type AuthUser } from '../lib/auth.ts'

export function AdminLogin() {
  const navigate = useNavigate()
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
      if (!me.is_admin) {
        // Logged in but not admin — clear and show error
        await api.post('/auth/logout', {})
        setError('该账号没有管理员权限')
        setLoading(false)
        return
      }
      setStoredAdmin(me)
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 mb-4">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 0 1 21.75 8.25Z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white">TomeKeep 管理后台</h1>
          <p className="text-sm text-gray-400 mt-1">仅限管理员访问</p>
        </div>

        <form
          onSubmit={(e) => { void handleSubmit(e) }}
          className="bg-gray-800 rounded-2xl border border-gray-700 p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              用户名
            </label>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-600 bg-gray-700 text-gray-100 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              密码
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-600 bg-gray-700 text-gray-100 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? '登录中…' : '登录管理后台'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-600 mt-6">
          普通用户请访问{' '}
          <a href="/login" className="text-gray-400 hover:text-gray-200 underline">
            /login
          </a>
        </p>
      </div>
    </div>
  )
}
