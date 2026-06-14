import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'

export const maxDuration = 10

interface GoogleVoiceRaw {
  name: string
  languageCodes: string[]
  ssmlGender: 'MALE' | 'FEMALE' | 'NEUTRAL' | 'SSML_VOICE_GENDER_UNSPECIFIED'
  naturalSampleRateHertz: number
}

export async function GET(req: NextRequest) {
  const key = env('GOOGLE_TTS_API_KEY')
  if (!key) {
    return NextResponse.json(
      { ok: false, error: 'Google TTS API key не настроен' },
      { status: 503 }
    )
  }

  const language = req.nextUrl.searchParams.get('language') ?? 'ru'
  const url = language
    ? `https://texttospeech.googleapis.com/v1/voices?key=${key}&languageCode=${encodeURIComponent(language)}`
    : `https://texttospeech.googleapis.com/v1/voices?key=${key}`

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      console.error('[voices/google]', res.status, err.slice(0, 200))
      return NextResponse.json(
        { ok: false, error: `Google TTS API error ${res.status}` },
        { status: 502 }
      )
    }

    const json = await res.json() as { voices?: GoogleVoiceRaw[] }
    const voices = (json.voices ?? []).map((v) => ({
      name: v.name,
      languageCodes: v.languageCodes,
      gender: v.ssmlGender === 'FEMALE' ? 'F' : v.ssmlGender === 'MALE' ? 'M' : null,
      isWavenet: v.name.toLowerCase().includes('wavenet') || v.name.toLowerCase().includes('neural'),
    }))

    return NextResponse.json({ ok: true, data: { voices } })
  } catch (err) {
    console.error('[voices/google] fetch error:', err)
    return NextResponse.json(
      { ok: false, error: 'Ошибка загрузки голосов Google' },
      { status: 500 }
    )
  }
}
