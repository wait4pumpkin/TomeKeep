export type ThemeMode = 'auto' | 'light' | 'dark'

const STORAGE_KEY = 'theme'

export function getStoredTheme(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === 'light' || raw === 'dark' || raw === 'auto') return raw
  return 'auto'
}

export function setStoredTheme(mode: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, mode)
}

/** Apply (or remove) the `dark` class on <html> based on mode + system pref. */
export function applyTheme(mode: ThemeMode): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = mode === 'dark' || (mode === 'auto' && prefersDark)
  document.documentElement.classList.toggle('dark', isDark)
}

/** Cycle Auto → Light → Dark → Auto … */
export function cycleTheme(current: ThemeMode): ThemeMode {
  if (current === 'auto') return 'light'
  if (current === 'light') return 'dark'
  return 'auto'
}
