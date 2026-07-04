import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { trackEvent } from '@/lib/analytics'

export const maxDuration = 15

type AudioJob = {
  id: string
  status: string
  progress: number | null
  result_url: string | null
  error: string | null
  project_id: string | null
  user_id: string
  credits_charged: number | null
  credits_refunded_at: string | null
}

const SELECT = 'id, status, progress, result_url, error, project_id, user_id, credits_charged, credits_refunded_at'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const jobId          = request.nextUrl.searchParams.get('job_id')
    const projectIdParam = request.nextUrl.searchParams.get('project_id')

    if (!jobId && !projectIdParam) {
      return NextResponse.json({ ok: false, error: 'Missing job_id or project_id' }, { status: 400 })
    }

    const svc = createServiceClient()
    let job: AudioJob | null = null

    if (jobId) {
      // Normal polling: resolve by job_id, enforce user ownership
      const { data, error } = await svc
        .from('audio_jobs')
        .select(SELECT)
        .eq('id', jobId)
        .eq('user_id', user.id)
        .single()
      if (error || !data) {
        return NextResponse.json({ ok: false, error: 'Job not found' }, { status: 404 })
      }
      job = data as AudioJob
    } else {
      // Resume after reload: find latest non-failed job for this project
      const { data, error } = await svc
        .from('audio_jobs')
        .select(SELECT)
        .eq('project_id', projectIdParam!)
        .eq('user_id', user.id)
        .neq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(1)
      if (error || !data?.length) {
        return NextResponse.json({ ok: false, error: 'No active audio job for this project' }, { status: 404 })
      }
      job = data[0] as AudioJob
    }

    // On failure: refund credits_charged exactly once.
    // Atomic guard: UPDATE WHERE credits_refunded_at IS NULL RETURNING id —
    // only the first concurrent poll wins the race; others see empty result.
    if (job.status === 'failed' && job.credits_charged && job.credits_charged > 0 && !job.credits_refunded_at) {
      const { data: refunded } = await svc
        .from('audio_jobs')
        .update({ credits_refunded_at: new Date().toISOString() })
        .eq('id', job.id)
        .is('credits_refunded_at', null)
        .select('id')

      if (refunded && refunded.length > 0) {
        // Won the write race → refund via direct RPC, bypassing PLAN_MAX_CREDITS cap
        // (same pattern as referral.ts — user paid for this synthesis, cap must not cut the refund)
        await svc.rpc('add_credits', {
          p_user_id:    user.id,
          p_amount:     job.credits_charged,
          p_operation:  'audio_refund',
          p_project_id: job.project_id ?? null,
        })
        console.log(`[audio/status] refunded ${job.credits_charged} credits to ${user.id} for failed job ${job.id}`)
        void trackEvent(user.id, 'audio_refunded', {
          job_id:     job.id,
          project_id: job.project_id,
          amount:     job.credits_charged,
        })
      }
    }

    return NextResponse.json({
      ok:         true,
      job_id:     job.id,
      status:     job.status,
      progress:   job.progress   ?? null,
      result_url: job.result_url ?? null,
      error:      job.error      ?? null,
    })

  } catch (error) {
    console.error('[generate/audio/status]', error)
    Sentry.captureException(error)
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
