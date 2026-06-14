import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { trackEvent } from '@/lib/analytics'
import { sendVideoReadyEmail } from '@/lib/email'
import { env } from '@/lib/env'
import type { SceneImage, SubtitleBlock, SubtitleStyle } from '@/lib/types'

export const maxDuration = 300

interface RenderRequest {
  project_id: string
  audio_url: string
  image_interval: number
  images: Pick<SceneImage, 'url' | 'timecode_start' | 'timecode_end'>[]
  subtitle_blocks?: SubtitleBlock[]
  subtitle_style?: Pick<SubtitleStyle, 'size' | 'color' | 'position' | 'background' | 'burnIn'>
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

    const check = await requireCredits(user.id, 'video', supabase)
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    const body: RenderRequest = await request.json()
    const { project_id, audio_url, image_interval, images, subtitle_blocks, subtitle_style } = body

    if (!project_id || !audio_url || !images?.length) {
      return NextResponse.json(
        { ok: false, error: 'Недостаточно данных для сборки видео' },
        { status: 400 }
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
        image_interval,
        images,
        subtitle_blocks,
        subtitle_style,
        project_id,
      }),
    })

    if (!renderRes.ok) {
      const errBody = await renderRes.json().catch(() => ({}))
      const msg =
        (errBody as { error?: string }).error ?? `Railway HTTP ${renderRes.status}`
      return NextResponse.json({ ok: false, error: msg }, { status: 502 })
    }

    const { video_url } = (await renderRes.json()) as { video_url: string }

    await supabase
      .from('projects')
      .update({ video_url, status: 'generating_seo' })
      .eq('id', project_id)
      .eq('user_id', user.id)

    await spendCredits(user.id, 2, 'video', project_id)
    void trackEvent(user.id, 'step_completed', { step: 'video', project_id })
    void trackEvent(user.id, 'video_downloaded', { project_id })

    // Fire-and-forget: send "video ready" email
    void (async () => {
      try {
        const svc = createServiceClient()
        const { data: profile } = await svc.from('profiles').select('email, full_name').eq('id', user.id).single()
        const { data: project } = await svc.from('projects').select('title').eq('id', project_id).single()
        if (profile?.email) {
          await sendVideoReadyEmail(
            { email: profile.email, name: profile.full_name },
            { id: project_id, title: project?.title ?? 'Без названия' },
          )
        }
      } catch (e) {
        console.error('[render] sendVideoReadyEmail error:', e)
      }
    })()

    return NextResponse.json({ ok: true, data: { video_url } })
  } catch (error) {
    console.error('[generate/video/render]', error)
    return NextResponse.json(
      { ok: false, error: 'Ошибка сборки видео' },
      { status: 500 }
    )
  }
}
