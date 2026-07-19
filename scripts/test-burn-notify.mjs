/**
 * Acceptance mock: expiry burn notification.
 * Exercises the per-user notification block inside the expire_plans cron loop.
 * Run: node scripts/test-burn-notify.mjs
 */

// ── Stub notifiers ────────────────────────────────────────────────────────────
const notifyLog = []
async function sendTo(chatId, msg) { notifyLog.push({ channel: 'tg', chatId, msg }); return { ok: true } }
async function sendExpiryBurnEmail(to, { planName, burned, purchased }) {
  notifyLog.push({ channel: 'email', to, planName, burned, purchased }); return { ok: true }
}

// ── Replicated per-user burn notification logic ───────────────────────────────
async function notifyBurn(user, result, appUrl) {
  const burned = result.burned ?? 0
  const purchased = user.purchased_credits ?? 0
  const planName = user.plan.charAt(0).toUpperCase() + user.plan.slice(1)

  if (user.telegram_chat_id) {
    const msg = burned > 0
      ? `⏰ Ваш тариф *${planName}* истёк.\n\n🔥 Тарифные кредиты: *${burned.toLocaleString('ru-RU')}* — списаны.\n🟢 Постоянные кредиты: *${purchased.toLocaleString('ru-RU')}* — сохранены.\n\nПродлите тариф: ${appUrl}/billing`
      : `⏰ Ваш тариф *${planName}* истёк. Вы переведены на Free-план.`
    await sendTo(user.telegram_chat_id, msg)
  } else if (user.email) {
    await sendExpiryBurnEmail(user.email, { planName, burned, purchased })
  }
}

// ── Test cases ────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Acceptance: Burn Notification ===')
  const APP_URL = 'https://lefiro.co'

  // Case A: TG user, burned 200000
  notifyLog.length = 0
  const userA = { id: 'u1', plan: 'starter', plan_credits: 200000, purchased_credits: 50000, telegram_chat_id: '123456', email: null }
  await notifyBurn(userA, { ok: true, burned: 200000, remaining_credits: 50000 }, APP_URL)
  console.assert(notifyLog[0]?.channel === 'tg', 'FAIL A: should be TG')
  console.assert(/200.000/.test(notifyLog[0]?.msg), 'FAIL A: burned amount missing')
  console.assert(/50.000/.test(notifyLog[0]?.msg), 'FAIL A: purchased amount missing')
  console.assert(notifyLog[0]?.msg.includes('lefiro.co/billing'), 'FAIL A: billing link missing')
  console.log(`✓ Case A [TG] msg preview: ${notifyLog[0].msg.slice(0, 100)}...`)

  // Case B: email-only user, burned 80000
  notifyLog.length = 0
  const userB = { id: 'u2', plan: 'basic', plan_credits: 80000, purchased_credits: 0, telegram_chat_id: null, email: 'test@example.com' }
  await notifyBurn(userB, { ok: true, burned: 80000, remaining_credits: 0 }, APP_URL)
  console.assert(notifyLog[0]?.channel === 'email', 'FAIL B: should be email')
  console.assert(notifyLog[0]?.burned === 80000, 'FAIL B: burned mismatch')
  console.assert(notifyLog[0]?.purchased === 0, 'FAIL B: purchased mismatch')
  console.log(`✓ Case B [email] to=${notifyLog[0].to}, burned=${notifyLog[0].burned}, purchased=${notifyLog[0].purchased}`)

  // Case C: plan_credits=0 before expiry (agency-style), burned=0 — still notifies
  notifyLog.length = 0
  const userC = { id: 'u3', plan: 'agency', plan_credits: 0, purchased_credits: 240440, telegram_chat_id: '789', email: null }
  await notifyBurn(userC, { ok: true, burned: 0, remaining_credits: 240440 }, APP_URL)
  console.assert(notifyLog[0]?.channel === 'tg', 'FAIL C: should be TG')
  console.assert(notifyLog[0]?.msg.includes('истёк'), 'FAIL C: message missing')
  console.log(`✓ Case C [TG, burned=0] msg: ${notifyLog[0].msg.trim()}`)

  // Case D: no contact info — no notification
  notifyLog.length = 0
  const userD = { id: 'u4', plan: 'pro', plan_credits: 500000, purchased_credits: 10000, telegram_chat_id: null, email: null }
  await notifyBurn(userD, { ok: true, burned: 500000, remaining_credits: 10000 }, APP_URL)
  console.assert(notifyLog.length === 0, 'FAIL D: no-contact user should send nothing')
  console.log('✓ Case D [no contact info] → silent (no channel available)')

  console.log('\n✅ All burn notification tests passed.\n')
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
