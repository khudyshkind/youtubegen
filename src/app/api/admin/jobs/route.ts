export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'

const ADMIN_EMAILS = ['khudyshkin.d@gmail.com', 'denis-region@mail.ru']

type RawAudioJob = {
  id: string; user_id: string; project_id?: string | null; engine?: string | null
  status: string; credits_charged?: number | null; error?: string | null
  created_at: string; completed_at?: string | null
}
type RawVideoJob = {
  id: string; user_id: string; project_id?: string | null
  status: string; credits_charged?: number | null; error_message?: string | null
  created_at: string; completed_at?: string | null
}
type RawImageJob = {
  id: string; user_id: string; project_id?: string | null; engine?: string | null
  status: string; credits_charged?: number | null; error_message?: string | null
  created_at: string; completed_at?: string | null
}
type Profile = { id: string; email: string; plan: string }

function normalizeStatus(raw: string): 'queued' | 'running' | 'done' | 'failed' {
  if (raw === 'pending') return 'queued'
  if (['processing', 'finalizing', 'awaiting_webhook'].includes(raw)) return 'running'
  if (raw === 'completed') return 'done'
  return 'failed'
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email || !ADMIN_EMAILS.includes(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const params = request.nextUrl.searchParams
  const days = Math.min(30, Math.max(1, parseInt(params.get('days') ?? '7', 10)))
  const statusFilter = params.get('status') ?? 'all'
  const typeFilter = params.get('type') ?? 'all'
  const emailFilter = (params.get('email') ?? '').toLowerCase().trim()

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const svc = createServiceClient()

  const [audioRes, videoRes, imageRes] = await Promise.all([
    typeFilter === 'all' || typeFilter === 'audio'
      ? svc.from('audio_jobs')
          .select('id, user_id, project_id, engine, status, credits_charged, error, created_at, completed_at')
          .gte('created_at', cutoff)
          .order('created_at', { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] as RawAudioJob[], error: null }),
    typeFilter === 'all' || typeFilter === 'video'
      ? svc.from('video_jobs')
          .select('id, user_id, project_id, status, credits_charged, error_message, created_at, completed_at')
          .gte('created_at', cutoff)
          .order('created_at', { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] as RawVideoJob[], error: null }),
    typeFilter === 'all' || typeFilter === 'image'
      ? svc.from('image_jobs')
          .select('id, user_id, project_id, engine, status, credits_charged, error_message, created_at, completed_at')
          .gte('created_at', cutoff)
          .order('created_at', { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] as RawImageJob[], error: null }),
  ])

  const audioJobs = (audioRes.data ?? []) as RawAudioJob[]
  const videoJobs = (videoRes.data ?? []) as RawVideoJob[]
  const imageJobs = (imageRes.data ?? []) as RawImageJob[]

  const allUserIds = [...new Set([
    ...audioJobs.map(j => j.user_id),
    ...videoJobs.map(j => j.user_id),
    ...imageJobs.map(j => j.user_id),
  ].filter(Boolean))]

  const profileMap = new Map<string, Profile>()
  if (allUserIds.length > 0) {
    const { data: profiles } = await svc
      .from('profiles')
      .select('id, email, plan')
      .in('id', allUserIds)
    for (const p of (profiles ?? []) as Profile[]) profileMap.set(p.id, p)
  }

  const unified = [
    ...audioJobs.map(j => ({
      id: j.id, type: 'audio' as const,
      user_id: j.user_id, project_id: j.project_id ?? null,
      engine: j.engine ?? null,
      status_raw: j.status, status: normalizeStatus(j.status),
      credits: j.credits_charged ?? 0,
      error: j.error ?? null,
      created_at: j.created_at, completed_at: j.completed_at ?? null,
    })),
    ...videoJobs.map(j => ({
      id: j.id, type: 'video' as const,
      user_id: j.user_id, project_id: j.project_id ?? null,
      engine: null,
      status_raw: j.status, status: normalizeStatus(j.status),
      credits: j.credits_charged ?? 0,
      error: j.error_message ?? null,
      created_at: j.created_at, completed_at: j.completed_at ?? null,
    })),
    ...imageJobs.map(j => ({
      id: j.id, type: 'image' as const,
      user_id: j.user_id, project_id: j.project_id ?? null,
      engine: j.engine ?? null,
      status_raw: j.status, status: normalizeStatus(j.status),
      credits: j.credits_charged ?? 0,
      error: j.error_message ?? null,
      created_at: j.created_at, completed_at: j.completed_at ?? null,
    })),
  ]
    .map(j => ({
      ...j,
      email: profileMap.get(j.user_id)?.email ?? null,
      plan: profileMap.get(j.user_id)?.plan ?? null,
    }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .filter(j => {
      if (statusFilter !== 'all' && j.status !== statusFilter) return false
      if (emailFilter && !(j.email ?? '').toLowerCase().includes(emailFilter)) return false
      return true
    })

  return NextResponse.json({ ok: true, jobs: unified, total: unified.length })
}
