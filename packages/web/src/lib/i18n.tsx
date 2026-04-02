// src/lib/i18n.tsx
// Web PWA LangProvider — persists language in localStorage instead of window.db.

import { useEffect, useState } from 'react'
import React from 'react'
import {
  LangContext,
  translate,
  type Lang,
  type DictKey,
} from '@tomekeep/shared'

const STORAGE_KEY = 'tk_lang'

function getStoredLang(): Lang {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === 'en' || raw === 'zh') return raw
  return 'zh'
}

export { useLang } from '@tomekeep/shared'
export type { Lang, DictKey } from '@tomekeep/shared'

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getStoredLang)

  useEffect(() => {
    // Keep in sync if changed from another tab
    function handler(e: StorageEvent) {
      if (e.key === STORAGE_KEY && (e.newValue === 'en' || e.newValue === 'zh')) {
        setLangState(e.newValue)
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  async function setLang(newLang: Lang) {
    setLangState(newLang)
    localStorage.setItem(STORAGE_KEY, newLang)
  }

  const t = (key: DictKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars)

  const value = { lang, t, setLang }
  return React.createElement(LangContext.Provider, { value }, children)
}
