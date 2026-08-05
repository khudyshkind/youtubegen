export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { env } from '@/lib/env'
import { randomBytes } from 'crypto'

// GET  — returns { ok, linked } — whether current user has telegram_chat_id set
// POST — issues a new binding token, invalidates older unused ones, returns { ok, link }
// DELETE — clears telegram_chat_id for current user

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const svc = createServiceClient()
  const { data: profile } = await svc
    .from('profiles')
    .select('telegram_chat_id')
    .eq('id', user.id)
    .single()

  return NextResponse.json({ ok: true, linked: !!profile?.telegram_chat_id })
}

export async function POST() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const botUsername = env('TELEGRAM_BOT_USERNAME')
  if (!botUsername) {
    return NextResponse.json({ ok: false, error: 'TELEGRAM_BOT_USERNAME not configured' }, { status: 503 })
  }

  const svc = createServiceClient()

  // Invalidate all existing unused tokens for this user
  await svc
    .from('tg_link_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('used_at', null)

  const token = randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

  const { error } = await svc.from('tg_link_tokens').insert({
    token,
    user_id: user.id,
    expires_at: expiresAt,
  })

  if (error) {
    console.error('[telegram/link] insert error:', error.message)
    return NextResponse.json({ ok: false, error: 'Failed to create token' }, { status: 500 })
  }

  const link = `https://t.me/${botUsername}?start=link_${token}`
  return NextResponse.json({ ok: true, link })
}

export async function DELETE(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const svc = createServiceClient()
  const { error } = await svc
    .from('profiles')
    .update({ telegram_chat_id: null })
    .eq('id', user.id)

  if (error) {
    console.error('[telegram/link] delete error:', error.message)
    return NextResponse.json({ ok: false, error: 'Failed to unlink' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
