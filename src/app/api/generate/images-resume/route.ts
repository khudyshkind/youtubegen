import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createServerSupabase } from '@/lib/supabase-server'
import { hasCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { CREDIT_COSTS } from '@/lib/types'

export const maxDuration = 30

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
  }

  const body = await request.json()
  const { resume_job_id, project_id, image_interval, image_style, custom_style, duration_sec, missing_count } = body

  if (!resume_job_id || !project_id) {
    return NextResponse.json({ ok: false, error: 'resume_job_id и project_id обязательны' }, { status: 400 })
  }

  // Credit check: at least 1 image worth of credits required.
  const costPerImage = CREDIT_COSTS.image_secretslider
  const minCost = costPerImage * Math.max(1, missing_count ?? 1)
  const enough = await hasCredits(user.id, minCost, supabase)
  if (!enough) {
    return NextResponse.json({ ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }, { status: 402 })
  }

  const railwayUrl = env('RAILWAY_VIDEO_SERVER_URL').replace(/\/$/, '')
  const railwaySecret = env('RAILWAY_API_SECRET')

  if (!railwayUrl || !railwaySecret) {
    return NextResponse.json({ ok: false, error: 'Railway не настроен' }, { status: 503 })
  }

  Sentry.setUser({ id: user.id })
  Sentry.setContext('resume', { project_id, resume_job_id })

  try {
    const railwayRes = await fetch(`${railwayUrl}/resume-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': railwaySecret,
      },
      body: JSON.stringify({
        project_id,
        user_id: user.id,
        resume_job_id,
        engine: 'secretslider',
        image_interval: image_interval ?? 10,
        image_style: image_style ?? null,
        custom_style: custom_style ?? null,
        duration_sec: duration_sec ?? null,
        cost_per_image: costPerImage,
      }),
      signal: AbortSignal.timeout(20_000),
    })

    if (!railwayRes.ok) {
      const errBody = await railwayRes.json().catch(() => ({})) as { error?: string }
      return NextResponse.json(
        { ok: false, error: errBody.error ?? `Railway HTTP ${railwayRes.status}` },
        { status: 502 },
      )
    }

    const data = await railwayRes.json() as { job_id: string; missing_count: number }

    return NextResponse.json({ ok: true, data: { job_id: data.job_id, missing_count: data.missing_count } })
  } catch (error) {
    console.error('[generate/images-resume] error:', error)
    Sentry.captureException(error)
    return NextResponse.json({ ok: false, error: 'Ошибка запуска догенерации иллюстраций' }, { status: 500 })
  }
}
