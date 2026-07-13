/**
 * Acceptance test: Telegram notification on new user registration.
 *
 * Steps:
 *   1. Deploy with `git push` first (Vercel must be Ready)
 *   2. Run this script: node scripts/test-new-user-webhook.mjs
 *
 * Prerequisites in Vercel env:
 *   NEW_USER_WEBHOOK_SECRET — must be set
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_OWNER_ID — must be set
 *
 * Prerequisites in Supabase SQL editor (run once):
 *   CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
 *   ALTER DATABASE postgres SET app.new_user_webhook_secret = '<same value as NEW_USER_WEBHOOK_SECRET>';
 *   -- Then reload the handle_new_user() function (re-run schema.sql section or ALTER SESSION)
 *   SELECT pg_reload_conf();
 */

const APP_URL = 'https://lefiro.co'
const ONE_TIME_SECRET = 'nuw-test-2026-9f3e'

console.log('\n══ New-User Webhook Acceptance Test ══\n')
console.log(`App: ${APP_URL}`)
console.log('Calling test route...\n')

const res = await fetch(`${APP_URL}/api/test/new-user-webhook`, {
  headers: { 'x-test-secret': ONE_TIME_SECRET },
})

if (res.status === 403) {
  console.error('ERROR: Test route returned 403. Deploy the test route first, or secret mismatch.')
  process.exit(1)
}
if (res.status === 404) {
  console.error('ERROR: Test route not found (404). Deploy with `git push` first.')
  process.exit(1)
}

const data = await res.json()
console.log(`Summary: ${data.summary}\n`)

for (const r of data.results ?? []) {
  const icon = r.pass ? '✅' : '❌'
  console.log(`  ${icon} ${r.test}${r.detail ? ` — ${r.detail}` : ''}`)
}

if (data.note) {
  console.log(`\nNote: ${data.note}`)
}

console.log()
if (!data.ok) process.exit(1)
