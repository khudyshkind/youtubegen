import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
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

    console.log('[video/render] sending to Railway:', {
      project_id,
      audio_url: audio_url?.slice(0, 80),
      images_count: images.length,
      subtitle_blocks_count: subtitle_blocks?.length ?? 0,
      subtitle_style_burnIn: subtitle_style?.burnIn ?? false,
      subtitle_style_size: subtitle_style?.size,
      subtitle_style_position: subtitle_style?.position,
    })

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

    return NextResponse.json({ ok: true, data: { video_url } })
  } catch (error) {
    console.error('[generate/video/render]', error)
    return NextResponse.json(
      { ok: false, error: 'Ошибка сборки видео' },
      { status: 500 }
    )
  }
}
