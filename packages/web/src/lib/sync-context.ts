// src/lib/sync-context.ts
// React context that exposes the background sync state (syncing, syncError)
// from Layout to any child page.  Pages use this to render an inline spinner
// inside their own header rather than relying on a fixed overlay in Layout.

import { createContext, useContext } from 'react'

export interface SyncState {
  syncing: boolean
  syncError: boolean
}

export const SyncContext = createContext<SyncState>({ syncing: false, syncError: false })

export function useSyncState(): SyncState {
  return useContext(SyncContext)
}
