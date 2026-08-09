import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createServerSupabase } from '@/lib/supabase-server'
import { env } from '@/lib/env'
import type { SceneImage } from '@/lib/types'
import { mediaExpiryFromNow } from '@/lib/media-expiry'

export const maxDuration = 15

interface ImageJobStatus {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  scene_images?: SceneImage[] | null
  error_message?: string | null
  completed_at?: string | null
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('job_id')
  const projectId = searchParams.get('project_id')

  if (!jobId) {
    return NextResponse.json({ ok: false, error: 'job_id обязателен' }, { status: 400 })
  }

  const railwayUrl = env('RAILWAY_VIDEO_SERVER_URL').replace(/\/$/, '')
  const railwaySecret = env('RAILWAY_API_SECRET')

  if (!railwayUrl || !railwaySecret) {
    return NextResponse.json({ ok: false, error: 'Railway не настроен' }, { status: 503 })
  }

  try {
    const statusRes = await fetch(`${railwayUrl}/image-status/${jobId}`, {
      headers: { 'x-api-secret': railwaySecret },
      signal: AbortSignal.timeout(10_000),
    })

    if (!statusRes.ok) {
      if (statusRes.status === 404) {
        return NextResponse.json({ ok: false, error: 'Job не найден' }, { status: 404 })
      }
      return NextResponse.json({ ok: false, error: `Railway HTTP ${statusRes.status}` }, { status: 502 })
    }

    const job = await statusRes.json() as ImageJobStatus & { ok: boolean }

    // On completion, write scene_images back to the project so the studio reflects the result.
    // Guard: only if project_id is supplied and scene_images exist.
    if (job.status === 'completed' && job.scene_images?.length && projectId) {
      const { error: saveErr } = await supabase
        .from('projects')
        .update({
          scene_images: job.scene_images,
          status: 'draft',
        })
        .eq('id', projectId)
        .eq('user_id', user.id)
      if (saveErr) {
        console.error(`[images-async/status] project save failed for job ${jobId}:`, saveErr.message)
        Sentry.captureException(new Error(`images-async status project save: ${saveErr.message}`), {
          extra: { jobId, projectId },
        })
      } else {
        const newExpiry = mediaExpiryFromNow()
        await supabase
          .from('projects')
          .update({ media_expires_at: newExpiry })
          .eq('id', projectId)
          .eq('user_id', user.id)
          .or(`media_expires_at.is.null,media_expires_at.lt.${newExpiry}`)
          .catch(() => {})
      }
    }

    return NextResponse.json({
      ok: true,
      status: job.status,
      progress: job.progress,
      scene_images: job.scene_images ?? null,
      error_message: job.error_message ?? null,
      completed_at: job.completed_at ?? null,
    })
  } catch (error) {
    console.error('[generate/images-async/status] error:', error)
    Sentry.captureException(error)
    return NextResponse.json({ ok: false, error: 'Ошибка получения статуса' }, { status: 500 })
  }
}
