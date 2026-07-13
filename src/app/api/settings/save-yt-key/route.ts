import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { encryptKey } from '@/lib/crypto'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json() as { key?: string }
    const key = (body.key ?? '').trim()

    if (!key) return NextResponse.json({ ok: false, error: 'Key is required' }, { status: 400 })
    if (!key.startsWith('AIza') || key.length < 30 || key.length > 50) {
      return NextResponse.json({ ok: false, error: 'Invalid key format' }, { status: 400 })
    }

    // Validate once more server-side before saving
    const probeUrl = new URL('https://www.googleapis.com/youtube/v3/channels')
    probeUrl.searchParams.set('part', 'id')
    probeUrl.searchParams.set('id', 'UC_x5XG1OV2P6uZZ5FSM9Ttw')
    probeUrl.searchParams.set('key', key)
    const probeRes = await fetch(probeUrl.toString())
    if (!probeRes.ok) {
      return NextResponse.json({ ok: false, code: 'invalid_key', error: 'Key failed validation — not saved' }, { status: 400 })
    }

    const encrypted = encryptKey(key)

    // RLS own-update: user can only update their own row
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ encrypted_yt_key: encrypted })
      .eq('id', user.id)

    if (updateErr) {
      console.error('[save-yt-key] update error:', updateErr.message)
      return NextResponse.json({ ok: false, error: 'Failed to save key' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[save-yt-key] error:', msg)
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ encrypted_yt_key: null })
      .eq('id', user.id)

    if (updateErr) {
      console.error('[save-yt-key] delete error:', updateErr.message)
      return NextResponse.json({ ok: false, error: 'Failed to remove key' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[save-yt-key] delete error:', msg)
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 })
  }
}
