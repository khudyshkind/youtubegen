import { NextRequest } from 'next/server'

const LANG_MAP: Record<string, string> = {
  ru: 'Russian',
  uk: 'Ukrainian',
  be: 'Belarusian',
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
  it: 'Italian',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  tr: 'Turkish',
  pl: 'Polish',
  ar: 'Arabic',
  hi: 'Hindi',
}

export function resolveUserLang(req: NextRequest, bodyLang?: string): string {
  if (bodyLang) {
    const code = bodyLang.toLowerCase().slice(0, 2)
    if (LANG_MAP[code]) return LANG_MAP[code]
  }
  const header = req.headers.get('accept-language') ?? ''
  for (const seg of header.split(',')) {
    const code = seg.trim().split(/[-;]/)[0].toLowerCase()
    if (LANG_MAP[code]) return LANG_MAP[code]
  }
  return 'Russian'
}

export function langNote(lang: string): string {
  return `\n\nIMPORTANT: Respond in ${lang}. All analytical text in your JSON response (descriptions, recommendations, insights, reasons, pain points, ideas, strengths, weaknesses, etc.) must be in ${lang}. Do NOT translate channel names, video titles, brand names, or user-provided topics — keep those verbatim in their original language.`
}
