import { createServiceClient } from './supabase-server'

export async function sendTelegramAlert(text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const ownerId = process.env.TELEGRAM_OWNER_ID
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

// Generic generation-error alert with 1-hour dedup per route+error-class.
// Covers timeouts, overload (529), rate-limit (429), and unexpected crashes.
// Safe to call with .catch(() => {}) — never throws to the caller.
export async function notifyError(route: string, msg: string): Promise<void> {
  const errorClass = /timeout|TimeoutError|ETIMEDOUT/i.test(msg) ? 'timeout'
    : /529|overloaded/i.test(msg) ? 'overload'
    : /429|rate.?limit/i.test(msg) ? 'rate_limit'
    : 'error'
  try {
    const svc = createServiceClient()
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
      await sendTelegramAlert(
        `🟡 <b>Generation error</b>\nRoute: <code>${route}</code>\nClass: <b>${errorClass}</b>\n<code>${msg.slice(0, 200)}</code>\n${new Date().toUTCString()}`
      )
      return
    }
    const { error: insertErr } = await svc.from('bot_settings').insert({ key: alertKey, value: now })
    if (!insertErr) {
      await sendTelegramAlert(
        `🟡 <b>Generation error</b>\nRoute: <code>${route}</code>\nClass: <b>${errorClass}</b>\n<code>${msg.slice(0, 200)}</code>\n${new Date().toUTCString()}`
      )
    }
  } catch {
    await sendTelegramAlert(
      `🟡 <b>Generation error</b>\nRoute: <code>${route}</code>\nClass: <b>${errorClass}</b>\n<code>${msg.slice(0, 200)}</code>\n${new Date().toUTCString()}`
    ).catch(() => {})
  }
}

// Send a billing-exhaustion alert to Telegram with 1-hour dedup via bot_settings.
// Uses atomic UPDATE-if-old + INSERT-if-missing to avoid sending N alerts under parallel load.
// Safe to call with .catch(() => {}) — never throws to the caller.
export async function notifyBillingError(service: string, route: string): Promise<void> {
  try {
    const svc = createServiceClient()
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
      await sendTelegramAlert(
        `🔴 <b>Billing error: ${service}</b>\nRoute: <code>${route}</code>\n${new Date().toUTCString()}\n<a href="https://console.anthropic.com/settings/billing">Пополнить баланс →</a>`
      )
      return
    }

    // Row might not exist yet (first ever alert). INSERT; unique constraint ensures only one wins.
    const { error: insertErr } = await svc
      .from('bot_settings')
      .insert({ key: alertKey, value: now })

    if (!insertErr) {
      await sendTelegramAlert(
        `🔴 <b>Billing error: ${service}</b>\nRoute: <code>${route}</code>\n${new Date().toUTCString()}\n<a href="https://console.anthropic.com/settings/billing">Пополнить баланс →</a>`
      )
    }
    // If insertErr = duplicate key: another concurrent call already inserted, skip.
  } catch {
    // DB unreachable — send alert anyway (better noisy than silent)
    await sendTelegramAlert(
      `🔴 <b>Billing error: ${service}</b>\nRoute: <code>${route}</code>\n${new Date().toUTCString()}\n<a href="https://console.anthropic.com/settings/billing">Пополнить баланс →</a>`
    ).catch(() => {})
  }
}
