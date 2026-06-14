import { NextRequest, NextResponse } from 'next/server'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ElevenLabel {
  gender?: string
  accent?: string
  age?: string
  description?: string
  language?: string
  'use case'?: string
}

interface OwnVoice {
  voice_id: string
  name: string
  preview_url?: string | null
  labels?: ElevenLabel
  fine_tuning?: { language?: string }
}

interface SharedVoice {
  voice_id: string
  name: string
  preview_url?: string | null
  gender?: string
  accent?: string
  language?: string
  description?: string
  use_case?: string
  category?: string
  free_users_allowed?: boolean
}

interface NormalizedVoice {
  voice_id: string
  name: string
  preview_url: string | null
  gender: 'M' | 'F' | null
  description: string | null
  accent: string | null
  language: string | null
  is_own: boolean
}

// ─── Language normalisation ─────────────────────────────────────────────────────
// ElevenLabs returns wildly inconsistent formats: "ru", "RU", "Russian", "russian",
// "Русский", "английский", etc. Map every known variant to ISO-639-1 lowercase.

const LANG_MAP: Record<string, string> = {
  // Russian
  ru: 'ru', russian: 'ru', русский: 'ru',
  // English
  en: 'en', english: 'en', английский: 'en',
  // German
  de: 'de', german: 'de', deutsch: 'de', немецкий: 'de',
  // Spanish
  es: 'es', spanish: 'es', español: 'es', espanol: 'es', испанский: 'es',
  // French
  fr: 'fr', french: 'fr', français: 'fr', francais: 'fr', французский: 'fr',
  // Italian
  it: 'it', italian: 'it', italiano: 'it', итальянский: 'it',
  // Portuguese
  pt: 'pt', portuguese: 'pt', português: 'pt', portugues: 'pt', португальский: 'pt',
  // Chinese
  zh: 'zh', chinese: 'zh', китайский: 'zh',
  // Japanese
  ja: 'ja', japanese: 'ja', японский: 'ja',
  // Korean
  ko: 'ko', korean: 'ko', корейский: 'ko',
  // Arabic
  ar: 'ar', arabic: 'ar', арабский: 'ar',
  // Hindi
  hi: 'hi', hindi: 'hi', хинди: 'hi',
  // Dutch
  nl: 'nl', dutch: 'nl', нидерландский: 'nl',
  // Polish
  pl: 'pl', polish: 'pl', polski: 'pl', польский: 'pl',
  // Turkish
  tr: 'tr', turkish: 'tr', türkçe: 'tr', turkce: 'tr', турецкий: 'tr',
  // Swedish
  sv: 'sv', swedish: 'sv', svenska: 'sv', шведский: 'sv',
  // Norwegian
  no: 'no', norwegian: 'no', norsk: 'no', норвежский: 'no',
  // Danish
  da: 'da', danish: 'da', dansk: 'da', датский: 'da',
  // Finnish
  fi: 'fi', finnish: 'fi', suomi: 'fi', финский: 'fi',
  // Ukrainian
  uk: 'uk', ukrainian: 'uk', українська: 'uk', украинский: 'uk',
  // Czech
  cs: 'cs', czech: 'cs', čeština: 'cs', cestina: 'cs', чешский: 'cs',
  // Romanian
  ro: 'ro', romanian: 'ro', română: 'ro', romana: 'ro', румынский: 'ro',
  // Hungarian
  hu: 'hu', hungarian: 'hu', magyar: 'hu', венгерский: 'hu',
  // Greek
  el: 'el', greek: 'el', ελληνικά: 'el', греческий: 'el',
  // Hebrew
  he: 'he', hebrew: 'he', עברית: 'he', иврит: 'he',
  // Thai
  th: 'th', thai: 'th', тайский: 'th',
  // Indonesian
  id: 'id', indonesian: 'id', индонезийский: 'id',
  // Vietnamese
  vi: 'vi', vietnamese: 'vi', вьетнамский: 'vi',
}

function normalizeLang(raw: string | null | undefined): string | null {
  if (!raw) return null
  const key = raw.toLowerCase().trim()
  return LANG_MAP[key] ?? null  // unknown format → null (treat as "no language")
}

// ─── Voice normalisation ────────────────────────────────────────────────────────

function parseGender(raw?: string): 'M' | 'F' | null {
  const g = raw?.toLowerCase()
  if (g === 'male') return 'M'
  if (g === 'female') return 'F'
  return null
}

function normalizeOwn(v: OwnVoice): NormalizedVoice {
  const desc = [v.labels?.description, v.labels?.['use case']].filter(Boolean).join(', ')
  const rawLang = v.labels?.language ?? v.fine_tuning?.language
  return {
    voice_id: v.voice_id,
    name: v.name,
    preview_url: v.preview_url ?? null,
    gender: parseGender(v.labels?.gender),
    description: desc || null,
    accent: v.labels?.accent ?? null,
    language: normalizeLang(rawLang),
    is_own: true,
  }
}

function normalizeShared(v: SharedVoice): NormalizedVoice {
  const desc = [v.description, v.use_case].filter(Boolean).join(', ')
  return {
    voice_id: v.voice_id,
    name: v.name,
    preview_url: v.preview_url ?? null,
    gender: parseGender(v.gender),
    description: desc || null,
    accent: v.accent ?? null,
    language: normalizeLang(v.language),
    is_own: false,
  }
}

// ─── Fetch helpers ──────────────────────────────────────────────────────────────

async function fetchOwnVoices(apiKey: string, language: string): Promise<NormalizedVoice[]> {
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
      next: { revalidate: 3600 },
    })
    if (!res.ok) return []
    const data = await res.json()

    // Diagnostic: show raw labels of first few own voices
    const raw = (data.voices ?? []) as OwnVoice[]
    console.log('[voices] own voice sample labels:', raw.slice(0, 3).map((v) => ({
      name: v.name,
      labels: v.labels,
      fine_tuning_lang: v.fine_tuning?.language,
    })))

    const all = raw.map(normalizeOwn)

    if (!language) return all

    // When a specific language is requested: only show own voices that have a
    // matching language label. Voices with NO language info are excluded —
    // otherwise they pollute every language-filtered list.
    return all.filter((v) => v.language === language)
  } catch {
    return []
  }
}

async function fetchSharedPage(
  apiKey: string,
  language: string,
  page: number,
): Promise<{ voices: NormalizedVoice[]; has_more: boolean }> {
  try {
    const url = new URL('https://api.elevenlabs.io/v1/shared-voices')
    url.searchParams.set('page_size', '100')
    url.searchParams.set('page', String(page))
    if (language) url.searchParams.set('language', language)

    const res = await fetch(url.toString(), {
      headers: { 'xi-api-key': apiKey },
      next: { revalidate: 3600 },
    })
    if (!res.ok) return { voices: [], has_more: false }

    const data = await res.json()
    const voices = ((data.voices ?? []) as SharedVoice[]).map(normalizeShared)
    return { voices, has_more: data.has_more ?? false }
  } catch {
    return { voices: [], has_more: false }
  }
}

async function fetchSharedVoices(apiKey: string, language: string): Promise<NormalizedVoice[]> {
  const page0 = await fetchSharedPage(apiKey, language, 0)
  const all = [...page0.voices]

  if (page0.has_more) {
    const [p1, p2] = await Promise.all([
      fetchSharedPage(apiKey, language, 1),
      fetchSharedPage(apiKey, language, 2),
    ])
    all.push(...p1.voices)
    if (p1.has_more) all.push(...p2.voices)
  }

  // Secondary client-side filter: ElevenLabs server-side filter isn't always strict.
  // If language was requested, drop any voices whose language tag doesn't match.
  if (language) {
    return all.filter((v) => !v.language || v.language === language)
  }
  return all
}

// ─── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY ?? ''
    const language = request.nextUrl.searchParams.get('language') ?? ''

    const [ownVoices, sharedVoices] = await Promise.all([
      apiKey ? fetchOwnVoices(apiKey, language) : Promise.resolve([]),
      apiKey ? fetchSharedVoices(apiKey, language) : Promise.resolve([]),
    ])

    const ownIds = new Set(ownVoices.map((v) => v.voice_id))
    const shared = sharedVoices.filter((v) => !ownIds.has(v.voice_id))
    const voices = [...ownVoices, ...shared]

    console.log(`[api/voices] own=${ownVoices.length} shared=${shared.length} total=${voices.length} lang="${language}"`)

    return NextResponse.json({ ok: true, data: { voices, total: voices.length } })
  } catch (err) {
    console.error('[api/voices]', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { ok: false, error: 'Ошибка соединения с голосовым сервисом' },
      { status: 502 }
    )
  }
}
