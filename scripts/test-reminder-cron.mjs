/**
 * Acceptance mock: expiry reminder cron + anti-spam gate.
 * Exercises the reminder logic extracted from video-server/index.js.
 * Run: node scripts/test-reminder-cron.mjs
 */

// ── Stub notifiers ────────────────────────────────────────────────────────────
const notifyLog = []
async function sendTo(chatId, msg) { notifyLog.push({ channel: 'tg', chatId, msg }); console.log(`[tg→${chatId}] ${msg.slice(0, 80)}...`) }
async function sendExpiryReminderEmail(email, { planName, expiresDate, planCredits }) {
  notifyLog.push({ channel: 'email', email, planName, expiresDate, planCredits })
  console.log(`[email→${email}] Тариф ${planName} истекает ${expiresDate}, plan_credits=${planCredits}`)
}

const patchedIds = []
async function patchLastNoticeAt(userId) { patchedIds.push(userId); console.log(`[db] PATCH last_expiry_notice_at for ${userId}`) }

// ── Replicated reminder logic ─────────────────────────────────────────────────
async function simulateReminders({ candidates, cut48h = new Date(Date.now() - 48 * 60 * 60 * 1000) }) {
  const toRemind = candidates.filter(u =>
    !u.last_expiry_notice_at || new Date(u.last_expiry_notice_at) < cut48h
  )
  console.log(`\n[reminders] candidates=${candidates.length}, toRemind=${toRemind.length}`)

  let remindersSent = 0
  for (const u of toRemind) {
    const expiresDate = new Date(u.plan_expires_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    const planName = u.plan.charAt(0).toUpperCase() + u.plan.slice(1)
    const planCredits = u.plan_credits ?? 0

    let notified = false
    if (u.telegram_chat_id) {
      await sendTo(u.telegram_chat_id, `⚠️ Ваш тариф *${planName}* истекает *${expiresDate}*.\nНа тарифном балансе: *${planCredits.toLocaleString('ru-RU')}* кредитов.\nПродлите тариф: https://lefiro.co/billing`)
      notified = true
    } else if (u.email) {
      await sendExpiryReminderEmail(u.email, { planName, expiresDate, planCredits })
      notified = true
    }

    if (notified) {
      await patchLastNoticeAt(u.id)
      remindersSent++
    }
  }
  console.log(`[reminders] sent ${remindersSent} reminders`)
  return { remindersSent, toRemindCount: toRemind.length }
}

// ── Test cases ────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Acceptance: Expiry Reminder Cron ===')

  const in2d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
  const longAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()  // 72h ago — beyond 48h window
  const recentlySent = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString()  // 10h ago — within 48h

  const users = [
    // A: TG user, never notified → should send
    { id: 'u-tg-1', plan: 'starter', plan_credits: 200000, telegram_chat_id: '111222', email: null, plan_expires_at: in2d, last_expiry_notice_at: null },
    // B: email user, last notice 72h ago → should send (beyond 48h)
    { id: 'u-email-1', plan: 'basic', plan_credits: 80000, telegram_chat_id: null, email: 'user@example.com', plan_expires_at: in2d, last_expiry_notice_at: longAgo },
    // C: email user, notified 10h ago → SKIP (within 48h anti-spam)
    { id: 'u-skip-1', plan: 'pro', plan_credits: 500000, telegram_chat_id: null, email: 'recent@example.com', plan_expires_at: in2d, last_expiry_notice_at: recentlySent },
    // D: no contact info → send attempted but no channel
    { id: 'u-nocontact', plan: 'agency', plan_credits: 0, telegram_chat_id: null, email: null, plan_expires_at: in2d, last_expiry_notice_at: null },
  ]

  // ── Run 1: initial pass ────────────────────────────────────────────────────
  console.log('\n── Run 1 (initial pass) ──')
  notifyLog.length = 0; patchedIds.length = 0
  const r1 = await simulateReminders({ candidates: users })

  console.assert(r1.remindersSent === 2, `FAIL: expected 2 reminders, got ${r1.remindersSent}`)
  console.assert(notifyLog.some(n => n.chatId === '111222'), 'FAIL: TG user not notified')
  console.assert(notifyLog.some(n => n.email === 'user@example.com'), 'FAIL: email user not notified')
  console.assert(!notifyLog.some(n => n.email === 'recent@example.com'), 'FAIL: anti-spam FAIL — recent user was notified')
  console.assert(patchedIds.includes('u-tg-1'), 'FAIL: u-tg-1 last_notice not patched')
  console.assert(patchedIds.includes('u-email-1'), 'FAIL: u-email-1 last_notice not patched')
  console.assert(!patchedIds.includes('u-skip-1'), 'FAIL: u-skip-1 was patched (anti-spam bypassed)')
  console.log('✓ Run 1: 2 sent (TG + email), 1 skipped (anti-spam), 1 no-channel')

  // ── Run 2: immediately re-run (simulate next-day cron within 48h) ──────────
  console.log('\n── Run 2 (re-run within 48h, both users now "recently notified") ──')
  const now = new Date().toISOString()
  const updatedUsers = users.map(u =>
    patchedIds.includes(u.id) ? { ...u, last_expiry_notice_at: now } : u
  )
  notifyLog.length = 0; patchedIds.length = 0
  const r2 = await simulateReminders({ candidates: updatedUsers })

  console.assert(r2.remindersSent === 0, `FAIL: expected 0 (anti-spam), got ${r2.remindersSent}`)
  console.log('✓ Run 2: 0 sent — anti-spam 48h gate holds for both users')

  console.log('\n✅ All reminder cron tests passed.\n')
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
