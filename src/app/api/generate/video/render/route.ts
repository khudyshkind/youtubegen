import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS, IMAGE_INTERVAL_MIN, IMAGE_INTERVAL_MAX } from '@/lib/types'
import { env } from '@/lib/env'
import type { SceneImage, SubtitleBlock, SubtitleStyle } from '@/lib/types'

export const maxDuration = 30

interface RenderRequest {
  project_id: string
  audio_url: string
  image_interval: number
  images: Pick<SceneImage, 'url' | 'timecode_start' | 'timecode_end' | 'engine'>[]
  subtitle_blocks?: SubtitleBlock[]
  subtitle_style?: Pick<SubtitleStyle, 'size' | 'color' | 'position' | 'background' | 'burnIn'>
  transition?: string
  transition_duration?: number
  effects?: string[]
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

    const body: RenderRequest = await request.json()
    const { project_id, audio_url, image_interval, images, subtitle_blocks, subtitle_style,
            transition, transition_duration, effects } = body
    const safeInterval = Math.max(IMAGE_INTERVAL_MIN, Math.min(IMAGE_INTERVAL_MAX, image_interval ?? 10))

    // Derive exact duration from request body — known upfront unlike subtitles
    const durationSec =
      subtitle_blocks && subtitle_blocks.length > 0
        ? subtitle_blocks[subtitle_blocks.length - 1].end
        : (images?.length ?? 0) * safeInterval
    const videoCost = Math.max(CREDIT_COSTS.video, Math.ceil(durationSec / 60) * CREDIT_COSTS.video)

    const check = await requireCreditsAmount(user.id, videoCost, supabase)
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    Sentry.setUser({ id: user.id })
    Sentry.setContext('generate', { project_id, stage: 'video_render', image_count: images?.length })

    if (!project_id || !audio_url || !images?.length) {
      return NextResponse.json(
        { ok: false, error: 'Недостаточно данных для сборки видео' },
        { status: 400 }
      )
    }

    // Block render if media have been purged — images/audio no longer exist in storage.
    // Re-generate illustrations and audio before assembling video.
    const { data: projCheck } = await supabase
      .from('projects')
      .select('media_purged_at')
      .eq('id', project_id)
      .eq('user_id', user.id)
      .single()
    if (projCheck?.media_purged_at) {
      return NextResponse.json(
        { ok: false, error: 'Медиа этого проекта были удалены автоматически — перегенерируйте иллюстрации и озвучку' },
        { status: 422 }
      )
    }

    // Guard: reject duplicate render if an active job already exists for this project.
    // Returns 409 with the active job_id so the client can resume polling instead of
    // creating a new job and double-charging credits.
    const svc = createServiceClient()
    const { data: activeJobs } = await svc
      .from('video_jobs')
      .select('id')
      .eq('project_id', project_id)
      .eq('user_id', user.id)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
    if (activeJobs?.length) {
      return NextResponse.json(
        { ok: false, error: 'Рендер уже выполняется — дождитесь завершения или обновите страницу', job_id: activeJobs[0].id },
        { status: 409 }
      )
    }

    // Mark project as "render in progress" BEFORE calling Railway.
    // This closes the race window: any page reload after this point will see
    // status='generating_video' and inferStep → step 7, never the old video.
    // Fatal: if the DB write fails we return 500 and skip Railway entirely —
    // no orphaned job, project state is unchanged, user can retry.
    // Trade-off: if Railway later fails, the old video_url is already gone.
    // That's acceptable — the user's explicit intent is to replace the video.
    const { error: resetError } = await supabase
      .from('projects')
      .update({ video_url: null, status: 'generating_video' })
      .eq('id', project_id)
      .eq('user_id', user.id)
    if (resetError) {
      Sentry.captureException(new Error(`projects reset failed: ${resetError.message}`), {
        extra: { project_id },
      })
      return NextResponse.json(
        { ok: false, error: 'Ошибка подготовки проекта к рендерингу' },
        { status: 500 },
      )
    }

    const railwayUrl = env('RAILWAY_VIDEO_SERVER_URL').replace(/\/$/, '')
    const railwaySecret = env('RAILWAY_API_SECRET')

    const renderRes = await fetch(`${railwayUrl}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': railwaySecret,
      },
      body: JSON.stringify({
        audio_url,
        image_interval: safeInterval,
        images,
        subtitle_blocks,
        subtitle_style,
        project_id,
        user_id: user.id,
        transition,
        transition_duration,
        effects,
      }),
    })

    if (!renderRes.ok) {
      const errBody = await renderRes.json().catch(() => ({}))
      const msg = (errBody as { error?: string }).error ?? `Railway HTTP ${renderRes.status}`
      return NextResponse.json({ ok: false, error: msg }, { status: 502 })
    }

    const { job_id } = (await renderRes.json()) as { job_id: string }

    await spendCredits(user.id, videoCost, 'video', project_id)

    // Record amount charged so refundVideoJobCredits can look it up atomically.
    const { error: chargeWriteErr } = await svc
      .from('video_jobs')
      .update({ credits_charged: videoCost })
      .eq('id', job_id)
    if (chargeWriteErr) {
      console.error(`[video/render] credits_charged write failed for job ${job_id}:`, chargeWriteErr.message)
      Sentry.captureException(new Error(`credits_charged write failed: ${chargeWriteErr.message}`), { extra: { job_id, videoCost } })
    }

    Sentry.setContext('generate', { project_id, stage: 'video_render', job_id, image_count: images?.length })
    return NextResponse.json({ ok: true, data: { job_id } })
  } catch (error) {
    console.error('[generate/video/render]', error)
    return NextResponse.json(
      { ok: false, error: 'Ошибка запуска рендеринга' },
      { status: 500 }
    )
  }
}
