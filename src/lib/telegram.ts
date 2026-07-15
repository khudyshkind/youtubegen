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

// Send a billing-exhaustion alert to Telegram with 1-hour dedup via bot_settings.
// Safe to call with .catch(() => {}) — never throws to the caller.
export async function notifyBillingError(service: string, route: string): Promise<void> {
  try {
    const svc = createServiceClient()
    const { data } = await svc
      .from('bot_settings')
      .select('value')
      .eq('key', 'billing_alert_ts')
      .maybeSingle()
    const lastTs = data?.value ? new Date(data.value as string).getTime() : 0
    if (Date.now() - lastTs < 60 * 60 * 1000) return  // dedup: max one alert per hour
    await svc
      .from('bot_settings')
      .upsert({ key: 'billing_alert_ts', value: new Date().toISOString() }, { onConflict: 'key' })
  } catch {
    // dedup check failed — send alert anyway (better noisy than silent)
  }
  await sendTelegramAlert(
    `🔴 <b>Billing error: ${service}</b>\nRoute: <code>${route}</code>\n${new Date().toUTCString()}\n<a href="https://console.anthropic.com/settings/billing">Пополнить баланс →</a>`
  )
}
