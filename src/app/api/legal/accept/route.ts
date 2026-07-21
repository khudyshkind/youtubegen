import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

export async function POST() {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { error } = await supabase.from('legal_acceptances').insert([
      { user_id: user.id, document: 'offer',   version: '1.0' },
      { user_id: user.id, document: 'terms',   version: '1.0' },
      { user_id: user.id, document: 'privacy', version: '1.0' },
    ])

    if (error) {
      console.error('[legal/accept] insert error:', error)
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[legal/accept] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
