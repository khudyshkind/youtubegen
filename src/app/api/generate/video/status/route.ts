import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { spendCredits } from '@/lib/credits'
import { trackEvent } from '@/lib/analytics'
import { sendVideoReadyEmail } from '@/lib/email'

export const maxDuration = 15

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const jobId = request.nextUrl.searchParams.get('job_id')
    const projectIdParam = request.nextUrl.searchParams.get('project_id')

    if (!jobId && !projectIdParam) {
      return NextResponse.json({ ok: false, error: 'Missing job_id or project_id' }, { status: 400 })
    }

    const svc = createServiceClient()

    // Resolve job: by job_id (normal polling) or by project_id (resume after reload)
    let job: { id: string; status: string; progress: number | null; video_url: string | null; error_message: string | null; project_id: string | null; user_id: string } | null = null

    if (jobId) {
      const { data, error } = await svc
        .from('video_jobs')
        .select('id, status, progress, video_url, error_message, project_id, user_id')
        .eq('id', jobId)
        .eq('user_id', user.id)
        .single()
      if (error || !data) {
        return NextResponse.json({ ok: false, error: 'Job not found' }, { status: 404 })
      }
      job = data
    } else {
      // Resume polling: find the latest non-failed job for this project
      const { data, error } = await svc
        .from('video_jobs')
        .select('id, status, progress, video_url, error_message, project_id, user_id')
        .eq('project_id', projectIdParam!)
        .eq('user_id', user.id)
        .neq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(1)
      if (error || !data?.length) {
        return NextResponse.json({ ok: false, error: 'No active job for this project' }, { status: 404 })
      }
      job = data[0]
    }

    // On completion: bridge video_jobs → projects and spend credits.
    //
    // Two separate UPDATEs to avoid the status-clobbering race:
    //   UPDATE #1 — credit gate: SET video_url WHERE video_url IS NULL RETURNING id.
    //               Status is NOT touched here, so a concurrent SEO write to
    //               status='completed' can never be overwritten by this request.
    //   UPDATE #2 — status advance: SET status='generating_seo'
    //               WHERE status='generating_video'. The WHERE on status ensures
    //               we never roll back a status that already moved past this step.
    if (job.status === 'completed' && job.video_url && job.project_id) {
      // UPDATE #1 — credit gate. Only video_url, status untouched.
      const { data: bridged, error: projectUpdateError } = await svc
        .from('projects')
        .update({ video_url: job.video_url })
        .eq('id', job.project_id)
        .is('video_url', null)
        .select('id')

      if (projectUpdateError) {
        // Surface grant/RLS errors immediately — silent failures here mean
        // video_url never lands in projects and credits are never spent.
        Sentry.captureException(new Error(`projects UPDATE failed: ${projectUpdateError.message}`), {
          extra: { code: projectUpdateError.code, hint: projectUpdateError.hint, project_id: job.project_id },
        })
        throw new Error(`projects update failed: ${projectUpdateError.message}`)
      }

      if (bridged && bridged.length > 0) {
        // Won the write race → spend credits exactly once
        await spendCredits(user.id, 2, 'video', job.project_id)
        void trackEvent(user.id, 'step_completed', { step: 'video', project_id: job.project_id })
        void trackEvent(user.id, 'video_downloaded', { project_id: job.project_id })

        // UPDATE #2 — advance status only if still at the video step.
        // No-op if status is already 'generating_seo' or 'completed'.
        await svc
          .from('projects')
          .update({ status: 'generating_seo' })
          .eq('id', job.project_id)
          .eq('status', 'generating_video')

        void (async () => {
          try {
            const { data: profile } = await svc
              .from('profiles')
              .select('email, full_name')
              .eq('id', user.id)
              .single()
            const { data: proj } = await svc
              .from('projects')
              .select('title')
              .eq('id', job.project_id)
              .single()
            if (profile?.email) {
              await sendVideoReadyEmail(
                { email: profile.email, name: profile.full_name },
                { id: job.project_id!, title: proj?.title ?? 'Без названия' },
              )
            }
          } catch (e) {
            console.error('[status] sendVideoReadyEmail error:', e)
          }
        })()
      }
    }

    return NextResponse.json({
      ok: true,
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      video_url: job.video_url ?? null,
      error_message: job.error_message ?? null,
    })
  } catch (error) {
    console.error('[generate/video/status]', error)
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
