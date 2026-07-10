// TEMPORARY — delete after email sender verification
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { env } from '@/lib/env'

export async function POST(req: NextRequest) {
  if (req.headers.get('x-admin-secret') !== env('RAILWAY_API_SECRET')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const resend = new Resend(env('RESEND_API_KEY'))
  const from = env('RESEND_FROM_EMAIL') || 'Lefiro <noreply@lefiro.co>'
  const result = await resend.emails.send({
    from,
    to: 'khudyshkin.d@gmail.com',
    subject: 'Тест отправителя Lefiro — noreply@lefiro.co',
    html: '<p>Тестовое письмо после миграции домена. Отправитель: ' + from + '</p>',
  })
  return NextResponse.json({ from, result })
}
