// Desktop-specific i18n: re-export shared core + add window.db-based LangProvider
export * from '@tomekeep/shared'
import { useEffect, useState } from 'react'
import React from 'react'
import { LangContext, translate, type Lang, type DictKey } from '@tomekeep/shared'

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('zh')

  // Load language from the active user on mount
  useEffect(() => {
    void window.db.getActiveUser().then(user => {
      if (user?.language === 'en' || user?.language === 'zh') {
        setLangState(user.language)
      }
    })

    // React to user switches
    function handleUserChange(e: Event) {
      const user = (e as CustomEvent<{ language?: Lang } | null>).detail
      if (user?.language === 'en' || user?.language === 'zh') {
        setLangState(user.language)
      } else if (user) {
        setLangState('zh')
      }
    }
    window.addEventListener('active-user-changed', handleUserChange)
    return () => window.removeEventListener('active-user-changed', handleUserChange)
  }, [])

  async function setLang(newLang: Lang) {
    setLangState(newLang)
    const user = await window.db.getActiveUser()
    if (user) {
      await window.db.setUserLanguage(user.id, newLang)
    }
  }

  const t = (key: DictKey, vars?: Record<string, string | number>) =>
    translate(lang, key, vars)

  const value = { lang, t, setLang }
  return React.createElement(LangContext.Provider, { value }, children)
}

