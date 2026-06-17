'use client'

import { useLangStore } from '@/lib/lang-store'
import { t } from '@/lib/i18n'

export function useLang() {
  const { lang, setLang } = useLangStore()
  const translate = (key: string) => t(key, lang)
  return { lang, setLang, t: translate }
}
