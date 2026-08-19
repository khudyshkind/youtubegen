import { createServiceClient } from './supabase-server'
import { env } from './env'

export interface AlertCtx {
  userId?: string
  projectId?: string
}

export async function sendTelegramAlert(text: string): Promise<void> {
  const botToken = env('TELEGRAM_BOT_TOKEN')
  const ownerId = env('TELEGRAM_OWNER_ID')
  if (!botToken || !ownerId) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_OWNER_ID not set')
    return
  }
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: ownerId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  })
  if (!res.ok) console.error('[telegram] sendMessage failed:', await res.text().catch(() => ''))
}

export function isBillingError(msg: string): boolean {
  return (
    msg.includes('billing_error') ||
    msg.includes('credit balance') ||
    msg.includes('insufficient_credits') ||
    msg.includes('credit_balance_too_low')
  )
}

async function buildUserBlock(ctx?: AlertCtx): Promise<string> {
  const uid = ctx?.userId
  if (!uid) return '👤 <i>пользователь не определён</i>'
  try {
    const svc = createServiceClient()
    const { data } = await svc
      .from('profiles')
      .select('email, plan, plan_credits, purchased_credits')
      .eq('id', uid)
      .single()
    if (!data) return `👤 <i>пользователь не определён</i> <code>${uid.slice(0, 8)}</code>`
    const p = data as { email?: string; plan?: string; plan_credits?: number; purchased_credits?: number }
    const plan = p.plan ?? '?'
    const isPaying = plan !== 'free'
    const balance = (p.plan_credits ?? 0) + (p.purchased_credits ?? 0)
    const lines = [
      `👤 ${p.email ?? uid}`,
      `Тариф: <b>${plan}</b>${isPaying ? ' ✓' : ''}`,
      `Кредиты: ${new Intl.NumberFormat('ru-RU').format(balance)}`,
    ]
    if (ctx?.projectId) lines.push(`Проект: <code>${ctx.projectId.slice(0, 8)}</code>`)
    return lines.join('\n')
  } catch {
    return `👤 <i>пользователь не определён</i> <code>${uid.slice(0, 8)}</code>`
  }
}

// Generic generation-error alert with 1-hour dedup per route+error-class.
// Covers timeouts, overload (529), rate-limit (429), and unexpected crashes.
// Safe to call with .catch(() => {}) — never throws to the caller.
export async function notifyError(route: string, msg: string, ctx?: AlertCtx): Promise<void> {
  const errorClass = /timeout|TimeoutError|ETIMEDOUT/i.test(msg) ? 'timeout'
    : /529|overloaded/i.test(msg) ? 'overload'
    : /429|rate.?limit/i.test(msg) ? 'rate_limit'
    : 'error'
  const buildMsg = (userBlock: string) =>
    `🟡 <b>Generation error</b>\n\n${userBlock}\n\nRoute: <code>${route}</code>\nClass: <b>${errorClass}</b>\n<code>${msg.slice(0, 200)}</code>\n${new Date().toUTCString()}`
  try {
    const svc = createServiceClient()
    const userBlock = await buildUserBlock(ctx)
    const threshold = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const now = new Date().toISOString()
    const alertKey = `error_alert_ts:${route}:${errorClass}`
    const { data: updated } = await svc
      .from('bot_settings')
      .update({ value: now })
      .eq('key', alertKey)
      .lt('value', threshold)
      .select('key')
    if ((updated?.length ?? 0) > 0) {
      await sendTelegramAlert(buildMsg(userBlock))
      return
    }
    const { error: insertErr } = await svc.from('bot_settings').insert({ key: alertKey, value: now })
    if (!insertErr) {
      await sendTelegramAlert(buildMsg(userBlock))
    }
  } catch {
    const userBlock = ctx?.userId
      ? `👤 <code>${ctx.userId.slice(0, 8)}</code>`
      : '👤 <i>пользователь не определён</i>'
    await sendTelegramAlert(buildMsg(userBlock)).catch(() => {})
  }
}

// Send a notification to a specific user's Telegram chat.
// Reads telegram_chat_id from profiles at call time — safe to call after DB is updated.
// Safe to call with .catch(() => {}) — never throws to the caller.
export async function notifyUserTelegram(userId: string, text: string): Promise<void> {
  const botToken = env('TELEGRAM_BOT_TOKEN')
  if (!botToken) {
    console.error('[telegram] notifyUserTelegram: TELEGRAM_BOT_TOKEN not set')
    return
  }
  try {
    const svc = createServiceClient()
    const { data: profile } = await svc
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', userId)
      .single()
    const chatId = (profile as { telegram_chat_id?: string | null } | null)?.telegram_chat_id
    if (!chatId) {
      console.log(`[telegram] skip: no chat_id user=${userId}`)
      return
    }
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
    if (!res.ok) {
      console.warn('[telegram] notifyUser failed:', await res.text().catch(() => ''))
    } else {
      console.log(`[telegram] sent user=${userId}`)
    }
  } catch (e) {
    console.warn('[telegram] notifyUser error:', e instanceof Error ? e.message : String(e))
  }
}

// Send a billing-exhaustion alert to Telegram with 1-hour dedup via bot_settings.
// Uses atomic UPDATE-if-old + INSERT-if-missing to avoid sending N alerts under parallel load.
// Safe to call with .catch(() => {}) — never throws to the caller.
export async function notifyBillingError(service: string, route: string, ctx?: AlertCtx): Promise<void> {
  const buildMsg = (userBlock: string) =>
    `🔴 <b>Billing error: ${service}</b>\n\n${userBlock}\n\nRoute: <code>${route}</code>\n${new Date().toUTCString()}\n<a href="https://console.anthropic.com/settings/billing">Пополнить баланс →</a>`
  try {
    const svc = createServiceClient()
    const userBlock = await buildUserBlock(ctx)
    const threshold = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const now = new Date().toISOString()

    // Atomic: UPDATE only if the existing row is older than 1h. Returns the updated row.
    const alertKey = `billing_alert_ts:${service.toLowerCase()}`
    const { data: updated } = await svc
      .from('bot_settings')
      .update({ value: now })
      .eq('key', alertKey)
      .lt('value', threshold)
      .select('key')

    if ((updated?.length ?? 0) > 0) {
      // We won the race — exactly one concurrent call gets here.
      await sendTelegramAlert(buildMsg(userBlock))
      return
    }

    // Row might not exist yet (first ever alert). INSERT; unique constraint ensures only one wins.
    const { error: insertErr } = await svc
      .from('bot_settings')
      .insert({ key: alertKey, value: now })

    if (!insertErr) {
      await sendTelegramAlert(buildMsg(userBlock))
    }
    // If insertErr = duplicate key: another concurrent call already inserted, skip.
  } catch {
    // DB unreachable — send alert anyway (better noisy than silent)
    const userBlock = ctx?.userId
      ? `👤 <code>${ctx.userId.slice(0, 8)}</code>`
      : '👤 <i>пользователь не определён</i>'
    await sendTelegramAlert(buildMsg(userBlock)).catch(() => {})
  }
}
