import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { env } from '@/lib/env'

const ELEVENLABS_BASE = 'https://api.elevenlabs.io'
const PREVIEW_TEXT = 'Привет! Это пример голоса для вашего YouTube видео. Как вам звучание?'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const { voice_id, stability = 0.5, similarity_boost = 0.75 } = await request.json()

    if (!voice_id) {
      return NextResponse.json({ ok: false, error: 'voice_id обязателен' }, { status: 400 })
    }

    const elevenRes = await fetch(
      `${ELEVENLABS_BASE}/v1/text-to-speech/${voice_id}?output_format=mp3_44100_64`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': env('ELEVENLABS_API_KEY'),
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: PREVIEW_TEXT,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability, similarity_boost },
        }),
      }
    )

    if (!elevenRes.ok) {
      const errBody = await elevenRes.text().catch(() => '(no body)')
      console.error(`[voice-preview] ElevenLabs ${elevenRes.status}:`, errBody)
      return NextResponse.json({ ok: false, error: 'Ошибка генерации превью' }, { status: 502 })
    }

    const audioBuffer = Buffer.from(await elevenRes.arrayBuffer())

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (error) {
    console.error('[voice-preview]', error)
    return NextResponse.json({ ok: false, error: 'Ошибка генерации превью' }, { status: 500 })
  }
}
