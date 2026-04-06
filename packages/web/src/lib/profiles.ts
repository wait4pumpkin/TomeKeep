// src/lib/profiles.ts
// Client-side profile management.
// Profiles are persisted in localStorage and synced to/from the server.
// Each profile has a client-generated UUID that is stable across devices.

import { api } from './api.ts'

export interface Profile {
  id: string
  name: string
  owner_id?: string
  created_at?: string
  updated_at?: string
}

const PROFILES_KEY = 'tk_profiles'
const ACTIVE_PROFILE_KEY = 'tk_active_profile'

// ---------------------------------------------------------------------------
// Local storage helpers
// ---------------------------------------------------------------------------

export function getStoredProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    return raw ? (JSON.parse(raw) as Profile[]) : []
  } catch {
    return []
  }
}

export function setStoredProfiles(profiles: Profile[]): void {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
}

export function getActiveProfileId(): string | null {
  return localStorage.getItem(ACTIVE_PROFILE_KEY)
}

export function setActiveProfileId(id: string | null): void {
  if (id === null) {
    localStorage.removeItem(ACTIVE_PROFILE_KEY)
  } else {
    localStorage.setItem(ACTIVE_PROFILE_KEY, id)
  }
}

/**
 * Returns the active profile, or null if none is selected.
 * If there is exactly one profile, returns it automatically.
 */
export function getActiveProfile(): Profile | null {
  const profiles = getStoredProfiles()
  if (profiles.length === 0) return null
  const activeId = getActiveProfileId()
  if (activeId) {
    const found = profiles.find(p => p.id === activeId)
    if (found) return found
  }
  // Fall back to first profile
  return profiles[0] ?? null
}

// ---------------------------------------------------------------------------
// Server sync
// ---------------------------------------------------------------------------

/**
 * Fetch profiles from server and merge into localStorage.
 * Returns the merged list.
 */
export async function syncProfiles(): Promise<Profile[]> {
  const serverProfiles = await api.get<Profile[]>('/profiles')
  setStoredProfiles(serverProfiles)
  return serverProfiles
}

/**
 * Create a profile on the server and add it to localStorage.
 */
export async function createProfile(name: string): Promise<Profile> {
  const id = crypto.randomUUID()
  const created = await api.post<Profile>('/profiles', { id, name })
  const existing = getStoredProfiles()
  setStoredProfiles([...existing, created])
  return created
}

/**
 * Rename a profile on the server and update localStorage.
 */
export async function renameProfile(id: string, name: string): Promise<void> {
  await api.patch(`/profiles/${id}`, { name })
  const profiles = getStoredProfiles().map(p => p.id === id ? { ...p, name } : p)
  setStoredProfiles(profiles)
}

/**
 * Delete a profile on the server and remove from localStorage.
 * If it was the active profile, clears the active selection.
 */
export async function deleteProfile(id: string): Promise<void> {
  await api.delete(`/profiles/${id}`)
  const profiles = getStoredProfiles().filter(p => p.id !== id)
  setStoredProfiles(profiles)
  if (getActiveProfileId() === id) setActiveProfileId(null)
}

/**
 * Clear all local profile data (used on logout).
 */
export function clearProfiles(): void {
  localStorage.removeItem(PROFILES_KEY)
  localStorage.removeItem(ACTIVE_PROFILE_KEY)
}
