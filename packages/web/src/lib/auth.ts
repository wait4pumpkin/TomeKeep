// src/lib/auth.ts
// Lightweight auth state management for the PWA.
// The JWT is stored in an httpOnly cookie by the backend — we only keep the
// decoded user profile in localStorage so the UI can show it without an API call.
//
// Admin and regular-user sessions are fully isolated:
//   Regular users  → localStorage key "tk_user"  (is_admin must be false)
//   Admin          → localStorage key "tk_admin" (is_admin must be true)
// The two can coexist without interfering.

export interface AuthUser {
  id: string
  username: string
  name: string
  language: 'zh' | 'en'
  is_admin: boolean
}

const USER_KEY  = 'tk_user'
const ADMIN_KEY = 'tk_admin'

// ── Regular-user session ────────────────────────────────────────────────────

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const u = JSON.parse(raw) as AuthUser
    // Safety: never return an admin via the regular-user accessor
    if (u.is_admin) return null
    return u
  } catch {
    return null
  }
}

export function setStoredUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearStoredUser(): void {
  localStorage.removeItem(USER_KEY)
}

// ── Admin session ───────────────────────────────────────────────────────────

export function getStoredAdmin(): AuthUser | null {
  try {
    const raw = localStorage.getItem(ADMIN_KEY)
    if (!raw) return null
    const u = JSON.parse(raw) as AuthUser
    // Safety: never return a non-admin via the admin accessor
    if (!u.is_admin) return null
    return u
  } catch {
    return null
  }
}

export function setStoredAdmin(user: AuthUser): void {
  localStorage.setItem(ADMIN_KEY, JSON.stringify(user))
}

export function clearStoredAdmin(): void {
  localStorage.removeItem(ADMIN_KEY)
}
