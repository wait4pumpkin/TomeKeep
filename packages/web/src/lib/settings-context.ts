// lib/settings-context.ts
// Shared context for toggling the in-page settings bar.

import { createContext, useContext } from 'react'

interface SettingsContextValue {
  settingsOpen: boolean
  toggleSettings: () => void
}

export const SettingsContext = createContext<SettingsContextValue>({
  settingsOpen: false,
  toggleSettings: () => {},
})

export function useSettings() {
  return useContext(SettingsContext)
}
