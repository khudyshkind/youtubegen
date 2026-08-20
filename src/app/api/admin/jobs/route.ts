export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'

const ADMIN_EMAILS = ['khudyshkin.d@gmail.com', 'denis-region@mail.ru']

type RawOpLog = {
  id: string; user_id: string; project_id?: string | null
  op_type: string; provider?: string | null
  status: string; credits_spent?: number | null; credits_refunded?: number | null
  error_text?: string | null; started_at: string; completed_at?: string | null
}
type Profile = { id: string; email: string; plan: string }

// Map operation_log op_type to a top-level category for the type filter
function opTypeCategory(opType: string): string {
  if (opType === 'script' || opType === 'plan' || opType === 'repack' ||
      opType === 'seo' || opType === 'enhance_script' ||
      opType.startsWith('uniqueize_') || opType === 'style_analysis' ||
      opType === 'titles_by_niche' || opType === 'channel_analysis') return 'text'
  if (opType.startsWith('audio_')) return 'audio'
  if (opType.startsWith('image_') || opType === 'images') return 'image'
  if (opType === 'video_render') return 'video'
  if (opType === 'subtitles') return 'subtitles'
  if (opType === 'thumbnail') return 'thumbnail'
  return 'other'
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

  let query = svc
    .from('operation_log')
    .select('id, user_id, project_id, op_type, provider, status, credits_spent, credits_refunded, error_text, started_at, completed_at')
    .gte('started_at', cutoff)
    .order('started_at', { ascending: false })
    .limit(1000)

  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter)
  }

  const { data: rows, error } = await query

  if (error) {
    console.error('[admin/jobs] operation_log query error:', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const opRows = (rows ?? []) as RawOpLog[]

  // Fetch user profiles for email display
  const userIds = [...new Set(opRows.map(r => r.user_id).filter(Boolean))]
  const profileMap = new Map<string, Profile>()
  if (userIds.length > 0) {
    const { data: profiles } = await svc
      .from('profiles')
      .select('id, email, plan')
      .in('id', userIds)
    for (const p of (profiles ?? []) as Profile[]) profileMap.set(p.id, p)
  }

  const jobs = opRows
    .map(r => ({
      id:           r.id,
      op_type:      r.op_type,
      category:     opTypeCategory(r.op_type),
      provider:     r.provider ?? null,
      user_id:      r.user_id,
      project_id:   r.project_id ?? null,
      status:       r.status as 'running' | 'done' | 'failed',
      credits:      r.credits_spent ?? 0,
      credits_refunded: r.credits_refunded ?? 0,
      error:        r.error_text ?? null,
      started_at:   r.started_at,
      completed_at: r.completed_at ?? null,
      email:        profileMap.get(r.user_id)?.email ?? null,
      plan:         profileMap.get(r.user_id)?.plan ?? null,
    }))
    .filter(j => {
      if (typeFilter !== 'all' && j.category !== typeFilter) return false
      if (emailFilter && !(j.email ?? '').toLowerCase().includes(emailFilter)) return false
      return true
    })

  return NextResponse.json({ ok: true, jobs, total: jobs.length })
}
