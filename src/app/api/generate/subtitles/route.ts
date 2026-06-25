import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'
import type { SubtitleBlock } from '@/lib/types'

export const maxDuration = 120

interface SubtitlesRequest {
  audio_url: string
  project_id?: string
  language?: string
}

interface WhisperSegment {
  start: number
  end: number
  text: string
}

interface WhisperVerboseResponse {
  text: string
  segments: WhisperSegment[]
}

/** For Supabase private-bucket URLs, create a fresh 5-min signed URL via service client. */
async function resolveAudioUrl(rawUrl: string): Promise<string> {
  const supabaseOrigin = env('NEXT_PUBLIC_SUPABASE_URL')
  if (!rawUrl.startsWith(supabaseOrigin)) return rawUrl

  // Match /storage/v1/object/<type>/<bucket>/<path>
  const match = rawUrl.match(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/?]+)\/(.+?)(?:\?.*)?$/)
  if (!match) return rawUrl

  const [, bucket, objectPath] = match
  const service = createServiceClient()
  const { data, error } = await service.storage
    .from(bucket)
    .createSignedUrl(objectPath, 300) // 5 minutes — enough for Whisper

  if (error || !data?.signedUrl) {
    console.warn('[subtitles] could not create signed URL, using raw:', error?.message)
    return rawUrl
  }
  return data.signedUrl
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Необходима авторизация' },
        { status: 401 }
      )
    }

    // Require at least 1 minute worth of credits before transcription
    const minCost = CREDIT_COSTS.subtitles_per_minute
    const check = await requireCreditsAmount(user.id, minCost, supabase)
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    const { audio_url, project_id, language }: SubtitlesRequest = await request.json()

    console.log('[subtitles] audio_url:', audio_url?.slice(0, 120))
    console.log('[subtitles] project_id:', project_id, '| language:', language)

    // Resolve private Supabase URLs to a fresh signed URL
    const fetchUrl = await resolveAudioUrl(audio_url)
    console.log('[subtitles] fetching audio from:', fetchUrl.slice(0, 120))

    const audioResponse = await fetch(fetchUrl)
    console.log('[subtitles] audio response status:', audioResponse.status)

    if (!audioResponse.ok) {
      return NextResponse.json(
        { ok: false, error: `Не удалось загрузить аудиофайл (HTTP ${audioResponse.status})` },
        { status: 400 }
      )
    }

    const audioBuffer = await audioResponse.arrayBuffer()
    console.log('[subtitles] audio size bytes:', audioBuffer.byteLength)

    if (audioBuffer.byteLength > 25 * 1024 * 1024) {
      return NextResponse.json(
        { ok: false, error: 'Аудиофайл превышает лимит Whisper (25 MB)' },
        { status: 400 }
      )
    }

    const audioFile = new File([audioBuffer], 'audio.mp3', { type: 'audio/mpeg' })

    console.log('[subtitles] calling Whisper...')
    const openai = new OpenAI({ apiKey: env('OPENAI_API_KEY') })
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
      // Pass language only when explicitly known — omitting it lets Whisper auto-detect.
      // Hardcoding 'ru' as fallback caused Whisper to translate non-Russian audio into Russian.
      ...(language ? { language } : {}),
    }) as unknown as WhisperVerboseResponse

    console.log('[subtitles] whisper segments:', transcription.segments?.length ?? 0)

    const subtitle_blocks: SubtitleBlock[] = (transcription.segments ?? []).map(
      (seg) => ({
        start: Math.round(seg.start * 100) / 100,
        end: Math.round(seg.end * 100) / 100,
        text: seg.text.trim(),
      })
    )

    // Charge based on actual audio duration from Whisper segments
    const lastSegEnd = transcription.segments?.at(-1)?.end ?? 0
    const durationMinutes = lastSegEnd > 0 ? lastSegEnd / 60 : 1
    const cost = Math.max(minCost, Math.ceil(durationMinutes) * CREDIT_COSTS.subtitles_per_minute)
    await spendCredits(user.id, cost, 'subtitles', project_id)

    if (project_id) {
      await supabase
        .from('projects')
        .update({
          subtitle_blocks,
          status: 'generating_images',
        })
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ ok: true, data: { subtitle_blocks } })
  } catch (error) {
    console.error('[generate/subtitles]', error)
    const status = (error as { status?: number }).status
    if (status === 429) {
      return NextResponse.json(
        { ok: false, error: 'Превышена квота OpenAI — пополните баланс на platform.openai.com' },
        { status: 402 }
      )
    }
    return NextResponse.json(
      { ok: false, error: 'Ошибка генерации субтитров' },
      { status: 500 }
    )
  }
}
