// src/lib/auth.ts
// Lightweight auth state management for the PWA.
// The JWT is stored in an httpOnly cookie by the backend — we only keep the
// decoded user profile in localStorage so the UI can show it without an API call.

export interface AuthUser {
  id: string
  username: string
  name: string
  language: 'zh' | 'en'
}

const STORAGE_KEY = 'tk_user'

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export function setStoredUser(user: AuthUser): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
}

export function clearStoredUser(): void {
  localStorage.removeItem(STORAGE_KEY)
}
