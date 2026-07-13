import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { sendTelegramAlert } from '@/lib/telegram'

const DEDUP_TTL_MS = 10 * 60 * 1000 // 10 minutes

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  try {
    const hmac = createHmac('sha256', secret)
    hmac.update(rawBody, 'utf8')
    const expected = Buffer.from(hmac.digest('hex'), 'utf8')
    const received = Buffer.from(signature, 'utf8')
    if (expected.length !== received.length) return false
    return timingSafeEqual(expected, received)
  } catch {
    return false
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function projectLabel(slug: string): string {
  if (slug === 'youtubegen-nextjs') return 'Next.js'
  if (slug === 'youtubegen-video-server') return 'video-server'
  return slug
}

function levelEmoji(level: string): string {
  return level === 'fatal' ? '💀' : level === 'error' ? '🔴' : level === 'warning' ? '🟡' : '⚪'
}

export async function POST(req: NextRequest) {
  const secret = process.env.SENTRY_WEBHOOK_SECRET
  if (!secret) {
    console.error('[sentry-webhook] SENTRY_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'not configured' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('sentry-hook-signature') ?? ''

  if (!signature || !verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  // Only notify on new issues; ignore resolved/assigned/updated actions
  if (payload.action !== 'created') {
    return NextResponse.json({ ok: true, skipped: 'action' })
  }

  const issue = (payload.data as Record<string, unknown>)?.issue as Record<string, unknown> | undefined
  if (!issue) return NextResponse.json({ ok: true, skipped: 'no issue' })

  const issueId = String(issue.id ?? '')
  if (!issueId) return NextResponse.json({ ok: true, skipped: 'no id' })

  // Deduplication: skip if we already sent a notification for this issue_id within TTL
  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - DEDUP_TTL_MS).toISOString()

  const { data: existing } = await supabase
    .from('sentry_alert_dedup')
    .select('last_sent_at')
    .eq('issue_id', issueId)
    .gte('last_sent_at', cutoff)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ ok: true, skipped: 'dedup' })
  }

  // Upsert before sending to prevent double-send on concurrent webhook deliveries
  await supabase
    .from('sentry_alert_dedup')
    .upsert({ issue_id: issueId, last_sent_at: new Date().toISOString() }, { onConflict: 'issue_id' })

  const title = String(issue.title ?? 'Unknown error')
  const project = (issue.project as Record<string, string> | undefined)?.slug ?? 'unknown'
  const level = String(issue.level ?? 'error')
  const permalink = String(issue.permalink ?? '')
  const culprit = String(
    (issue.culprit as string | undefined) ??
    ((issue.metadata as Record<string, string> | undefined)?.value ?? '')
  )

  const lines: string[] = [
    `${levelEmoji(level)} <b>${escapeHtml(projectLabel(project))}</b>`,
    `<code>${escapeHtml(title.slice(0, 200))}</code>`,
  ]
  if (culprit) lines.push(`<i>${escapeHtml(culprit.slice(0, 150))}</i>`)
  if (permalink) lines.push(`👉 <a href="${escapeHtml(permalink)}">Открыть в Sentry</a>`)

  await sendTelegramAlert(lines.join('\n'))

  return NextResponse.json({ ok: true })
}
