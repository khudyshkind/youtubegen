import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'

// Allow up to 5 minutes — long scripts can take time to synthesize
export const maxDuration = 300

const ELEVENLABS_BASE = 'https://api.elevenlabs.io'

// Maps UI style labels to ElevenLabs 0–1 style exaggeration
const STYLE_EXAGGERATION: Record<string, number> = {
  neutral: 0,
  conversational: 0.2,
  documentary: 0.3,
  emotional: 0.8,
}

interface AudioRequest {
  text: string
  voice_id: string
  project_id?: string
  stability?: number
  similarity_boost?: number
  speech_rate?: number
  voice_style?: string | number
  clarity_boost?: boolean
}

function estimateMinutes(text: string): number {
  const words = text.trim().split(/\s+/).length
  return Math.ceil(words / 130)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body: AudioRequest = await request.json()
    const {
      text,
      voice_id,
      project_id,
      stability = 0.5,
      similarity_boost = 0.75,
      speech_rate = 1.0,
      voice_style = 0,
      clarity_boost = false,
    } = body

    if (!text || !voice_id) {
      return NextResponse.json({ ok: false, error: 'Текст и голос обязательны' }, { status: 400 })
    }

    const styleExaggeration = typeof voice_style === 'number'
      ? voice_style
      : STYLE_EXAGGERATION[voice_style] ?? 0

    const minutes = estimateMinutes(text)
    const creditCost = Math.max(5, minutes * 5)

    const check = await requireCredits(user.id, 'voice', supabase)
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    // Call ElevenLabs REST API directly — avoids SDK streaming issues in serverless.
    // mp3_44100_64 is available on all ElevenLabs plans (128kbps requires Creator+).
    // speed is NOT part of voice_settings in REST API v1 — omitting it prevents 422.
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
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability,
            similarity_boost,
            style: styleExaggeration,
            use_speaker_boost: clarity_boost,
          },
        }),
      }
    )

    if (!elevenRes.ok) {
      const errBody = await elevenRes.text().catch(() => '(no body)')
      console.error(`[generate/audio] ElevenLabs ${elevenRes.status}:`, errBody)
      return NextResponse.json(
        { ok: false, error: 'Ошибка синтеза речи — проверьте настройки голоса' },
        { status: 502 }
      )
    }

    const audioBuffer = Buffer.from(await elevenRes.arrayBuffer())
    if (audioBuffer.byteLength === 0) {
      console.error('[generate/audio] ElevenLabs returned empty audio buffer')
      return NextResponse.json({ ok: false, error: 'Ошибка генерации аудио' }, { status: 502 })
    }

    // Upload to Supabase Storage
    const serviceClient = createServiceClient()
    const storagePath = `${user.id}/${project_id ?? 'tmp'}/audio.mp3`

    const { error: uploadError } = await serviceClient.storage
      .from('audio')
      .upload(storagePath, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: true,
      })

    if (uploadError) {
      console.error('[generate/audio] Supabase upload error:', uploadError.message)
      return NextResponse.json({ ok: false, error: 'Ошибка загрузки аудио' }, { status: 500 })
    }

    const { data: { publicUrl } } = serviceClient.storage
      .from('audio')
      .getPublicUrl(storagePath)

    await spendCredits(user.id, creditCost, 'voice', project_id)

    if (project_id) {
      await supabase
        .from('projects')
        .update({ audio_url: publicUrl, voice_id, status: 'generating_subtitles' })
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ ok: true, data: { audio_url: publicUrl, minutes } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[generate/audio] unexpected error:', msg)
    return NextResponse.json({ ok: false, error: 'Ошибка генерации аудио' }, { status: 500 })
  }
}
