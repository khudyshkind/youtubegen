import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'

// Temporary debug endpoint — REMOVE after task 9 verification
const ONE_TIME_TOKEN = 'lefiro_legal_check_856e59c'

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('t') !== ONE_TIME_TOKEN) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  try {
    const supabase = createServiceClient()

    // Probe which DB env vars are injected at runtime
    const envKeys = Object.keys(process.env).filter(k =>
      k.includes('POSTGRES') || k.includes('DATABASE') || k.includes('SUPABASE')
    )
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(not set)'

    const { data: lastUsers } = await supabase
      .from('profiles')
      .select('id, email, created_at')
      .order('created_at', { ascending: false })
      .limit(5)

    const testUser = lastUsers?.[0]

    const { data: rows, error: rowsError } = testUser
      ? await supabase
          .from('legal_acceptances')
          .select('document, version, accepted_at')
          .eq('user_id', testUser.id)
          .order('accepted_at', { ascending: false })
      : { data: null, error: null }

    const { data: all, error: allError } = await supabase
      .from('legal_acceptances')
      .select('user_id, document, version, accepted_at')
      .order('accepted_at', { ascending: false })
      .limit(20)

    return NextResponse.json({
      env_keys: envKeys,
      supabase_url_prefix: supabaseUrl.slice(0, 40),
      service_role_key_set: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      lastUsers: lastUsers?.map(u => ({ id: u.id.slice(0, 8) + '…', email: u.email, created_at: u.created_at })),
      testUser_acceptances: {
        count: rows?.length ?? 0,
        error: rowsError ? { code: rowsError.code, message: rowsError.message } : null,
        rows,
      },
      all_acceptances: {
        count: all?.length ?? 0,
        error: allError ? { code: allError.code, message: allError.message } : null,
        rows: all?.map(r => ({ ...r, user_id: r.user_id.slice(0, 8) + '…' })),
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
