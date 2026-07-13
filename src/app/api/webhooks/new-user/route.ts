import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { sendTelegramAlert } from '@/lib/telegram'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.NEW_USER_WEBHOOK_SECRET

  // Secret not configured: log, return 200 so pg_net doesn't retry endlessly
  if (!secret) {
    console.error('[new-user-webhook] NEW_USER_WEBHOOK_SECRET not configured')
    return NextResponse.json({ ok: true })
  }

  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  const userId = String(body.id ?? '')
  const email = String(body.email ?? '')
  const provider = String(body.provider ?? 'email')

  if (!userId || !email) {
    return NextResponse.json({ ok: true, skipped: 'missing id or email' })
  }

  try {
    const svc = createServiceClient()
    const { count } = await svc
      .from('profiles')
      .select('*', { count: 'exact', head: true })

    const n = count ?? '?'
    const providerLabel = provider === 'google' ? 'Google' : 'email'

    const text = [
      `🎉 <b>Новый пользователь Lefiro</b>`,
      `Email: <code>${escapeHtml(email)}</code>`,
      `Вход: ${providerLabel}`,
      `Всего: #${n}`,
    ].join('\n')

    await sendTelegramAlert(text)
  } catch (err) {
    console.error('[new-user-webhook] failed (non-fatal):', err)
  }

  return NextResponse.json({ ok: true })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
