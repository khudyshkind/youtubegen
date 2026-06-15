import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { trackEvent } from '@/lib/analytics'
import { audioCost } from '@/lib/types'
import type { AudioEngine, ApihostVoiceType } from '@/lib/types'
import { env } from '@/lib/env'

export const maxDuration = 300

const ELEVENLABS_BASE = 'https://api.elevenlabs.io'

const STYLE_EXAGGERATION: Record<string, number> = {
  neutral: 0,
  conversational: 0.2,
  documentary: 0.3,
  emotional: 0.8,
}

interface AudioRequest {
  engine?: AudioEngine
  text: string
  voice_id: string
  project_id?: string
  // ElevenLabs-specific
  stability?: number
  similarity_boost?: number
  speech_rate?: number
  voice_style?: string | number
  clarity_boost?: boolean
  paragraph_pauses?: boolean
  // APIHOST-specific
  apihost_voice_type?: ApihostVoiceType
  apihost_lang?: string
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
      engine = 'elevenlabs',
      text,
      voice_id,
      project_id,
      stability = 0.5,
      similarity_boost = 0.75,
      speech_rate = 1.0,
      voice_style = 0,
      clarity_boost = false,
      apihost_voice_type = 'standard',
      apihost_lang = 'ru-RU',
    } = body

    if (!text || !voice_id) {
      return NextResponse.json({ ok: false, error: 'Текст и голос обязательны' }, { status: 400 })
    }

    const validEngines: AudioEngine[] = ['elevenlabs', 'openai', 'google', 'apihost']
    if (!validEngines.includes(engine)) {
      return NextResponse.json({ ok: false, error: 'Неверный движок TTS' }, { status: 400 })
    }

    const chars = text.length
    const cost = Math.max(1, audioCost(chars, engine, apihost_voice_type))

    const check = await requireCreditsAmount(user.id, cost, supabase)
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    let audioBuffer: Buffer

    if (engine === 'openai') {
      const openaiKey = env('OPENAI_API_KEY')
      if (!openaiKey) {
        return NextResponse.json({ ok: false, error: 'OpenAI API key не настроен' }, { status: 503 })
      }

      const openaiRes = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice: voice_id,
          input: text,
          response_format: 'mp3',
        }),
      })

      if (!openaiRes.ok) {
        const errBody = await openaiRes.text().catch(() => '')
        console.error('[generate/audio] OpenAI TTS error:', openaiRes.status, errBody.slice(0, 200))
        return NextResponse.json({ ok: false, error: 'Ошибка синтеза речи OpenAI' }, { status: 502 })
      }

      audioBuffer = Buffer.from(await openaiRes.arrayBuffer())

    } else if (engine === 'google') {
      const googleKey = env('GOOGLE_TTS_API_KEY')
      if (!googleKey) {
        return NextResponse.json({ ok: false, error: 'Google TTS API key не настроен' }, { status: 503 })
      }

      // Extract BCP-47 language code from voice name (e.g. "ru-RU-Standard-A" → "ru-RU")
      const langCode = voice_id.split('-').slice(0, 2).join('-') || 'ru-RU'

      const googleRes = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text },
            voice: { languageCode: langCode, name: voice_id },
            audioConfig: { audioEncoding: 'MP3' },
          }),
        }
      )

      if (!googleRes.ok) {
        const errBody = await googleRes.text().catch(() => '')
        console.error('[generate/audio] Google TTS error:', googleRes.status, errBody.slice(0, 200))
        return NextResponse.json({ ok: false, error: 'Ошибка синтеза речи Google' }, { status: 502 })
      }

      const googleJson = await googleRes.json() as { audioContent?: string }
      if (!googleJson.audioContent) {
        return NextResponse.json({ ok: false, error: 'Google TTS вернул пустой ответ' }, { status: 502 })
      }

      audioBuffer = Buffer.from(googleJson.audioContent, 'base64')

    } else if (engine === 'apihost') {
      const apihostKey = env('APIHOST_API_KEY')
      const apihostHeaders = {
        'Authorization': `Bearer ${apihostKey}`,
        'Content-Type': 'application/json',
      }

      // Step 1 — submit synthesis job
      const synthesizeRes = await fetch('https://apihost.ru/api/v1/synthesize', {
        method: 'POST',
        headers: apihostHeaders,
        body: JSON.stringify({
          data: [{
            lang: apihost_lang,
            speaker: Number(voice_id),
            text,
            rate: String(speech_rate),
            pitch: '1.0',
            type: 'mp3',
            pause: '0',
          }],
        }),
      })

      if (!synthesizeRes.ok) {
        const errBody = await synthesizeRes.text().catch(() => '')
        console.error('[generate/audio] APIHOST synthesize error:', synthesizeRes.status, errBody.slice(0, 200))
        return NextResponse.json({ ok: false, error: 'Ошибка отправки задачи APIHOST' }, { status: 502 })
      }

      const synthesizeJson = await synthesizeRes.json() as { process?: string; id?: string }
      const processId = synthesizeJson.process ?? synthesizeJson.id
      if (!processId) {
        return NextResponse.json({ ok: false, error: 'APIHOST не вернул ID задачи' }, { status: 502 })
      }

      // Step 2 — poll until status 200 (max ~4.5 minutes)
      let audioFileUrl: string | null = null
      for (let i = 0; i < 54; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        const checkRes = await fetch('https://apihost.ru/api/v1/process', {
          method: 'POST',
          headers: apihostHeaders,
          body: JSON.stringify({ process: processId }),
        })
        if (!checkRes.ok) continue
        const check = await checkRes.json() as { status?: number; message?: string; url?: string }
        if (check.status === 200) {
          audioFileUrl = check.message ?? check.url ?? null
          break
        }
      }

      if (!audioFileUrl) {
        return NextResponse.json({ ok: false, error: 'APIHOST: синтез занял слишком много времени' }, { status: 504 })
      }

      // Step 3 — download audio
      const dlRes = await fetch(audioFileUrl)
      if (!dlRes.ok) {
        return NextResponse.json({ ok: false, error: 'Ошибка загрузки аудио с APIHOST' }, { status: 502 })
      }
      audioBuffer = Buffer.from(await dlRes.arrayBuffer())

    } else {
      // ElevenLabs
      const styleExaggeration = typeof voice_style === 'number'
        ? voice_style
        : STYLE_EXAGGERATION[voice_style] ?? 0

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
        const errBody = await elevenRes.text().catch(() => '')
        console.error('[generate/audio] ElevenLabs error:', elevenRes.status, errBody.slice(0, 200))
        return NextResponse.json({ ok: false, error: 'Ошибка синтеза речи — проверьте настройки голоса' }, { status: 502 })
      }

      audioBuffer = Buffer.from(await elevenRes.arrayBuffer())
    }

    if (audioBuffer.byteLength === 0) {
      return NextResponse.json({ ok: false, error: 'Получен пустой аудио буфер' }, { status: 502 })
    }

    // Upload to Supabase Storage
    const serviceClient = createServiceClient()
    const storagePath = `${user.id}/${project_id ?? 'tmp'}/audio.mp3`

    const { error: uploadError } = await serviceClient.storage
      .from('audio')
      .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true })

    if (uploadError) {
      console.error('[generate/audio] Supabase upload error:', uploadError.message)
      return NextResponse.json({ ok: false, error: 'Ошибка загрузки аудио' }, { status: 500 })
    }

    const { data: { publicUrl } } = serviceClient.storage.from('audio').getPublicUrl(storagePath)

    await spendCredits(user.id, cost, `audio_${engine}`, project_id)

    if (project_id) {
      await supabase
        .from('projects')
        .update({ audio_url: publicUrl, voice_id, status: 'generating_subtitles' })
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    void trackEvent(user.id, 'step_completed', { step: 'audio', engine, project_id })
    return NextResponse.json({ ok: true, data: { audio_url: publicUrl } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[generate/audio] unexpected error:', msg)
    return NextResponse.json({ ok: false, error: 'Ошибка генерации аудио' }, { status: 500 })
  }
}
