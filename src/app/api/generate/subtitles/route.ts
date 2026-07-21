import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { notifyError } from '@/lib/telegram'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'
import type { SubtitleBlock } from '@/lib/types'

export const maxDuration = 300

interface SubtitlesRequest {
  audio_url?: string
  // Tool flow: file already uploaded — createSignedUrl here (file exists at this point)
  storage_path?: string
  storage_bucket?: string
  project_id?: string
  language?: string
}

/** For Supabase private-bucket URLs, create a fresh signed URL via service client. */
async function resolveAudioUrl(rawUrl: string): Promise<string> {
  const supabaseOrigin = env('NEXT_PUBLIC_SUPABASE_URL')
  if (!rawUrl.startsWith(supabaseOrigin)) return rawUrl

  // Match /storage/v1/object/<type>/<bucket>/<path>
  const match = rawUrl.match(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/?]+)\/(.+?)(?:\?.*)?$/)
  if (!match) return rawUrl

  const [, bucket, objectPath] = match
  const service = createServiceClient()
  // 15 minutes — enough for Railway to download large audio files
  const { data, error } = await service.storage
    .from(bucket)
    .createSignedUrl(objectPath, 900)

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

    const { audio_url, storage_path, storage_bucket, project_id, language }: SubtitlesRequest = await request.json()

    Sentry.setUser({ id: user.id })
    Sentry.setContext('generate', { project_id, language, stage: 'subtitles' })

    console.log('[subtitles] audio_url:', audio_url?.slice(0, 120))
    console.log('[subtitles] storage_path:', storage_path, '| project_id:', project_id, '| language:', language)

    let fetchUrl: string
    if (storage_path && storage_bucket) {
      // Tool flow: file was just uploaded — createSignedUrl now (file exists at this point)
      const svc = createServiceClient()
      const { data: signData, error: signErr } = await svc.storage
        .from(storage_bucket)
        .createSignedUrl(storage_path, 900)
      if (signErr || !signData?.signedUrl) {
        console.error('[subtitles] createSignedUrl failed for storage_path:', signErr?.message)
        return NextResponse.json(
          { ok: false, error: 'Не удалось создать URL для аудиофайла' },
          { status: 500 },
        )
      }
      fetchUrl = signData.signedUrl
      console.log('[subtitles] signed URL created from storage_path')
    } else {
      // Studio flow: resolve existing audio_url (re-sign if Supabase private bucket URL)
      fetchUrl = await resolveAudioUrl(audio_url ?? '')
    }

    const railwayUrl = env('RAILWAY_VIDEO_SERVER_URL').replace(/\/$/, '')
    const railwaySecret = env('RAILWAY_API_SECRET')

    console.log('[subtitles] calling video-server /transcribe...')
    const transcribeRes = await fetch(`${railwayUrl}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': railwaySecret,
      },
      body: JSON.stringify({ audio_url: fetchUrl, language }),
      // 280s — leaves 20s for the rest of the handler within maxDuration=300
      signal: AbortSignal.timeout(280_000),
    })

    if (!transcribeRes.ok) {
      const errBody = await transcribeRes.text().catch(() => '')
      console.error('[subtitles] video-server /transcribe error:', transcribeRes.status, errBody.slice(0, 300))
      const status = transcribeRes.status
      if (status === 503) {
        return NextResponse.json(
          { ok: false, error: 'Сервис транскрипции не настроен — обратитесь к администратору' },
          { status: 503 }
        )
      }
      return NextResponse.json(
        { ok: false, error: 'Ошибка генерации субтитров' },
        { status: 502 }
      )
    }

    const transcribeJson = await transcribeRes.json() as {
      ok: boolean
      data?: { subtitle_blocks: SubtitleBlock[]; duration_seconds: number }
      error?: string
    }

    if (!transcribeJson.ok || !transcribeJson.data) {
      console.error('[subtitles] video-server returned error:', transcribeJson.error)
      return NextResponse.json(
        { ok: false, error: transcribeJson.error ?? 'Ошибка генерации субтитров' },
        { status: 502 }
      )
    }

    const { subtitle_blocks, duration_seconds } = transcribeJson.data
    console.log('[subtitles] segments:', subtitle_blocks.length, 'duration:', duration_seconds.toFixed(1) + 's')

    // Charge based on actual audio duration reported by Whisper
    const durationMinutes = duration_seconds > 0 ? duration_seconds / 60 : 1
    const cost = Math.max(minCost, Math.ceil(durationMinutes) * CREDIT_COSTS.subtitles_per_minute)
    await spendCredits(user.id, cost, 'subtitles', project_id)

    if (project_id) {
      await supabase
        .from('projects')
        .update({
          subtitle_blocks,
          status: 'draft',
        })
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    // Include duration_seconds and actual credits_spent so tool page can record exact cost
    return NextResponse.json({ ok: true, data: { subtitle_blocks, duration_seconds, credits_spent: cost } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[generate/subtitles]', error)
    Sentry.captureException(error)
    if (msg.includes('429') || (error as { status?: number }).status === 429) {
      return NextResponse.json(
        { ok: false, error: 'Сервис распознавания речи временно перегружен — попробуйте через несколько минут' },
        { status: 402 }
      )
    }
    await notifyError('/generate/subtitles', msg).catch(() => {})
    return NextResponse.json(
      { ok: false, error: 'Ошибка генерации субтитров' },
      { status: 500 }
    )
  }
}
