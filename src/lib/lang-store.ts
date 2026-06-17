'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Lang } from './i18n'

interface LangState {
  lang: Lang
  setLang: (lang: Lang) => void
}

export const useLangStore = create<LangState>()(
  persist(
    (set) => ({
      lang: 'ru' as Lang,
      setLang: (lang: Lang) => set({ lang }),
    }),
    { name: 'yt-lang' }
  )
)
