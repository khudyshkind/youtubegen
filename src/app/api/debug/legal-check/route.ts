import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'

// Temporary debug endpoint — REMOVE after one use
const ONE_TIME_TOKEN = 'lefiro_legal_check_856e59c'

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('t') !== ONE_TIME_TOKEN) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  try {
    const supabase = createServiceClient()

    const { data: lastUsers } = await supabase
      .from('profiles')
      .select('id, email, created_at')
      .order('created_at', { ascending: false })
      .limit(5)

    const testUser = lastUsers?.[0]

    const { data: rows, error } = testUser
      ? await supabase
          .from('legal_acceptances')
          .select('*')
          .eq('user_id', testUser.id)
          .order('accepted_at', { ascending: false })
      : { data: null, error: null }

    const { data: all } = await supabase
      .from('legal_acceptances')
      .select('user_id, document, version, accepted_at')
      .order('accepted_at', { ascending: false })
      .limit(20)

    return NextResponse.json({
      lastUsers: lastUsers?.map(u => ({ id: u.id.slice(0, 8) + '…', email: u.email, created_at: u.created_at })),
      testUser_acceptances: { count: rows?.length ?? 0, error, rows },
      all_acceptances: { count: all?.length ?? 0, rows: all?.map(r => ({ ...r, user_id: r.user_id.slice(0, 8) + '…' })) },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
