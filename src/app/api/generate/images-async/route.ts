import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createServerSupabase } from '@/lib/supabase-server'
import { hasCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { CREDIT_COSTS, IMAGE_COUNT_MAX } from '@/lib/types'

export const maxDuration = 30

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
  }

  const body = await request.json()
  const {
    script, topic, duration_sec, image_count, project_id,
    image_interval, engine = 'secretslider', image_style, custom_style,
  } = body

  if (!script?.trim() || !topic?.trim()) {
    return NextResponse.json({ ok: false, error: 'script и topic обязательны' }, { status: 400 })
  }

  if (engine !== 'secretslider') {
    return NextResponse.json({ ok: false, error: 'Неверный движок генерации иллюстраций' }, { status: 400 })
  }

  const count = Math.max(1, Math.min(IMAGE_COUNT_MAX, image_count ?? 1))

  const costPerImage = CREDIT_COSTS.image_secretslider
  const totalCost = costPerImage * count

  // Check balance upfront — actual per-image deductions happen in processImageJob on Railway
  // after each successful upload (mirrors images/route.ts per-image charge pattern).
  const enough = await hasCredits(user.id, totalCost, supabase)
  if (!enough) {
    return NextResponse.json({ ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }, { status: 402 })
  }

  const railwayUrl = env('RAILWAY_VIDEO_SERVER_URL').replace(/\/$/, '')
  const railwaySecret = env('RAILWAY_API_SECRET')

  if (!railwayUrl || !railwaySecret) {
    return NextResponse.json({ ok: false, error: 'Railway не настроен' }, { status: 503 })
  }

  Sentry.setUser({ id: user.id })
  Sentry.setContext('generate', { project_id, engine, image_count: count })

  try {
    const railwayRes = await fetch(`${railwayUrl}/generate-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': railwaySecret,
      },
      body: JSON.stringify({
        project_id: project_id ?? null,
        user_id: user.id,
        engine,
        image_count: count,
        image_interval: image_interval ?? 10,
        image_style: image_style ?? null,
        custom_style: custom_style ?? null,
        script,
        topic,
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

    const { job_id } = await railwayRes.json() as { job_id: string }

    return NextResponse.json({ ok: true, data: { job_id } })
  } catch (error) {
    console.error('[generate/images-async] error:', error)
    Sentry.captureException(error)
    return NextResponse.json({ ok: false, error: 'Ошибка запуска генерации иллюстраций' }, { status: 500 })
  }
}
