import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'

export async function GET() {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    console.log('[reports] GET user:', user.id)

    const svc = createServiceClient()
    const { data: reports, error } = await svc
      .from('analytics_reports')
      .select('id, report_type, title, query, result, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    console.log('[reports] count:', reports?.length ?? 0, 'error:', error?.message ?? 'none')

    if (error) {
      console.error('[reports] fetch error:', error.message)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, reports: reports ?? [] })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/reports] GET error:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { id?: string }
    const id = body.id?.trim()
    if (!id) return NextResponse.json({ ok: false, error: 'Не указан id' }, { status: 400 })

    const svc = createServiceClient()
    const { error } = await svc
      .from('analytics_reports')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/reports] DELETE error:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
