import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { env } from '@/lib/env'
import type { ApihostVoiceType } from '@/lib/types'
import { CREDIT_COSTS, ENGINE_DISPLAY } from '@/lib/types'

const APIHOST_RATE: Record<ApihostVoiceType, number> = {
  basic:    CREDIT_COSTS.audio_apihost_basic_per_1000,
  standard: CREDIT_COSTS.audio_apihost_standard_per_1000,
  pro:      CREDIT_COSTS.audio_apihost_pro_per_1000,
  studio:   CREDIT_COSTS.audio_apihost_studio_per_1000,
}

export const maxDuration = 30

const APIHOST_BASE = 'https://apihost.ru/api/v1'

// Server number → voice type mapping
const SERVER_TYPES: Record<number, ApihostVoiceType> = {
  1: 'basic',
  2: 'standard',
  3: 'standard',
  4: 'standard',
  5: 'basic',
  6: 'pro',
  7: 'pro',
}

const SERVER_PRICES_RUB: Record<ApihostVoiceType, number> = {
  basic:    0.6,
  standard: 4.0,
  pro:      6.5,
  studio:   15.0,
}

interface ApihostSpeakerRaw {
  id: number | string
  name?: string
  speaker?: string   // actual name field returned by API
  lang?: string
  language?: string
  gender?: string
  sex?: string
}

export interface ApihostVoice {
  voice_id: string
  name: string
  gender: 'male' | 'female' | null
  lang: string
  engine: 'apihost'
  voice_type: ApihostVoiceType
  credits_per_1000: number
  price_per_1000_rub: number
  price_per_1000_usd: number
  preview_url: string | null
  server: number
}

async function fetchServer(key: string, server: number): Promise<ApihostVoice[]> {
  const voiceType = SERVER_TYPES[server] ?? 'standard'
  try {
    const res = await fetch(`${APIHOST_BASE}/speaker`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ server }),
    })
    const rawText = await res.text()
    console.log(`[apihost/voices] server=${server} status=${res.status} body=${rawText.slice(0, 300)}`)
    if (!res.ok) return []
    let data: ApihostSpeakerRaw[] | { data?: ApihostSpeakerRaw[]; speaker?: ApihostSpeakerRaw[] }
    try { data = JSON.parse(rawText) } catch { return [] }
    // API returns { "speaker": [...] }, fallback for { "data": [...] } or plain array
    const list: ApihostSpeakerRaw[] = Array.isArray(data) ? data : (data.speaker ?? data.data ?? [])

    return list.map((v) => {
      const lang = v.lang ?? v.language ?? 'ru-RU'
      const genderRaw = (v.gender ?? v.sex ?? '').toLowerCase()
      const gender: 'male' | 'female' | null =
        genderRaw === 'male' || genderRaw === 'm' ? 'male' :
        genderRaw === 'female' || genderRaw === 'f' ? 'female' : null
      const priceRub = SERVER_PRICES_RUB[voiceType]
      const voiceId = String(v.id)
      return {
        voice_id: voiceId,
        name: v.speaker ?? v.name ?? voiceId,
        gender,
        lang,
        engine: 'apihost' as const,
        voice_type: voiceType,
        credits_per_1000: APIHOST_RATE[voiceType],
        price_per_1000_rub: priceRub,
        price_per_1000_usd: Math.round((priceRub / 90) * 1000) / 1000,
        preview_url: `https://apihost.ru/samples/examples/other/${lang}_${voiceId}.mp3`,
        server,
      }
    })
  } catch (err) {
    console.log(`[apihost/voices] server=${server} exception:`, err instanceof Error ? err.message : String(err))
    return []
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const key = env('APIHOST_API_KEY')
    console.log('[apihost/voices] key present:', !!key?.trim(), 'length:', key?.trim().length ?? 0)

    const url = new URL(request.url)
    const langFilter = url.searchParams.get('language') ?? ''

    // Fetch all servers in parallel
    const serverResults = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7].map((s) => fetchServer(key, s))
    )

    let voices: ApihostVoice[] = serverResults.flat()

    // Deduplicate by voice_id (keep first occurrence)
    const seen = new Set<string>()
    voices = voices.filter((v) => {
      if (seen.has(v.voice_id)) return false
      seen.add(v.voice_id)
      return true
    })

    if (langFilter) {
      voices = voices.filter((v) =>
        v.lang.toLowerCase().startsWith(langFilter.toLowerCase())
      )
    }

    // Sort: by language then name
    voices.sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))

    console.log('[apihost/voices] total voices after dedup/filter:', voices.length)

    return NextResponse.json(
      { ok: true, data: { voices, total: voices.length } },
      { headers: { 'Cache-Control': 'public, s-maxage=3600' } }
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[voices/apihost] error:', msg)
    return NextResponse.json({ ok: false, error: `Ошибка загрузки голосов ${ENGINE_DISPLAY.apihost.name}` }, { status: 500 })
  }
}
