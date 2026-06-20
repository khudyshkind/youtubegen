import { NextRequest, NextResponse } from 'next/server'
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
    if (!jobId) {
      return NextResponse.json({ ok: false, error: 'Missing job_id' }, { status: 400 })
    }

    const svc = createServiceClient()

    const { data: job, error } = await svc
      .from('video_jobs')
      .select('id, status, progress, video_url, error_message, project_id, user_id')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single()

    if (error || !job) {
      return NextResponse.json({ ok: false, error: 'Job not found' }, { status: 404 })
    }

    // On first completion: update project, spend credits, send email (idempotent via project.video_url check)
    if (job.status === 'completed' && job.video_url && job.project_id) {
      const { data: project } = await svc
        .from('projects')
        .select('video_url')
        .eq('id', job.project_id)
        .single()

      if (!project?.video_url) {
        // First time we see this completion — do post-completion actions
        await svc
          .from('projects')
          .update({ video_url: job.video_url, status: 'generating_seo' })
          .eq('id', job.project_id)

        await spendCredits(user.id, 2, 'video', job.project_id)
        void trackEvent(user.id, 'step_completed', { step: 'video', project_id: job.project_id })
        void trackEvent(user.id, 'video_downloaded', { project_id: job.project_id })

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
                { id: job.project_id, title: proj?.title ?? 'Без названия' },
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
