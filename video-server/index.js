'use strict'

// Strips BOM (U+FEFF, char code 65279) and trims whitespace.
// Mirrors src/lib/env.ts — duplicated here because video-server is standalone CJS with no shared build.
function env(key) {
  const val = process.env[key] ?? ''
  return (val.charCodeAt(0) === 0xfeff ? val.slice(1) : val).trim()
}

const STARTED_AT = new Date().toISOString()

// Sentry must be initialized before all other requires
let Sentry
try {
  const SentryPkg = require('@sentry/node')
  SentryPkg.init({
    dsn: env('SENTRY_DSN'),
    tracesSampleRate: 0,
    defaultIntegrations: false,
    integrations: [],
    debug: false,
  })
  console.log('[sentry] initialized, DSN present:', !!env('SENTRY_DSN'))
  Sentry = SentryPkg
} catch (e) {
  console.warn('[sentry] unavailable:', e.message)
  Sentry = {
    captureException: () => {},
    captureMessage: () => {},
    withScope: (fn) => fn({ setContext: () => {}, setUser: () => {} }),
    setupExpressErrorHandler: () => {},
    setUser: () => {},
    setContext: () => {},
  }
}

const express = require('express')
const { execFile, execSync, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const zlib = require('zlib')
const AnthropicPkg = require('@anthropic-ai/sdk')
const Anthropic = AnthropicPkg.default ?? AnthropicPkg
const { Readable } = require('stream')
const cron = require('node-cron')
const RssParser = require('rss-parser')
// Image style configs and scene prompts — single source of truth shared with Next.js via JSON files.
const { STYLE_CONFIGS: IMG_STYLE_CONFIGS, DEFAULT_STYLE_CONFIG: IMG_DEFAULT_STYLE } = require('./image-style-configs.json')
const { scenesPromptPhoto: IMG_SCENES_SYSTEM_PROMPT_PHOTO, scenesPromptIllustration: IMG_SCENES_SYSTEM_PROMPT_ILLUSTRATION } = require('./image-scene-prompts.json')
// R2 upload uses Node's native https + manual AWS SigV4 (no SDK dependency)

// Ensure pg_dump is available at startup (Docker build cache may skip the apt-get layer)
try {
  execSync('pg_dump --version', { stdio: 'pipe' })
  console.log('[startup] pg_dump available')
} catch {
  console.log('[startup] pg_dump not found, installing postgresql-client...')
  try {
    execSync('apt-get update -qq && apt-get install -y --no-install-recommends postgresql-client', { stdio: 'pipe' })
    console.log('[startup] postgresql-client installed:', execSync('pg_dump --version', { stdio: 'pipe' }).toString().trim())
  } catch (e) {
    console.warn('[startup] postgresql-client install failed:', e.message)
  }
}

const app = express()
app.use(express.json({ limit: '2mb' }))

const API_SECRET            = env('RAILWAY_API_SECRET')
const SUPABASE_URL          = env('NEXT_PUBLIC_SUPABASE_URL')
const SUPABASE_SERVICE_KEY  = env('SUPABASE_SERVICE_ROLE_KEY')

const VGF_API_KEY = env('VGF_API_KEY')

// Max parallel clip-encode submissions to VGF. Too high causes 504s on VGF's edge proxy.
const VGF_CLIP_CONCURRENCY = 12
// Retry count for transient HTTP 5xx errors on VGF submit (not job execution).
const VGF_SUBMIT_RETRIES = 3
// Active render jobs: used by SIGTERM handler to annotate phase/progress before exit.
// Keys = jobId, values = { phase, clipsDone, totalClips }
const renderActiveJobs = new Map()

const VERCEL_TOKEN = env('VERCEL_TOKEN')

// ── Russia payment config ─────────────────────────────────────────────────────
const USDT_TRC20  = env('USDT_TRC20')  || 'TW6Z6iZECebHe764YCKAsv5MfVFG6G947L'
const USDT_ERC20  = env('USDT_ERC20')  || '0x0f8d57d74367c4379b809399b1205f587f46104a'
const APP_URL     = env('APP_URL')     || 'https://lefiro.co'

// ── Telegram config ───────────────────────────────────────────────────────────
const BOT_TOKEN  = env('TELEGRAM_BOT_TOKEN')
const CHANNEL_ID = env('TELEGRAM_CHANNEL_ID')
const OWNER_ID   = env('TELEGRAM_OWNER_ID')
const SERVER_URL = env('RAILWAY_PUBLIC_DOMAIN')
  ? `https://${env('RAILWAY_PUBLIC_DOMAIN')}`
  : 'https://ytgen-video-server-production.up.railway.app'

// ── AI consultant ──────────────────────────────────────────────────────────────
let lefiroKB = null
try {
  lefiroKB = fs.readFileSync(path.join(__dirname, 'knowledge/lefiro_kb_bot.md'), 'utf8')
  console.log('[ai-consultant] KB loaded, chars:', lefiroKB.length)
} catch (e) {
  console.warn('[ai-consultant] KB file not found, consultant disabled:', e.message)
}
const aiRateLimit = new Map() // chatId → [timestamps]; cleared by natural GC on eviction

// ── Media retention policy ────────────────────────────────────────────────────
// Single unified threshold: all plans, all users — no plan-based distinctions.
// Env: RETENTION_MEDIA_HOURS (default 72).
// Legacy RETENTION_MEDIA_FREE_HOURS / RETENTION_MEDIA_PAID_HOURS are ignored;
// set RETENTION_MEDIA_HOURS=72 in Railway Variables (remove the legacy pair).
const RETENTION_MEDIA_HOURS = parseInt(env('RETENTION_MEDIA_HOURS') || '72')

// Compute when a project's media should expire (ISO string).
// Source of truth used by cron (writes media_expires_at to DB) and UI (countdown badge).
function computeMediaExpiry(updatedAt) {
  return new Date(new Date(updatedAt).getTime() + RETENTION_MEDIA_HOURS * 3_600_000).toISOString()
}

// ── R2 S3-compatible helpers for retention cleanup ────────────────────────────
// Mirrors the AWS4 signing used in uploadVideoToR2 but for ListObjectsV2 and
// DeleteObjects.  Returns [] / noop when R2 is not configured so callers are safe.

async function r2ListObjects(prefix) {
  const accountId = env('R2_ACCOUNT_ID')
  const bucket    = env('R2_BUCKET')
  const accessKey = env('R2_ACCESS_KEY_ID')
  const secretKey = env('R2_SECRET_ACCESS_KEY')
  if (!accountId || !bucket || !accessKey || !secretKey) return []

  const host     = `${accountId}.r2.cloudflarestorage.com`
  const now      = new Date()
  const amzDate  = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStr  = amzDate.slice(0, 8)
  const scope    = `${dateStr}/auto/s3/aws4_request`
  const qs       = `list-type=2&prefix=${encodeURIComponent(prefix)}`
  const urlPath  = `/${bucket}`
  const hash     = 'UNSIGNED-PAYLOAD'
  const canonHdr = `host:${host}\nx-amz-content-sha256:${hash}\nx-amz-date:${amzDate}\n`
  const signHdr  = 'host;x-amz-content-sha256;x-amz-date'
  const canonReq = ['GET', urlPath, qs, canonHdr, signHdr, hash].join('\n')
  const hmacFn   = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const sigKey   = hmacFn(hmacFn(hmacFn(hmacFn(`AWS4${secretKey}`, dateStr), 'auto'), 's3'), 'aws4_request')
  const sig      = crypto.createHmac('sha256', sigKey).update(
    ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonReq).digest('hex')].join('\n')
  ).digest('hex')
  const auth = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signHdr}, Signature=${sig}`

  const res = await fetch(`https://${host}${urlPath}?${qs}`, {
    headers: { 'x-amz-date': amzDate, 'x-amz-content-sha256': hash, Authorization: auth },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`r2List: HTTP ${res.status} ${await res.text().catch(() => '')}`)
  const xml = await res.text()
  // Parse <Contents> blocks — Key always precedes Size in ListObjectsV2 response
  const objects = []
  const rx = /<Contents>([\s\S]*?)<\/Contents>/g
  let cm
  while ((cm = rx.exec(xml)) !== null) {
    const block = cm[1]
    const key   = (/<Key>([^<]+)<\/Key>/.exec(block)  ?? [])[1]
    const size  = (/<Size>(\d+)<\/Size>/.exec(block)  ?? [])[1]
    if (key && size !== undefined) objects.push({ key, size: parseInt(size, 10) })
  }
  return objects
}

async function r2DeleteObjects(keys) {
  if (!keys.length) return
  const accountId = env('R2_ACCOUNT_ID')
  const bucket    = env('R2_BUCKET')
  const accessKey = env('R2_ACCESS_KEY_ID')
  const secretKey = env('R2_SECRET_ACCESS_KEY')
  if (!accountId || !bucket || !accessKey || !secretKey) throw new Error('R2 env vars not set')

  const host     = `${accountId}.r2.cloudflarestorage.com`
  const xmlBody  = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${
    keys.map(k => `<Object><Key>${k}</Key></Object>`).join('')
  }</Delete>`
  const bodyHash = crypto.createHash('sha256').update(xmlBody).digest('hex')
  const now      = new Date()
  const amzDate  = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStr  = amzDate.slice(0, 8)
  const scope    = `${dateStr}/auto/s3/aws4_request`
  const qs       = 'delete='
  const urlPath  = `/${bucket}`
  const canonHdr = `content-type:application/xml\nhost:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n`
  const signHdr  = 'content-type;host;x-amz-content-sha256;x-amz-date'
  const canonReq = ['POST', urlPath, qs, canonHdr, signHdr, bodyHash].join('\n')
  const hmacFn   = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const sigKey   = hmacFn(hmacFn(hmacFn(hmacFn(`AWS4${secretKey}`, dateStr), 'auto'), 's3'), 'aws4_request')
  const sig      = crypto.createHmac('sha256', sigKey).update(
    ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonReq).digest('hex')].join('\n')
  ).digest('hex')
  const auth = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signHdr}, Signature=${sig}`

  const res = await fetch(`https://${host}${urlPath}?delete=`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml',
      'x-amz-date': amzDate,
      'x-amz-content-sha256': bodyHash,
      Authorization: auth,
    },
    body: xmlBody,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`r2Delete: HTTP ${res.status} ${await res.text().catch(() => '')}`)
}

// ── Monitor config ────────────────────────────────────────────────────────────
const RSS_SOURCES = [
  { url: 'https://vc.ru/rss',                                                  name: 'vc.ru',       delayMs: 0 },
  { url: 'https://habr.com/ru/rss/hubs/machine_learning/articles/',            name: 'Habr ML',     delayMs: 0 },
  { url: 'https://habr.com/ru/rss/hubs/artificial_intelligence/articles/',     name: 'Habr AI',     delayMs: 0 },
  { url: 'https://blog.youtube/rss',                                            name: 'YouTube Blog', delayMs: 0 },
  { url: 'https://old.reddit.com/r/youtubers/.rss',                            name: 'r/youtubers', delayMs: 3000 },
  { url: 'https://old.reddit.com/r/artificial/.rss',                           name: 'r/artificial', delayMs: 3000 },
  { url: 'https://old.reddit.com/r/ChatGPT/.rss',                              name: 'r/ChatGPT',   delayMs: 3000 },
]

const KEYWORDS = [
  'youtube', 'автоматизация', 'нейросеть', 'ии', 'ai',
  'блогер', 'контент', 'видео', 'монетизация',
  'искусственный интеллект', 'chatgpt', 'midjourney',
]

// ── Supabase REST helpers (bot tables) ───────────────────────────────────────
function sbHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  }
}

async function sbGet(table, qs = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${qs ? `?${qs}` : ''}`
  const res = await fetch(url, { headers: sbHeaders() })
  if (!res.ok) throw new Error(`sbGet ${table}: ${res.status} ${await res.text().catch(() => '')}`)
  return res.json()
}

async function sbPost(table, body, extra = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${extra ? `?${extra}` : ''}`
  const res = await fetch(url, { method: 'POST', headers: sbHeaders(), body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`sbPost ${table}: ${res.status} ${await res.text().catch(() => '')}`)
  return res.json()
}

async function sbUpsert(table, body, conflictCol) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictCol}`
  const headers = { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=representation' }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`sbUpsert ${table}: ${res.status} ${await res.text().catch(() => '')}`)
  return res.json()
}

async function sbPatch(table, qs, body) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${qs}`
  const res = await fetch(url, { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`sbPatch ${table}: ${res.status} ${await res.text().catch(() => '')}`)
  return res.status === 204 ? [] : res.json()
}

async function updateJob(jobId, data) {
  try {
    const payload = data.phase !== undefined
      ? { ...data, phase_updated_at: new Date().toISOString() }
      : data
    await sbPatch('video_jobs', `id=eq.${jobId}`, payload)
  } catch (e) {
    console.error(`[job:${jobId}] updateJob failed:`, e.message)
    Sentry.captureException(e, { extra: { jobId, data } })
  }
}

// Refresh projects.updated_at so the watchdog (updated_at < now−40min) does not
// kill a legitimately long render (e.g. 4×300s Ken Burns + mux + subtitle burn).
// Guard: &status=eq.generating_video so a watchdog-killed project is not resurrected.
// Errors are logged but never thrown — a missed heartbeat is better than a crashed render.
async function heartbeatProject(projectId) {
  if (!projectId) return
  try {
    await sbPatch('projects', `id=eq.${projectId}&status=eq.generating_video`, { status: 'generating_video' })
  } catch (e) {
    console.error('[heartbeat]', projectId, e.message)
  }
}

// Returns a throttled heartbeat fn for use inside Stage 2 clip waves and concat/merge
// loops — keeps projects.updated_at fresh without hammering Supabase on every operation.
// Max one real heartbeat per 30 s per job; misses are logged but never thrown.
function makeHeartbeat(projectId) {
  let lastBeat = 0
  return async function heartbeatThrottled() {
    if (!projectId) return
    const now = Date.now()
    if (now - lastBeat < 30_000) return
    lastBeat = now
    await heartbeatProject(projectId)
  }
}

// Refresh audio_jobs.updated_at so the watchdog (updated_at < now−20min) does not
// kill a legitimately long synthesis job. Guard: &status=eq.processing prevents
// resurrecting a watchdog-killed job. Errors logged, never thrown.
async function heartbeatAudioJob(jobId) {
  if (!jobId) return
  try {
    await sbPatch('audio_jobs', `id=eq.${jobId}&status=eq.processing`, { updated_at: new Date().toISOString() })
  } catch (e) {
    console.error('[heartbeat-audio]', jobId, e.message)
  }
}

// ── Queue operations (bot_content_queue) ─────────────────────────────────────
async function getQueue() {
  try {
    return await sbGet('bot_content_queue', 'status=eq.pending&order=created_at')
  } catch (e) { console.error('[queue] getQueue:', e.message); return [] }
}

async function getQueueStats() {
  try {
    const rows = await sbGet('bot_content_queue', 'select=status')
    return {
      pending:   rows.filter(r => r.status === 'pending').length,
      published: rows.filter(r => r.status === 'published').length,
      declined:  rows.filter(r => r.status === 'declined').length,
    }
  } catch (e) { console.error('[queue] getQueueStats:', e.message); return { pending: 0, published: 0, declined: 0 } }
}

async function addToQueue(topics) {
  console.log('[queue] addToQueue called, topics:', topics)
  try {
    const rows = topics.map(topic => ({ topic, status: 'pending' }))
    console.log('[queue] inserting rows:', JSON.stringify(rows))
    const result = await sbPost('bot_content_queue', rows)
    console.log('[queue] insert result:', JSON.stringify(result))
  } catch (e) { console.error('[queue] addToQueue error:', e.message) }
}

async function markPublished(id) {
  try {
    await sbPatch('bot_content_queue', `id=eq.${id}`, { status: 'published', published_at: new Date().toISOString() })
  } catch (e) { console.error('[queue] markPublished:', e.message) }
}

async function markDeclined(id) {
  try {
    await sbPatch('bot_content_queue', `id=eq.${id}`, { status: 'declined' })
  } catch (e) { console.error('[queue] markDeclined:', e.message) }
}

async function clearPendingQueue() {
  try {
    await sbPatch('bot_content_queue', 'status=eq.pending', { status: 'declined' })
  } catch (e) { console.error('[queue] clearPendingQueue:', e.message) }
}

// ── Seen URLs operations (bot_seen_urls) ─────────────────────────────────────
async function isSeenUrl(url) {
  try {
    const rows = await sbGet('bot_seen_urls', `url=eq.${encodeURIComponent(url)}&select=url`)
    return rows.length > 0
  } catch (e) { console.warn('[seen] isSeenUrl:', e.message); return false }
}

async function markSeenUrl(url) {
  try {
    await sbUpsert('bot_seen_urls', { url }, 'url')
  } catch (e) { console.warn('[seen] markSeenUrl:', e.message) }
}

// ── Settings operations (bot_settings) ───────────────────────────────────────
async function getSetting(key) {
  try {
    const rows = await sbGet('bot_settings', `key=eq.${encodeURIComponent(key)}&select=value`)
    return rows?.[0]?.value ?? null
  } catch (e) {
    console.warn('[settings] getSetting:', e.message)
    return null
  }
}

async function setSetting(key, value) {
  try {
    await sbUpsert('bot_settings', { key, value: String(value), updated_at: new Date().toISOString() }, 'key')
  } catch (e) { console.warn('[settings] setSetting error:', key, e.message) }
}

async function loadSettingsFromDB() {
  try {
    const rows = await sbGet('bot_settings', 'select=key,value')
    let ppText = '', ppImageUrl = '', ppTopic = ''
    for (const { key, value } of rows) {
      if (key === 'auto_publish')     config.autoPublish     = value === 'true'
      if (key === 'monitor_interval') monitorConfig.interval = value
      if (key === 'plan_paused')      planConfig.paused      = value === 'true'
      if (key === 'post_time') {
        const hour = parseInt(value.split(':')[0], 10)
        if (!isNaN(hour)) planConfig.postHour = hour
      }
      if (key === 'posts_per_day') {
        const n = parseInt(value, 10)
        if ([1, 2, 3, 5].includes(n)) planConfig.postsPerDay = n
      }
      if (key === 'pending_post_text')      ppText     = value
      if (key === 'pending_post_image_url') ppImageUrl = value
      if (key === 'pending_post_topic')     ppTopic    = value
      if (key === 'tg_group_id')       { const n = Number(value); if (n) groupConfig.groupId      = n }
      if (key === 'tg_group_username') { if (value) groupConfig.groupUsername = value.replace(/^@/, '') }
      if (key === 'tg_channel_username') { if (value) channelConfig.username  = value.replace(/^@/, '') }
      if (key === 'thread_updates')    { const n = Number(value); if (n) groupConfig.threadUpdates = n }
      if (key === 'thread_news')       { const n = Number(value); if (n) groupConfig.threadNews    = n }
    }
    if (ppText) {
      pendingPost = { text: ppText, imageUrl: ppImageUrl || null, topic: ppTopic }
      console.log('[bot] restored pendingPost from DB, topic:', ppTopic.slice(0, 40))
    }
    console.log('[bot] settings loaded:', { autoPublish: config.autoPublish, interval: monitorConfig.interval, postHour: planConfig.postHour, paused: planConfig.paused, postsPerDay: planConfig.postsPerDay })
  } catch (e) {
    console.warn('[bot] loadSettingsFromDB failed:', e.message, '— using defaults')
  }
}

// In-memory state (settings synced with DB on startup and every change)
let pendingPost = null            // { text, imageUrl, topic }
let pendingMonitorPost = null     // { post, source, url, score, topic }
let pendingDeployPost = null      // { text, commitMessage, deployUrl }
let awaitingTopic = false         // true after "✍️ Написать пост"
let awaitingEdit  = false         // true after "✏️ Редактировать" on monitor post
let awaitingPlan  = false         // true after plan_add callback
let awaitingTime  = false         // true after plan_set_time callback
const config        = { autoPublish: false }
const monitorConfig = { interval: 'daily' } // 'daily' | 'twice' | 'weekly' | 'off'
const planConfig    = { paused: false, postHour: 12, postsPerDay: 1 }
const groupConfig   = { groupId: null, groupUsername: null, threadUpdates: null, threadNews: null }
const channelConfig = { username: null }

const POST_SCHEDULES = {
  1: [12],
  2: [10, 18],
  3: [9, 14, 19],
  5: [8, 11, 14, 17, 20],
}

// Payment flow: public users (resets on restart)
const payStates = new Map() // String(chatId) → { step, method, plan, username, firstName }
let awaitingActivate = null  // { userChatId, plan, planInfo } — owner activation

// Support flow
const supportStates = new Map() // String(chatId) → { step, category, username, firstName }
let awaitingSupportReply = null  // { userChatId, ticketNumber } — owner typing reply

const SUPPORT_CATEGORIES = {
  bug:        { label: '🐛 Нашёл баг',              emoji: '🐛' },
  payment:    { label: '💳 Вопрос по оплате',        emoji: '💳' },
  generation: { label: '🎬 Проблема с генерацией',   emoji: '🎬' },
  idea:       { label: '💡 Предложение',             emoji: '💡' },
  other:      { label: '❓ Другой вопрос',           emoji: '❓' },
  ai:         { label: '🤖 AI не смог помочь',       emoji: '🤖' },
}

function supportCategoryInline() {
  return {
    inline_keyboard: Object.entries(SUPPORT_CATEGORIES).map(([key, cat]) => ([
      { text: cat.label, callback_data: `sup_cat_${key}` },
    ])),
  }
}

async function createSupportTicket(userTelegramId, username, category, description) {
  try {
    const rows = await sbPost('support_tickets', {
      user_telegram_id: String(userTelegramId),
      username: username || null,
      category,
      description,
      status: 'open',
    }, 'select=ticket_number')
    return rows?.[0]?.ticket_number ?? null
  } catch (e) {
    console.error('[support] createSupportTicket:', e.message)
    return null
  }
}

// Fallback values mirror src/lib/types.ts (PLAN_CREDITS + TOPUP_PACKAGES).
// DO NOT edit credits here — edit src/lib/types.ts instead.
// refreshPlansFromVercel() overwrites .credits and .name at startup and every hour.
let PAY_PLANS = {
  basic:      { name: 'Basic',            price: '$9',  usd: 9,  credits: 80000  },
  starter:    { name: 'Starter',          price: '$19', usd: 19, credits: 200000 },
  pro:        { name: 'Pro',              price: '$39', usd: 39, credits: 500000 },
  agency:     { name: 'Agency',           price: '$99', usd: 99, credits: 1500000 },
  topup_500:  { name: '50 000 кредитов',  price: '$7',  usd: 7,  credits: 50000  },
  topup_2000: { name: '200 000 кредитов', price: '$26', usd: 26, credits: 200000 },
  topup_5000: { name: '500 000 кредитов', price: '$60', usd: 60, credits: 500000 },
}

function fmtCr(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

async function refreshPlansFromVercel(alertOnFail = true) {
  try {
    const res = await fetch(`${APP_URL}/api/plans`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const { plan_credits, topup_packages } = await res.json()
    for (const key of ['basic', 'starter', 'pro', 'agency']) {
      if (plan_credits[key] != null) PAY_PLANS[key].credits = plan_credits[key]
    }
    for (const pkg of (topup_packages ?? [])) {
      if (PAY_PLANS[pkg.tg_key]) {
        PAY_PLANS[pkg.tg_key].credits = pkg.credits
        PAY_PLANS[pkg.tg_key].name    = pkg.label
      }
    }
    console.log('[plans] refreshed from Vercel:', Object.fromEntries(
      Object.entries(PAY_PLANS).map(([k, v]) => [k, v.credits])
    ))
  } catch (e) {
    console.warn('[plans] refresh failed — using fallback values:', e.message)
    // alertOnFail=false on first boot: Vercel may still be deploying the same push.
    // The 5-min retry fires with alertOnFail=true; only then Sentry is notified.
    if (alertOnFail && typeof Sentry !== 'undefined') {
      Sentry.captureMessage(`plans refresh failed: ${e.message}`, { level: 'warning' })
    }
  }
}

// ── USD → RUB rate (cached 1 hour in bot_settings) ───────────────────────────
async function getUsdToRub() {
  try {
    const rows = await sbGet('bot_settings', 'key=in.(usd_rub_rate,usd_rub_rate_updated)&select=key,value')
    const rateRow    = rows.find(r => r.key === 'usd_rub_rate')
    const updatedRow = rows.find(r => r.key === 'usd_rub_rate_updated')
    const updatedAt  = updatedRow ? Number(updatedRow.value) : 0
    const ONE_HOUR   = 3600 * 1000
    if (rateRow && (Date.now() - updatedAt) < ONE_HOUR) {
      return Number(rateRow.value)
    }
  } catch (e) { /* cache miss — fetch fresh */ }

  try {
    const res  = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', { signal: AbortSignal.timeout(5000) })
    const data = await res.json()
    const rate = data.usd?.rub
    if (!rate) throw new Error('no rub field')
    await sbPost('bot_settings', { key: 'usd_rub_rate',         value: String(rate)      }, 'on_conflict=key')
    await sbPost('bot_settings', { key: 'usd_rub_rate_updated', value: String(Date.now()) }, 'on_conflict=key')
    return rate
  } catch (e) {
    console.error('[rate] getUsdToRub error:', e.message)
    return 90 // fallback
  }
}

// ── Keyboards ─────────────────────────────────────────────────────────────────
const MAIN_KB = {
  keyboard: [
    [{ text: '💡 Идея' },           { text: '📊 Статистика' }],
    [{ text: '✍️ Написать пост' },   { text: '📡 Мониторинг' }],
    [{ text: '📅 Контент-план' },    { text: '⚙️ Настройки' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
}

// Persistent reply keyboard for public (non-owner) users
const PUBLIC_KB = {
  keyboard: [
    [{ text: '💰 Тарифы и цены' },   { text: '🎬 Как это работает' }],
    [{ text: '❓ Частые вопросы' },  { text: '🆘 Поддержка' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
}

function previewInline() {
  return {
    inline_keyboard: [
      [
        { text: '📢 В канал',          callback_data: 'pub_ch'   },
        { text: '💬 В группу',         callback_data: 'pub_gr'   },
        { text: '🌐 Везде',            callback_data: 'pub_both' },
      ],
      [
        { text: '❌ Отклонить',        callback_data: 'decline' },
        { text: '🔄 Перегенерировать', callback_data: 'regen'   },
      ],
    ],
  }
}

const INTERVAL_LABELS = {
  daily:  '1 раз в день',
  twice:  '2 раза в день',
  weekly: '1 раз в неделю',
  off:    'Выкл',
}

function settingsInline() {
  const iLabel = INTERVAL_LABELS[monitorConfig.interval] ?? '1 раз в день'
  return {
    inline_keyboard: [
      [{ text: config.autoPublish ? '🟢 Автопубликация: ВКЛ' : '🔴 Автопубликация: ВЫКЛ', callback_data: 'toggle_auto' }],
      [{ text: `📡 Мониторинг: ${iLabel}`, callback_data: 'mi_menu' }],
      [{ text: `⏰ Время постинга: ${String(planConfig.postHour).padStart(2, '0')}:00 UTC`, callback_data: 'plan_set_time' }],
      [{ text: `📝 Постов в день: ${planConfig.postsPerDay}`, callback_data: 'ppd_menu' }],
      [{ text: '🌐 Часовой пояс: UTC', callback_data: 'noop' }],
    ],
  }
}

function postsPerDayInline() {
  const c = (v) => planConfig.postsPerDay === v ? '✅ ' : ''
  return {
    inline_keyboard: [[
      { text: `${c(1)}1 пост`,   callback_data: 'ppd_1' },
      { text: `${c(2)}2 поста`,  callback_data: 'ppd_2' },
      { text: `${c(3)}3 поста`,  callback_data: 'ppd_3' },
      { text: `${c(5)}5 постов`, callback_data: 'ppd_5' },
    ]],
  }
}

function monitorIntervalInline() {
  const c = (v) => monitorConfig.interval === v ? '✅ ' : ''
  return {
    inline_keyboard: [
      [{ text: `${c('daily')}1 раз в день (09:00 UTC)`,       callback_data: 'mi_daily' }],
      [{ text: `${c('twice')}2 раза в день (09:00 и 18:00)`,  callback_data: 'mi_twice' }],
      [{ text: `${c('weekly')}1 раз в неделю (Пн 09:00)`,     callback_data: 'mi_weekly' }],
      [{ text: `${c('off')}Выкл — только вручную`,            callback_data: 'mi_off' }],
    ],
  }
}

function planInline() {
  return {
    inline_keyboard: [
      [
        { text: '➕ Добавить темы',   callback_data: 'plan_add' },
        { text: '🗑 Очистить',        callback_data: 'plan_clear' },
      ],
      [
        { text: planConfig.paused ? '▶️ Возобновить' : '⏸ Пауза', callback_data: 'plan_pause' },
        { text: '▶️ Запустить сейчас', callback_data: 'plan_post_now' },
      ],
    ],
  }
}

function monitorInline() {
  return {
    inline_keyboard: [
      [
        { text: '📢 В канал',          callback_data: 'mon_pub_ch'   },
        { text: '💬 В группу',         callback_data: 'mon_pub_gr'   },
        { text: '🌐 Везде',            callback_data: 'mon_pub_both' },
      ],
      [
        { text: '❌ Пропустить',       callback_data: 'mon_skip' },
        { text: '✏️ Редактировать',    callback_data: 'mon_edit' },
        { text: '🔄 Перегенерировать', callback_data: 'mon_regen' },
      ],
    ],
  }
}

function payMethodInline() {
  return {
    inline_keyboard: [
      [
        { text: '💳 Карта МИР',        callback_data: 'pay_card' },
        { text: '₿ Криптовалюта USDT', callback_data: 'pay_crypto' },
      ],
    ],
  }
}

function payBackInline() {
  return {
    inline_keyboard: [[
      { text: '← Выбрать другой способ', callback_data: 'pay_back' },
    ]],
  }
}

function payPlanInline() {
  return {
    inline_keyboard: [
      [
        { text: `Basic — ${fmtCr(PAY_PLANS.basic.credits)} кр — $9`,    callback_data: 'pay_plan_basic' },
        { text: `Starter — ${fmtCr(PAY_PLANS.starter.credits)} кр — $19`, callback_data: 'pay_plan_starter' },
      ],
      [
        { text: `Pro — ${fmtCr(PAY_PLANS.pro.credits)} кр — $39`,      callback_data: 'pay_plan_pro' },
        { text: `Agency — ${fmtCr(PAY_PLANS.agency.credits)} кр — $99`, callback_data: 'pay_plan_agency' },
      ],
      [
        { text: `Топап — ${fmtCr(PAY_PLANS.topup_500.credits)} кр — $7`,   callback_data: 'pay_plan_topup_500' },
        { text: `Топап — ${fmtCr(PAY_PLANS.topup_2000.credits)} кр — $26`, callback_data: 'pay_plan_topup_2000' },
        { text: `Топап — ${fmtCr(PAY_PLANS.topup_5000.credits)} кр — $60`, callback_data: 'pay_plan_topup_5000' },
      ],
    ],
  }
}

// ── Telegram API helpers ──────────────────────────────────────────────────────
async function tgApi(method, params) {
  if (!BOT_TOKEN) return null
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 30000)
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    return res.json()
  } catch (err) {
    console.error(`[tg] ${method} error:`, err.message)
    return null
  } finally {
    clearTimeout(t)
  }
}

// Download image to Buffer so Telegram never has to fetch from fal.media
async function fetchImageBuffer(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  } catch (err) {
    console.error('[tg] fetchImageBuffer error:', err.message)
    return null
  } finally {
    clearTimeout(t)
  }
}

// Send photo via multipart so Telegram doesn't fetch from external CDN
async function tgSendPhoto(chatId, imageBuffer, caption, extra = {}) {
  if (!BOT_TOKEN) return null
  const form = new FormData()
  form.append('chat_id', String(chatId))
  form.append('photo', new Blob([imageBuffer], { type: 'image/jpeg' }), 'image.jpg')
  form.append('caption', caption)
  form.append('parse_mode', 'Markdown')
  for (const [k, v] of Object.entries(extra)) {
    form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 30000)
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST', signal: ctrl.signal, body: form,
    })
    const json = await res.json()
    if (!json.ok) console.error('[tg] sendPhoto failed:', JSON.stringify(json).slice(0, 200))
    return json
  } catch (err) {
    console.error('[tg] sendPhoto error:', err.message)
    return null
  } finally {
    clearTimeout(t)
  }
}

// Escape Telegram Markdown v1 special chars so a long split never lands inside a span
function escapeMarkdown(text) {
  return text.replace(/([*_`\[])/g, '\\$1')
}

// Split text into ≤4096-char chunks at paragraph / line / hard boundaries
function splitText(text, maxLen = 4096) {
  if (text.length <= maxLen) return [text]
  const chunks = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break }
    let cut = remaining.lastIndexOf('\n\n', maxLen)
    if (cut < 1) cut = remaining.lastIndexOf('\n', maxLen)
    if (cut < 1) cut = maxLen
    chunks.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut).replace(/^\n+/, '')
  }
  return chunks
}

// Send long text safely: split into chunks, attach reply_markup only to the last one.
// If parse_mode is set, text is escaped before splitting; on 400 retries without parse_mode.
async function safeSendMessage(chatId, text, options = {}) {
  const { parse_mode, reply_markup, ...rest } = options
  const prepared = parse_mode ? escapeMarkdown(text) : text
  const chunks = splitText(prepared)
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1
    const params = { chat_id: chatId, text: chunks[i], ...rest }
    if (parse_mode) params.parse_mode = parse_mode
    if (isLast && reply_markup) params.reply_markup = reply_markup
    const result = await tgApi('sendMessage', params)
    if (parse_mode && result && !result.ok && result.error_code === 400) {
      const { parse_mode: _pm, ...fallback } = params
      await tgApi('sendMessage', fallback)
    }
  }
}

// Send to owner with main keyboard always attached
async function sendTo(chatId, text, extra = {}) {
  return safeSendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: MAIN_KB, ...extra })
}

// Notify a platform user that their long background job finished.
// Best-effort: never throws. Three distinct log levels:
//   log  — no chat_id (expected for non-bot users) or bot blocked by user (user action, not a bug)
//   warn — sbGet failure or unexpected Telegram error (infrastructure problem worth investigating)
async function notifyUserJobDone(userId, kind, payload = {}) {
  if (!userId) {
    console.log('[notify] skip: no userId kind=' + kind)
    return
  }

  let rows
  try {
    rows = await sbGet('profiles', `id=eq.${userId}&select=telegram_chat_id`)
  } catch (err) {
    console.warn('[notify] profile lookup failed:', err.message)
    return
  }

  const chatId = Array.isArray(rows) && rows[0]?.telegram_chat_id
  if (!chatId) {
    console.log('[notify] skip: no chat_id user=' + userId)
    return
  }

  let msg
  if (kind === 'video') {
    msg = `🎬 Видео готово!\nСборка завершена — можно скачать или запустить SEO-оптимизацию.\n${APP_URL}/studio`
  } else if (kind === 'images') {
    const count = payload.count ?? 0
    msg = `🖼 Иллюстрации готовы! (${count} шт.)\n${APP_URL}/studio`
  } else if (kind === 'audio') {
    msg = `🎙 Озвучка готова!\nАудио загружено — переходите к субтитрам.\n${APP_URL}/studio`
  } else if (kind === 'video_failed') {
    msg = `⚠️ Сборка видео не удалась.\nПопробуйте снова в студии: ${APP_URL}/studio`
  } else if (kind === 'images_failed') {
    msg = `⚠️ Генерация иллюстраций прервалась.\nПопробуйте снова в студии: ${APP_URL}/studio`
  } else if (kind === 'audio_failed') {
    msg = `⚠️ Синтез озвучки не удался.\nПопробуйте снова в студии: ${APP_URL}/studio`
  } else {
    return
  }

  // tgApi never throws (catches internally and returns null); check result.ok for Telegram-level errors
  const result = await tgApi('sendMessage', { chat_id: chatId, text: msg, reply_markup: PUBLIC_KB })
  if (result && !result.ok) {
    if (result.error_code === 403) {
      console.log('[notify] user blocked bot chat_id=' + chatId)
    } else {
      console.warn('[notify] send failed:', result.error_code, result.description)
    }
  }
}

// ── AI consultant helpers ─────────────────────────────────────────────────────
function consultantSystem() {
  return (
    lefiroKB + '\n\n' +
    'Ты — AI-ассистент продукта Lefiro. Отвечай только по информации из книги знаний выше. ' +
    'Не выдумывай цены, сроки и функции, которых нет в книге. ' +
    'Если вопрос касается конкретного аккаунта, платежа, баланса или заказа пользователя, ' +
    'либо в книге знаний нет ответа, либо это жалоба — ' +
    'закончи ответ служебной меткой на отдельной строке: [ESCALATE]\n' +
    'Метку [ESCALATE] добавляй ТОЛЬКО в этих случаях, не в каждом ответе. ' +
    'Отвечай кратко (1–4 предложения), без Markdown-разметки, на языке пользователя.'
  )
}

async function runConsultant(chatId, queryText) {
  const humanBtn = { inline_keyboard: [[{ text: '👤 Позвать человека', callback_data: 'sup_cat_ai' }]] }
  const now  = Date.now()
  const hour = 60 * 60 * 1000
  const prev = (aiRateLimit.get(String(chatId)) || []).filter(t => now - t < hour)
  if (prev.length >= 10) {
    await safeSendMessage(chatId,
      'Вы отправили слишком много вопросов — лимит 10 в час. Попробуйте позже или позвоните человеку.',
      { reply_markup: humanBtn }
    )
    return
  }
  aiRateLimit.set(String(chatId), [...prev, now])
  try {
    const aiRes = await claude().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: consultantSystem(),
      messages: [{ role: 'user', content: queryText }],
    })
    const raw    = (aiRes.content[0]?.type === 'text' ? aiRes.content[0].text : '').trim()
    if (!raw) throw new Error('empty AI response')
    const escalate = raw.includes('[ESCALATE]')
    const answer   = raw.replace(/\[ESCALATE\]/g, '').trim()
    await safeSendMessage(chatId, answer, escalate ? { reply_markup: humanBtn } : {})
  } catch (err) {
    console.error('[ai-consultant]', err.message)
    Sentry.captureException(err)
    await safeSendMessage(chatId,
      'Не удалось получить ответ от AI. Позвоните живому человеку — он поможет.',
      { reply_markup: humanBtn }
    )
  }
}

// target: 'channel' | 'group' | 'both'
// threadId: message_thread_id for group topics; ignored when target='channel'
async function publishToChannel(text, imageUrl = null, target = 'channel', threadId = null) {
  const sendOne = async (chatId, thread) => {
    const extra = thread ? { message_thread_id: thread } : {}
    if (imageUrl) {
      console.log('[tg] downloading image buffer...')
      const buf = await fetchImageBuffer(imageUrl)
      if (buf) {
        console.log('[tg] sending photo to', chatId, thread ? `thread=${thread}` : '', 'size:', buf.length)
        return tgSendPhoto(chatId, buf, text, extra)
      }
      console.warn('[tg] image download failed for', chatId, '— sending text only')
    }
    return tgApi('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', ...extra })
  }

  if ((target === 'group' || target === 'both') && !groupConfig.groupId) {
    console.warn('[publish] tg_group_id not configured — cannot publish to group')
    if (target === 'group') return null
  }

  if (target === 'channel') return sendOne(CHANNEL_ID, null)
  if (target === 'group')   return sendOne(groupConfig.groupId, threadId)

  // target === 'both': failures are independent — one failing does not cancel the other
  const [chRes, grRes] = await Promise.allSettled([
    sendOne(CHANNEL_ID, null),
    groupConfig.groupId ? sendOne(groupConfig.groupId, threadId) : Promise.resolve(null),
  ])
  return {
    channel: chRes.status === 'fulfilled' ? chRes.value : null,
    group:   grRes.status === 'fulfilled' ? grRes.value : null,
  }
}

// Derive the positive numeric peer ID used in t.me/c/ links from a supergroup chat_id (-100XXXXXXXXX)
function tmeNumericId(chatId) {
  return String(Math.abs(chatId)).replace(/^100/, '')
}

// Returns clickable link for a channel post; reads username from bot_settings (tg_channel_username)
function channelPostLink(res) {
  const msgId = res?.result?.message_id
  if (!msgId) return null
  const username = channelConfig.username
  if (!username) return null
  return `https://t.me/${username}/${msgId}`
}

// Returns clickable link for a group topic post.
// Public group (tg_group_username set): t.me/{username}/{threadId}/{msgId}
// Private group (only tg_group_id):     t.me/c/{numId}/{threadId}/{msgId}
// Neither configured:                   null (no link inserted)
function groupPostLink(res, threadId = null) {
  const msgId = res?.result?.message_id
  if (!msgId) return null
  if (groupConfig.groupUsername) {
    return threadId
      ? `https://t.me/${groupConfig.groupUsername}/${threadId}/${msgId}`
      : `https://t.me/${groupConfig.groupUsername}/${msgId}`
  }
  if (groupConfig.groupId) {
    const numId = tmeNumericId(groupConfig.groupId)
    return threadId
      ? `https://t.me/c/${numId}/${threadId}/${msgId}`
      : `https://t.me/c/${numId}/${msgId}`
  }
  return null
}

// ── Email helpers (Resend API, used by expiry notifications) ─────────────────
const RESEND_API_KEY    = env('RESEND_API_KEY')
const RESEND_FROM_EMAIL = env('RESEND_FROM_EMAIL') || 'Lefiro <noreply@lefiro.co>'
// APP_URL already declared at module top (line 82)

async function sendRawEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.log('[email] skipped: no RESEND_API_KEY')
    return
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to, subject, html }),
    })
    if (!res.ok) console.warn('[email] Resend error:', res.status, await res.text())
  } catch (e) {
    console.error('[email] send failed:', e.message)
  }
}

function emailLayout(body) {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden">
      <tr><td style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:32px;text-align:center">
        <p style="margin:0;font-size:28px;font-weight:800;color:#fff">🎬 Lefiro</p>
      </td></tr>
      <tr><td style="padding:32px 40px">${body}</td></tr>
      <tr><td style="background:#f9fafb;padding:16px 40px;text-align:center">
        <p style="margin:0;font-size:12px;color:#9ca3af">© 2025 Lefiro · <a href="${APP_URL}" style="color:#ef4444;text-decoration:none">Открыть сайт</a></p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`
}

async function sendExpiryBurnEmail(to, { planName, burned, purchased }) {
  const subject = `Тариф ${planName} истёк · Lefiro`
  const body = `
    <h2 style="margin:0 0 12px;font-size:20px;color:#111">Ваш тариф ${planName} истёк</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#4b5563;line-height:1.6">
      Срок действия тарифа завершился. Вот что произошло с вашим балансом:
    </p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:20px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
      <tr style="background:#fef2f2"><td style="padding:12px 16px;font-size:14px;color:#991b1b">🔥 Тарифные кредиты</td><td style="padding:12px 16px;font-size:14px;color:#991b1b;text-align:right;font-weight:700">−${burned.toLocaleString('ru-RU')} списаны</td></tr>
      <tr style="background:#f0fdf4"><td style="padding:12px 16px;font-size:14px;color:#166534">🟢 Постоянные кредиты</td><td style="padding:12px 16px;font-size:14px;color:#166534;text-align:right;font-weight:700">${purchased.toLocaleString('ru-RU')} сохранены</td></tr>
    </table>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280">Продлите подписку, чтобы получить новые тарифные кредиты и продолжить работу.</p>
    <div style="text-align:center;margin-bottom:8px">
      <a href="${APP_URL}/billing" style="display:inline-block;background:#ef4444;color:#fff;padding:12px 28px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none">Продлить тариф →</a>
    </div>`
  await sendRawEmail(to, subject, emailLayout(body))
}

async function sendExpiryReminderEmail(to, { planName, expiresDate, planCredits }) {
  const subject = `Тариф ${planName} истекает ${expiresDate} · Lefiro`
  const body = `
    <h2 style="margin:0 0 12px;font-size:20px;color:#111">⚠️ Ваш тариф ${planName} скоро истекает</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#4b5563;line-height:1.6">
      Тариф действует до <strong>${expiresDate}</strong>. На тарифном балансе: <strong>${planCredits.toLocaleString('ru-RU')} кредитов</strong>.
    </p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280">
      После истечения тарифные кредиты сгорят, но докупленные кредиты останутся навсегда.
      Продлите подписку, чтобы сохранить тарифный баланс.
    </p>
    <div style="text-align:center;margin-bottom:8px">
      <a href="${APP_URL}/billing" style="display:inline-block;background:#ef4444;color:#fff;padding:12px 28px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none">Продлить тариф →</a>
    </div>`
  await sendRawEmail(to, subject, emailLayout(body))
}

// ── Russia payment helpers ────────────────────────────────────────────────────
function cryptoPaymentText(planInfo) {
  return (
    `₿ *Оплата USDT*\n\n` +
    `Тариф: *${planInfo.name}* — ${planInfo.price} USDT\n\n` +
    `🔹 TRC20: \`${USDT_TRC20}\`\n` +
    `🔹 ERC20: \`${USDT_ERC20}\`\n\n` +
    `После оплаты отправь сюда:\n` +
    `1. Hash транзакции\n` +
    `2. Свой email в Lefiro\n\n` +
    `Активируем в течение 1 часа ✅`
  )
}

async function notifyOwnerNewPayment(userChatId, username, firstName, method, planInfo, rubAmount) {
  if (!OWNER_ID) return
  const userDisplay = username ? `@${username}` : (firstName || String(userChatId))
  const methodLabel = method === 'card' ? 'Карта МИР 💳' : 'Криптовалюта USDT ₿'
  const rubNote = rubAmount ? ` (~${rubAmount} ₽)` : ''
  await tgApi('sendMessage', {
    chat_id: OWNER_ID,
    text:
      `💰 *Новая заявка на оплату!*\n\n` +
      `👤 ${userDisplay} (ID: \`${userChatId}\`)\n` +
      `📦 Тариф: *${planInfo.name}* ${planInfo.price}${rubNote}\n` +
      `💳 Способ: ${methodLabel}\n\n` +
      `Ожидай скриншот/hash от пользователя.\n` +
      `Активация: ${APP_URL}/admin/users`,
    parse_mode: 'Markdown',
  })
}

async function forwardProofToOwner(userChatId, message, pst) {
  const planInfo    = PAY_PLANS[pst.plan] || { name: pst.plan, price: '' }
  const userDisplay = pst.username ? `@${pst.username}` : (pst.firstName || String(userChatId))
  const methodLabel = pst.method === 'card' ? 'Карта МИР 💳' : 'Криптовалюта USDT ₿'
  // claimId = unique per proof submission; used by activate/route to prevent double-credit.
  const claimId     = `${userChatId}-${Date.now()}`

  if (OWNER_ID) {
    await tgApi('forwardMessage', { chat_id: OWNER_ID, from_chat_id: userChatId, message_id: message.message_id })
    await tgApi('sendMessage', {
      chat_id: OWNER_ID,
      text:
        `⬆️ *Подтверждение оплаты от ${userDisplay}*\n\n` +
        `👤 ID: \`${userChatId}\`\n` +
        `📦 ${planInfo.name} ${planInfo.price}\n` +
        `💳 ${methodLabel}`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Активировать тариф', callback_data: `activate::${pst.plan}::${userChatId}::${claimId}` },
        ]],
      },
    })
  }
  await tgApi('sendMessage', { chat_id: userChatId, text: '✅ Получено! Мы активируем тариф в течение 1 часа.' })
}

async function activateUserPlan(email, plan, claimId = null, telegramChatId = null) {
  const res = await fetch(`${APP_URL}/api/admin/users/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-secret': API_SECRET },
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      plan,
      claim_id:         claimId,
      telegram_chat_id: telegramChatId ? String(telegramChatId) : null,
    }),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error || 'Ошибка активации')
  return json
}

// ── Claude helpers ────────────────────────────────────────────────────────────
function claude() { return new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') }) }

async function generatePost(topic) {
  const msg = await claude().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content:
        'Ты SMM менеджер YouTube automation сервиса Lefiro.\n' +
        'Напиши engaging пост для Telegram канала на русском языке.\n' +
        `Тема: ${topic}\n\n` +
        'Правила:\n' +
        '- Максимум 500 символов\n' +
        '- Используй эмодзи\n' +
        '- Короткие абзацы\n' +
        `- В конце призыв: попробовать сервис со ссылкой ${APP_URL}\n` +
        '- Стиль: дружелюбный, живой, не рекламный\n' +
        '- Форматирование: только *жирный* и _курсив_ (Telegram Markdown v1)\n' +
        '- ЗАПРЕЩЕНО: # заголовки, ## подзаголовки, --- разделители, списки через - или *, [ссылки](url) — Telegram их не рендерит, читатель увидит сырые символы',
    }],
  })
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
}

async function generateIdea() {
  const msg = await claude().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content:
        'Придумай одну конкретную и интересную тему поста для Telegram канала сервиса Lefiro ' +
        '(SaaS для автоматического создания YouTube видео с AI). ' +
        'Верни только тему, без пояснений.',
    }],
  })
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
}

async function generateImagePrompt(topic) {
  const msg = await claude().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content:
        `На основе темы поста создай конкретный английский промт для генерации изображения в стиле YouTube thumbnail.\n\n` +
        `Тема: ${topic}\n\n` +
        `Требования к изображению:\n` +
        `- Конкретные объекты, люди или сцены (не абстракция)\n` +
        `- Тёмный фон с фиолетовыми/синими акцентами\n` +
        `- Технологичный современный стиль\n` +
        `- Если тема про деньги/заработок — показать деньги, графики роста\n` +
        `- Если тема про видео — камера, экран с видео, YouTube интерфейс\n` +
        `- Если тема про ИИ — роботы, нейросети, светящиеся схемы\n` +
        `- Если тема про блогеров — человек за компьютером, микрофон, камера\n` +
        `- Качество: cinematic, 8k, detailed, professional\n\n` +
        `Ответь только английским промтом (20-30 слов).`,
    }],
  })
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
}

// ── fal.ai image generation ───────────────────────────────────────────────────
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms)),
  ])
}

async function generateImage(topic) {
  const FAL_KEY = env('FAL_KEY')
  if (!FAL_KEY) { console.warn('[fal] FAL_KEY not set, skipping image'); return null }

  const prompt = await withTimeout(generateImagePrompt(topic), 15000, 'image-prompt')
    .catch(err => { console.warn('[fal] prompt gen failed:', err.message); return topic })
  console.log('[fal] prompt:', prompt.slice(0, 80))

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`[fal] generating image attempt ${attempt} for:`, topic.slice(0, 40))
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 25000)
      let res
      try {
        res = await fetch('https://fal.run/fal-ai/flux/schnell', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            image_size: 'landscape_16_9',
            num_images: 1,
            num_inference_steps: 4,
            seed: Math.floor(Math.random() * 999999),
          }),
        })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.error(`[fal] attempt ${attempt} HTTP ${res.status}:`, errText.slice(0, 120))
        continue
      }
      const json = await res.json()
      const url = json.images?.[0]?.url ?? null
      if (url) { console.log('[fal] image ok:', url.slice(0, 50)); return url }
      console.warn(`[fal] attempt ${attempt} no url:`, JSON.stringify(json).slice(0, 120))
    } catch (err) {
      console.error(`[fal] attempt ${attempt} error:`, err.message)
    }
  }
  return null
}

// ── Pending post DB persistence ───────────────────────────────────────────────
async function savePendingPost({ text, imageUrl, topic }) {
  pendingPost = { text, imageUrl: imageUrl ?? null, topic }
  await Promise.all([
    setSetting('pending_post_text',      text),
    setSetting('pending_post_image_url', imageUrl ?? ''),
    setSetting('pending_post_topic',     topic),
  ])
}

async function clearPendingPost() {
  pendingPost = null
  await Promise.all([
    setSetting('pending_post_text',      ''),
    setSetting('pending_post_image_url', ''),
    setSetting('pending_post_topic',     ''),
  ])
}

async function ensurePendingPost() {
  if (pendingPost?.text) return pendingPost
  const [text, imageUrl, topic] = await Promise.all([
    getSetting('pending_post_text'),
    getSetting('pending_post_image_url'),
    getSetting('pending_post_topic'),
  ])
  if (!text) return null
  pendingPost = { text, imageUrl: imageUrl || null, topic: topic || '' }
  return pendingPost
}

// ── Deploy post helpers ───────────────────────────────────────────────────────
function deployInline() {
  return {
    inline_keyboard: [
      [
        { text: '📢 В канал',  callback_data: 'dep_pub_ch'   },
        { text: '💬 В группу', callback_data: 'dep_pub_gr'   },
        { text: '🌐 Везде',    callback_data: 'dep_pub_both' },
      ],
      [
        { text: '❌ Отклонить', callback_data: 'dep_skip' },
      ],
    ],
  }
}

async function generateDeployPost(commitMessage) {
  const msg = await withTimeout(claude().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content:
        'Напиши пост для Telegram канала Lefiro об этом обновлении сервиса.\n\n' +
        `Описание изменений из git коммита: ${commitMessage}\n\n` +
        'Правила:\n' +
        '- Объясни обновление простым языком для блогеров\n' +
        '- Покажи пользу для пользователя\n' +
        `- Добавь эмодзи и ссылку ${APP_URL}\n` +
        '- Максимум 400 символов\n' +
        '- Стиль: живой, позитивный',
    }],
  }), 20000, 'deploy-post')
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim()
}

// ── Supabase stats ────────────────────────────────────────────────────────────
async function fetchStats() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null
  const headers = { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY }
  const [uR, pR, vR] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/profiles?select=count`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/projects?select=count`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/projects?select=count&status=eq.completed`, { headers }),
  ])
  const [u, p, v] = await Promise.all([uR.json(), pR.json(), vR.json()])
  return { users: u[0]?.count ?? '?', projects: p[0]?.count ?? '?', videos: v[0]?.count ?? '?' }
}

async function publishStats(toOwner = null) {
  const stats = await fetchStats()
  if (!stats) { console.warn('[tg] stats unavailable'); return }
  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  const text =
    `📊 *Статистика Lefiro — ${date}*\n\n` +
    `👥 Пользователей: *${stats.users}*\n` +
    `📁 Проектов: *${stats.projects}*\n` +
    `🎬 Видео готово: *${stats.videos}*\n\n` +
    `Создай своё видео → ${APP_URL}`
  const pubResStats = await publishToChannel(text)
  if (toOwner) {
    const link = channelPostLink(pubResStats)
    if (link) await sendTo(toOwner, `✅ Статистика опубликована: ${link}`)
    else await sendTo(toOwner, `❌ Не удалось опубликовать статистику: ${pubResStats?.description ?? 'нет ответа от Telegram'}`)
  }
}

// ── Content monitor ───────────────────────────────────────────────────────────
function hasKeyword(text) {
  const lower = (text || '').toLowerCase()
  return KEYWORDS.some(kw => lower.includes(kw))
}

const rssParser = new RssParser({
  timeout: 15000,
  headers: { 'User-Agent': 'Lefiro-Bot/1.0' },
})

async function fetchRss(source) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 18000)
  try {
    const feed = await rssParser.parseURL(source.url)
    return (feed.items || []).slice(0, 15).map(item => ({
      title:   item.title || '',
      snippet: (item.contentSnippet || item.content || '').slice(0, 800),
      link:    item.link || item.guid || '',
      sourceName: source.name,
    }))
  } catch (err) {
    console.warn(`[monitor] RSS ${source.name} failed:`, err.message)
    return []
  } finally {
    clearTimeout(t)
  }
}

async function evaluateItem(item) {
  const text = `${item.title}\n${item.snippet}`.slice(0, 1500)
  try {
    const msg = await withTimeout(claude().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content:
          'Оцени эту статью/пост для Telegram канала Lefiro (сервис автоматизации YouTube через ИИ).\n\n' +
          `Заголовок: ${item.title}\nТекст: ${item.snippet}\n\n` +
          'Ответь строго JSON без markdown:\n' +
          '{"relevant":true/false,"score":1-10,"reason":"...","summary":"..."}\n\n' +
          'relevant=true если материал полезен для аудитории YouTube блогеров интересующихся ИИ автоматизацией',
      }],
    }), 20000, 'eval')
    const raw = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim()
    const match = raw.match(/\{[\s\S]*?\}/)
    return match ? JSON.parse(match[0]) : null
  } catch (err) {
    console.warn('[monitor] eval error:', err.message)
    return null
  }
}

async function generateMonitorPost(item) {
  const msg = await withTimeout(claude().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 700,
    messages: [{
      role: 'user',
      content:
        'На основе этой статьи напиши оригинальный пост для Telegram канала Lefiro.\n' +
        'Не копируй текст — перескажи своими словами, добавь свою точку зрения, ' +
        'упомяни Lefiro как инструмент для YouTube авторов. ' +
        'Стиль: живой, с эмодзи, максимум 500 символов.\n\n' +
        `Заголовок: ${item.title}\nТекст: ${item.snippet}`,
    }],
  }), 40000, 'monitor-post')
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim()
}

async function regenMonitorPost(chatId) {
  if (!pendingMonitorPost) { await sendTo(chatId, '❌ Нет поста для регенерации'); return }
  const { topic, source, url, score } = pendingMonitorPost
  try {
    await sendTo(chatId, '🔄 Перегенерирую...')
    const msg = await withTimeout(claude().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content:
          'Напиши другой вариант поста для Telegram канала Lefiro на эту тему. ' +
          'Стиль: живой, с эмодзи, максимум 500 символов. ' +
          'Упомяни Lefiro как инструмент для YouTube авторов.\n\n' +
          `Тема: ${topic}`,
      }],
    }), 40000, 'monitor-regen')
    const post = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim()
    pendingMonitorPost.post = post
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: `📰 *Перегенерировано из ${source}:*\n\n${post}\n\n🔗 ${url}\n📊 Оценка: ${score}/10`,
      parse_mode: 'Markdown',
      reply_markup: monitorInline(),
    })
  } catch (err) {
    console.error('[monitor] regen failed:', err.message)
    await sendTo(chatId, `❌ Ошибка регенерации: ${err.message}`)
  }
}

async function processMonitorItem(item) {
  const eval_ = await evaluateItem(item)
  if (!eval_) return
  const score = Number(eval_.score) || 0
  console.log(`[monitor] "${item.title.slice(0, 50)}" score=${score} relevant=${eval_.relevant}`)
  if (!eval_.relevant || score < 7) return

  let post
  try {
    post = await generateMonitorPost(item)
  } catch (err) {
    console.error('[monitor] post gen failed:', err.message)
    return
  }

  pendingMonitorPost = { post, source: item.sourceName, url: item.link, score, topic: item.title }

  if (OWNER_ID) {
    await tgApi('sendMessage', {
      chat_id: OWNER_ID,
      text:
        `📰 *Нашёл интересное из ${item.sourceName}:*\n\n${post}\n\n` +
        `🔗 ${item.link}\n📊 Оценка: ${score}/10`,
      parse_mode: 'Markdown',
      reply_markup: monitorInline(),
    })
    console.log('[monitor] sent to owner, score:', score)
  }
}

async function runMonitor() {
  if (monitorConfig.interval === 'off') { console.log('[monitor] disabled, skipping'); return }
  console.log('[monitor] scanning', RSS_SOURCES.length, 'sources...')
  const newItems = []

  for (const source of RSS_SOURCES) {
    if (source.delayMs) await new Promise(r => setTimeout(r, source.delayMs))
    const items = await fetchRss(source)
    for (const item of items) {
      if (!item.link) continue
      if (await isSeenUrl(item.link)) continue
      await markSeenUrl(item.link)
      if (hasKeyword(item.title + ' ' + item.snippet)) {
        newItems.push(item)
      }
    }
  }

  // Rank by keyword count (most matches = most relevant), take top 5 only
  const ranked = newItems
    .map(item => {
      const t = (item.title + ' ' + item.snippet).toLowerCase()
      return { ...item, kwCount: KEYWORDS.filter(kw => t.includes(kw)).length }
    })
    .sort((a, b) => b.kwCount - a.kwCount)

  const top = ranked.slice(0, 5)
  // Claude Haiku eval: ~500 tok each ≈ $0.000040/call; Sonnet post: ~1000 tok ≈ $0.003/call
  const estCost = (top.length * 0.00004 + top.length * 0.003).toFixed(4)
  console.log(`[monitor] found ${newItems.length} matches, evaluating top ${top.length}, est. cost ~$${estCost}`)

  for (const item of top) {
    await processMonitorItem(item)
  }
  console.log('[monitor] scan done')
}

// ── Content plan (queue) ──────────────────────────────────────────────────────
async function planStatusText() {
  const [stats, pending] = await Promise.all([
    getQueueStats(),
    getQueue(),
  ])
  const next = pending[0] ?? null
  const pauseNote = planConfig.paused ? '\n\n⏸ *Автопостинг на паузе*' : ''
  return (
    `📋 *Контент-план*\n\n` +
    `✅ Опубликовано: ${stats.published}\n` +
    `⏳ В очереди: ${stats.pending}\n` +
    `❌ Отклонено: ${stats.declined}\n\n` +
    `⏰ Время постинга: *${String(planConfig.postHour).padStart(2, '0')}:00 UTC*\n` +
    (next ? `📌 Следующий: *${next.topic.slice(0, 60)}*` : '📭 Очередь пуста') +
    pauseNote
  )
}

async function postFromQueue(chatId = OWNER_ID) {
  if (planConfig.paused) { console.log('[plan] paused'); return }
  const queue = await getQueue()
  const item = queue[0] ?? null
  if (!item) {
    console.log('[plan] queue empty')
    if (OWNER_ID) await sendTo(OWNER_ID, '📭 Контент-план пуст. Добавь новые темы через 📅 Контент-план')
    return
  }
  console.log('[plan] posting topic:', item.topic.slice(0, 50))
  try {
    await generateAndHandle(chatId, item.topic)
    await markPublished(item.id)
  } catch (err) {
    console.error('[plan] post failed:', err.message)
    if (OWNER_ID) await sendTo(OWNER_ID, `❌ Ошибка автопостинга: ${err.message.slice(0, 120)}`)
  }
}

// ── Core flow: show preview with inline buttons ───────────────────────────────
async function showPreview(chatId, post, imageUrl, topic) {
  await savePendingPost({ text: post, imageUrl, topic })
  const caption = `📝 *Превью поста:*\n\n${post}`
  const markup = previewInline()
  if (imageUrl) {
    console.log('[tg] downloading image for preview...')
    const buf = await fetchImageBuffer(imageUrl)
    if (buf) {
      console.log('[tg] sending preview photo, size:', buf.length)
      await tgSendPhoto(chatId, buf, caption, { reply_markup: JSON.stringify(markup) })
      return
    }
    console.warn('[tg] preview image download failed, text only')
  }
  await tgApi('sendMessage', {
    chat_id: chatId, text: caption,
    parse_mode: 'Markdown', reply_markup: markup,
  })
}

// Core flow: generate post + image, then auto-publish or preview
async function generateAndHandle(chatId, topic, forcePreview = false) {
  console.log('[tg] generateAndHandle start, topic:', topic.slice(0, 40))
  console.log('[tg] generating post...')
  const post = await withTimeout(generatePost(topic), 40000, 'post')
  console.log('[tg] post done, length:', post.length)
  console.log('[tg] generating image...')
  const imageUrl = await generateImage(topic).catch(err => {
    console.warn('[tg] image generation threw:', err.message)
    return null
  })
  console.log('[tg] imageUrl:', imageUrl ? 'ok' : 'null')
  if (!imageUrl && OWNER_ID) {
    await sendTo(OWNER_ID, '⚠️ Изображение не сгенерировалось (Flux), публикую без него').catch(() => {})
  }
  if (config.autoPublish && !forcePreview) {
    const pubResAuto = await publishToChannel(post, imageUrl)
    const autoLink = channelPostLink(pubResAuto)
    if (autoLink) await sendTo(chatId, `✅ Опубликовано в канал (автопубликация): ${autoLink}`)
    else await sendTo(chatId, `❌ Не удалось опубликовать: ${pubResAuto?.description ?? 'нет ответа от Telegram'}`)
  } else {
    await showPreview(chatId, post, imageUrl, topic)
  }
}

// ── Public inline callback handler (non-owner users) ─────────────────────────
async function handlePublicCallback(cq) {
  const chatId    = cq.message?.chat?.id
  const msgId     = cq.message?.message_id
  const data      = cq.data ?? ''
  const username  = cq.from?.username
  const firstName = cq.from?.first_name

  if (data === 'pay_card') {
    await tgApi('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
    await tgApi('sendMessage', {
      chat_id: chatId,
      text:
        '💳 Оплата картой и через СБП — на сайте:\n' +
        '[lefiro.co/billing](https://lefiro.co/billing)\n\n' +
        'Там оплата проходит автоматически, с чеком, тариф\n' +
        'активируется сразу. Войдите в аккаунт и выберите план.\n\n' +
        'Для оплаты криптовалютой (USDT) вернитесь и выберите\n' +
        'соответствующий способ.',
      parse_mode: 'Markdown',
      reply_markup: payBackInline(),
    })
    return
  }

  if (data === 'pay_crypto') {
    const pst = payStates.get(String(chatId)) || {}

    // Deep-link flow: plan already known — show details immediately
    if (pst.step === 'method_for_plan' && pst.plan) {
      const planInfo = PAY_PLANS[pst.plan]
      if (planInfo) {
        payStates.set(String(chatId), { ...pst, step: 'awaiting_proof', method: 'crypto' })
        await tgApi('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
        await tgApi('sendMessage', { chat_id: chatId, text: cryptoPaymentText(planInfo), parse_mode: 'Markdown', reply_markup: payBackInline() })
        await notifyOwnerNewPayment(chatId, username || pst.username, firstName || pst.firstName, 'crypto', planInfo)
        return
      }
    }

    // Regular flow: ask for plan
    payStates.set(String(chatId), { step: 'plan', method: 'crypto', username, firstName })
    await tgApi('editMessageText', {
      chat_id: chatId, message_id: msgId,
      text: '📦 *Укажи какой тариф хочешь оплатить:*',
      parse_mode: 'Markdown',
      reply_markup: payPlanInline(),
    })
    return
  }

  if (data.startsWith('pay_plan_')) {
    const plan     = data.slice(9) // strip 'pay_plan_'
    const planInfo = PAY_PLANS[plan]
    if (!planInfo) return

    const pst = payStates.get(String(chatId)) || {}
    payStates.set(String(chatId), { ...pst, step: 'awaiting_proof', plan, method: 'crypto' })

    await tgApi('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
    await tgApi('sendMessage', { chat_id: chatId, text: cryptoPaymentText(planInfo), parse_mode: 'Markdown', reply_markup: payBackInline() })
    await notifyOwnerNewPayment(chatId, username || pst.username, firstName || pst.firstName, 'crypto', planInfo)
    return
  }

  if (data === 'pay_back') {
    // Restore method selection, keep plan context if it was a deep-link flow
    const pst = payStates.get(String(chatId)) || {}
    const prevStep = pst.plan ? 'method_for_plan' : 'method'
    payStates.set(String(chatId), { ...pst, step: prevStep, method: undefined })
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: pst.plan
        ? `📦 Тариф: *${PAY_PLANS[pst.plan]?.name ?? pst.plan}*\n\nВыбери способ оплаты:`
        : '👋 Выбери удобный способ оплаты:',
      parse_mode: 'Markdown',
      reply_markup: payMethodInline(),
    })
    return
  }

  if (data.startsWith('sup_cat_')) {
    const catKey = data.slice(8) // strip 'sup_cat_'
    const cat    = SUPPORT_CATEGORIES[catKey]
    if (!cat) return
    const sst = supportStates.get(String(chatId)) || {}
    supportStates.set(String(chatId), { ...sst, step: 'waiting_description', category: catKey })
    await tgApi('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
    await tgApi('sendMessage', {
      chat_id: chatId,
      text:
        `${cat.emoji} *${cat.label}*\n\n` +
        `Опиши проблему подробнее.\n` +
        `Напиши всё что случилось — мы постараемся помочь как можно быстрее 🙏`,
      parse_mode: 'Markdown',
    })
  }
}

// ── Inline button callback handler ────────────────────────────────────────────
async function handleCallback(cq) {
  const chatId = cq.message?.chat?.id
  const msgId  = cq.message?.message_id
  const data   = cq.data ?? ''
  const userId = String(cq.from?.id ?? '')

  await tgApi('answerCallbackQuery', { callback_query_id: cq.id })
  if (userId !== OWNER_ID) { await handlePublicCallback(cq).catch(console.error); return }

  const clearButtons = () =>
    tgApi('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })

  if (data === 'pub_ch' || data === 'pub_gr' || data === 'pub_both') {
    const post = await ensurePendingPost()
    if (!post) { await sendTo(chatId, 'Нет поста на одобрении'); return }
    await clearButtons()
    if (data === 'pub_ch') {
      const res = await publishToChannel(post.text, post.imageUrl)
      await clearPendingPost()
      const link = channelPostLink(res)
      if (link) await sendTo(chatId, `✅ Опубликовано в канал: ${link}`)
      else await sendTo(chatId, `❌ Ошибка: ${res?.description ?? 'нет ответа от Telegram'}`)
    } else if (data === 'pub_gr') {
      if (!groupConfig.groupId) { await sendTo(chatId, '❌ tg_group_id не настроен в bot_settings'); return }
      const res = await publishToChannel(post.text, post.imageUrl, 'group', groupConfig.threadNews)
      await clearPendingPost()
      const link = groupPostLink(res, groupConfig.threadNews)
      if (link) await sendTo(chatId, `✅ Опубликовано в группу: ${link}`)
      else await sendTo(chatId, `❌ Ошибка публикации в группу: ${res?.description ?? 'нет ответа'}`)
    } else {
      if (!groupConfig.groupId) await sendTo(chatId, '⚠️ tg_group_id не настроен — только канал')
      const res = await publishToChannel(post.text, post.imageUrl, 'both', groupConfig.threadNews)
      await clearPendingPost()
      const parts = []
      if (channelPostLink(res.channel)) parts.push(`📢 ${channelPostLink(res.channel)}`)
      else if (res.channel) parts.push('📢 ошибка канала')
      const grLink = groupPostLink(res.group, groupConfig.threadNews)
      if (grLink) parts.push(`💬 ${grLink}`)
      else if (groupConfig.groupId) parts.push('💬 ошибка группы')
      await sendTo(chatId, parts.length ? `✅ Опубликовано:\n${parts.join('\n')}` : '❌ Обе цели недоступны')
    }

  } else if (data === 'decline') {
    await clearPendingPost()
    await clearButtons()
    await sendTo(chatId, '❌ Пост отклонён')

  } else if (data === 'regen') {
    const post = await ensurePendingPost()
    if (!post) { await sendTo(chatId, 'Нет поста для регенерации'); return }
    const topic = post.topic
    await clearPendingPost()
    await clearButtons()
    await sendTo(chatId, '⏳ Перегенерирую...')
    await generateAndHandle(chatId, topic, true) // always preview on regen

  } else if (data === 'toggle_auto') {
    config.autoPublish = !config.autoPublish
    await setSetting('auto_publish', config.autoPublish)
    await tgApi('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: settingsInline() })
    await sendTo(chatId, config.autoPublish
      ? '🟢 Автопубликация *включена* — посты публикуются сразу'
      : '🔴 Автопубликация *выключена* — посты идут на подтверждение')

  } else if (data === 'toggle_monitor') {
    // legacy toggle — flip between daily and off
    monitorConfig.interval = monitorConfig.interval === 'off' ? 'daily' : 'off'
    await setSetting('monitor_interval', monitorConfig.interval)
    await tgApi('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: settingsInline() })
    await sendTo(chatId, monitorConfig.interval === 'off'
      ? '🔴 Мониторинг *выключен*'
      : '🟢 Мониторинг *включён* (1 раз в день)')

  } else if (data === 'mi_menu') {
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: '📡 *Интервал мониторинга*\n\nВыбери как часто бот проверяет источники:',
      parse_mode: 'Markdown',
      reply_markup: monitorIntervalInline(),
    })

  } else if (['mi_daily', 'mi_twice', 'mi_weekly', 'mi_off'].includes(data)) {
    monitorConfig.interval = data.slice(3) // strip 'mi_'
    await setSetting('monitor_interval', monitorConfig.interval)
    await tgApi('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: monitorIntervalInline() })
    await sendTo(chatId, `✅ Интервал мониторинга: *${INTERVAL_LABELS[monitorConfig.interval]}*`)

  } else if (data === 'ppd_menu') {
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: '📝 *Постов в день из контент-плана*\n\nВыбери сколько постов публиковать:',
      parse_mode: 'Markdown',
      reply_markup: postsPerDayInline(),
    })

  } else if (['ppd_1', 'ppd_2', 'ppd_3', 'ppd_5'].includes(data)) {
    planConfig.postsPerDay = parseInt(data.slice(4), 10)
    await setSetting('posts_per_day', planConfig.postsPerDay)
    const schedule = POST_SCHEDULES[planConfig.postsPerDay]
    const times = schedule.map(h => `${String(h).padStart(2, '0')}:00`).join(', ')
    await tgApi('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: postsPerDayInline() })
    await sendTo(chatId, `✅ Постов в день: *${planConfig.postsPerDay}*\n⏰ Публикации в: *${times} UTC*`)

  } else if (data === 'dep_pub_ch' || data === 'dep_pub_gr' || data === 'dep_pub_both') {
    if (!pendingDeployPost) { await sendTo(chatId, 'Нет поста на одобрении'); return }
    const deployText = pendingDeployPost.text
    await clearButtons()
    if (data === 'dep_pub_ch') {
      const res = await publishToChannel(deployText)
      pendingDeployPost = null
      const link = channelPostLink(res)
      if (link) await sendTo(chatId, `✅ Пост об обновлении опубликован: ${link}`)
      else await sendTo(chatId, `❌ Ошибка: ${res?.description ?? 'нет ответа от Telegram'}`)
    } else if (data === 'dep_pub_gr') {
      if (!groupConfig.groupId) { await sendTo(chatId, '❌ tg_group_id не настроен в bot_settings'); return }
      const res = await publishToChannel(deployText, null, 'group', groupConfig.threadUpdates)
      pendingDeployPost = null
      const link = groupPostLink(res, groupConfig.threadUpdates)
      if (link) await sendTo(chatId, `✅ Пост об обновлении опубликован в группу: ${link}`)
      else await sendTo(chatId, `❌ Ошибка публикации в группу: ${res?.description ?? 'нет ответа'}`)
    } else {
      if (!groupConfig.groupId) await sendTo(chatId, '⚠️ tg_group_id не настроен — только канал')
      const res = await publishToChannel(deployText, null, 'both', groupConfig.threadUpdates)
      pendingDeployPost = null
      const parts = []
      if (channelPostLink(res.channel)) parts.push(`📢 ${channelPostLink(res.channel)}`)
      else if (res.channel) parts.push('📢 ошибка канала')
      const grLink = groupPostLink(res.group, groupConfig.threadUpdates)
      if (grLink) parts.push(`💬 ${grLink}`)
      else if (groupConfig.groupId) parts.push('💬 ошибка группы')
      await sendTo(chatId, parts.length ? `✅ Опубликовано:\n${parts.join('\n')}` : '❌ Обе цели недоступны')
    }

  } else if (data === 'dep_skip') {
    pendingDeployPost = null
    await clearButtons()
    await sendTo(chatId, '⏭ Пост об обновлении пропущен')

  } else if (data === 'mon_pub_ch' || data === 'mon_pub_gr' || data === 'mon_pub_both') {
    if (!pendingMonitorPost) { await sendTo(chatId, 'Нет поста на одобрении'); return }
    const monText = pendingMonitorPost.post
    await clearButtons()
    if (data === 'mon_pub_ch') {
      const res = await publishToChannel(monText)
      pendingMonitorPost = null
      const link = channelPostLink(res)
      if (link) await sendTo(chatId, `✅ Опубликовано в канал: ${link}`)
      else await sendTo(chatId, `❌ Ошибка: ${res?.description ?? 'нет ответа от Telegram'}`)
    } else if (data === 'mon_pub_gr') {
      if (!groupConfig.groupId) { await sendTo(chatId, '❌ tg_group_id не настроен в bot_settings'); return }
      const res = await publishToChannel(monText, null, 'group', groupConfig.threadNews)
      pendingMonitorPost = null
      const link = groupPostLink(res, groupConfig.threadNews)
      if (link) await sendTo(chatId, `✅ Опубликовано в группу (новости): ${link}`)
      else await sendTo(chatId, `❌ Ошибка публикации в группу: ${res?.description ?? 'нет ответа'}`)
    } else {
      if (!groupConfig.groupId) await sendTo(chatId, '⚠️ tg_group_id не настроен — только канал')
      const res = await publishToChannel(monText, null, 'both', groupConfig.threadNews)
      pendingMonitorPost = null
      const parts = []
      if (channelPostLink(res.channel)) parts.push(`📢 ${channelPostLink(res.channel)}`)
      else if (res.channel) parts.push('📢 ошибка канала')
      const grLink = groupPostLink(res.group, groupConfig.threadNews)
      if (grLink) parts.push(`💬 ${grLink}`)
      else if (groupConfig.groupId) parts.push('💬 ошибка группы')
      await sendTo(chatId, parts.length ? `✅ Опубликовано:\n${parts.join('\n')}` : '❌ Обе цели недоступны')
    }

  } else if (data === 'mon_skip') {
    pendingMonitorPost = null
    await clearButtons()
    await sendTo(chatId, '⏭ Пропущено')

  } else if (data === 'mon_edit') {
    if (!pendingMonitorPost) { await sendTo(chatId, 'Нет поста для редактирования'); return }
    await clearButtons()
    awaitingEdit = true
    await sendTo(chatId,
      `✏️ *Редактирование поста*\n\nОтправь исправленный текст:\n\n${pendingMonitorPost.post}`)

  } else if (data === 'mon_regen') {
    await clearButtons()
    await regenMonitorPost(chatId)

  } else if (data === 'mon_scan') {
    await clearButtons()
    await sendTo(chatId, '🔍 Запускаю проверку источников...')
    runMonitor().catch(err => {
      console.error('[monitor] manual scan error:', err.message)
      sendTo(chatId, `❌ Ошибка при проверке: ${err.message.slice(0, 100)}`)
    })

  } else if (data === 'plan_add') {
    awaitingPlan = true
    await clearButtons()
    await sendTo(chatId,
      '📝 Отправь список тем для постинга, каждая с новой строки:\n\n' +
      '_Пример:_\nОчеловечивание текста\n321 голос на 28 языках\nИллюстрации с субтитрами')

  } else if (data === 'plan_clear') {
    const stats = await getQueueStats()
    const cleared = stats.pending
    await clearPendingQueue()
    await clearButtons()
    await sendTo(chatId, `🗑 Очищено тем из очереди: *${cleared}*`)

  } else if (data === 'plan_pause') {
    planConfig.paused = !planConfig.paused
    await setSetting('plan_paused', planConfig.paused)
    await tgApi('editMessageText', {
      chat_id: chatId, message_id: msgId,
      text: await planStatusText(),
      parse_mode: 'Markdown',
      reply_markup: planInline(),
    })
    await sendTo(chatId, planConfig.paused
      ? '⏸ Автопостинг *приостановлен*'
      : '▶️ Автопостинг *возобновлён*')

  } else if (data === 'plan_post_now') {
    await clearButtons()
    const queue = await getQueue()
    const next = queue[0] ?? null
    if (!next) { await sendTo(chatId, '📭 Очередь пуста'); return }
    await sendTo(chatId, `⏳ Публикую: *${next.topic.slice(0, 60)}*`)
    await postFromQueue(chatId)

  } else if (data === 'plan_set_time') {
    awaitingTime = true
    await sendTo(chatId,
      `⏰ Текущее время постинга: *${String(planConfig.postHour).padStart(2, '0')}:00 UTC*\n\n` +
      'Отправь новое время (час, 0–23):\n_Например: `10` или `18`_')

  } else if (data === 'plan_decline') {
    const queue = await getQueue()
    const item = queue[0] ?? null
    if (item) await markDeclined(item.id)
    await clearButtons()
    await sendTo(chatId, '❌ Тема из плана отклонена')

  } else if (data.startsWith('activate::') || data.startsWith('activate_')) {
    let plan, userChatId, claimId
    if (data.startsWith('activate::')) {
      // New format: activate::topup_500::12345678::claimId
      const parts = data.split('::')
      plan        = parts[1]
      userChatId  = parts[2]
      claimId     = parts[3] ?? null
    } else {
      // Legacy format (pre-topup fix, no claimId): activate_starter_12345678
      const idx   = data.indexOf('_', 'activate_'.length)
      plan        = data.slice('activate_'.length, idx === -1 ? undefined : idx)
      userChatId  = idx === -1 ? '' : data.slice(idx + 1)
      claimId     = null
    }
    const planInfo = PAY_PLANS[plan]
    if (!planInfo) return
    awaitingActivate = { userChatId, plan, planInfo, claimId }
    await clearButtons()
    await sendTo(chatId,
      `✅ *Активация тарифа ${planInfo.name}*\n\n` +
      `Пользователь: \`${userChatId}\`\n\n` +
      `Введи email пользователя в Lefiro:`)

  } else if (data.startsWith('sup_reply_')) {
    // sup_reply_{userChatId}_{ticketNumber}
    const parts        = data.split('_')
    const userChatId   = parts[2]
    const ticketNumber = parts[3]
    awaitingSupportReply = { userChatId, ticketNumber }
    await clearButtons()
    await sendTo(chatId,
      `💬 *Ответ на заявку #${ticketNumber}*\n\n` +
      `Напиши ответ пользователю (ID: \`${userChatId}\`):\n` +
      `_Следующее сообщение будет отправлено пользователю_`)
  }
  // 'noop' → ignore
}

// ── Webhook ───────────────────────────────────────────────────────────────────
app.post('/telegram/webhook', async (req, res) => {
  res.json({ ok: true })
  if (!BOT_TOKEN) return

  // Inline button press
  if (req.body?.callback_query) {
    await handleCallback(req.body.callback_query).catch(console.error)
    return
  }

  const message = req.body?.message
  if (!message) return

  const userId      = String(message.from?.id ?? '')
  const chatId      = message.chat?.id
  const text        = (message.text ?? '').trim()
  const chatType    = message.chat?.type            // 'private' | 'group' | 'supergroup' | 'channel'
  const msgThreadId = message.message_thread_id ?? null

  // In group/supergroup chats: stay silent unless the message is a reply to the bot
  // or a direct @-command (e.g. /help@Lefiro_bot). This prevents flooding community chats.
  if (chatType === 'group' || chatType === 'supergroup') {
    const isReplyToBot = message.reply_to_message?.from?.is_bot === true
    const isMentionCmd = text.startsWith('/') && text.includes('@')
    if (!isReplyToBot && !isMentionCmd) return
  }

  // ── Public users ──────────────────────────────────────────────────────────
  if (userId !== OWNER_ID) {
    const isCommand = text.startsWith('/')

    // ── Support: waiting for description ────────────────────────────────────
    const sst = supportStates.get(String(chatId))
    console.log('[support] state lookup for chatId:', chatId, '→', sst ? `step=${sst.step}` : 'no state')
    if (sst?.step === 'waiting_description' && !isCommand && text) {
      console.log('[support] description received from userId:', userId, 'chatId:', chatId)
      console.log('[support] category:', sst.category)
      console.log('[support] sending to owner:', OWNER_ID)

      const cat          = SUPPORT_CATEGORIES[sst.category]
      const ticketNumber = await createSupportTicket(chatId, sst.username || message.from?.username, sst.category, text)
      console.log('[support] ticket saved, ticketNumber:', ticketNumber)
      supportStates.delete(String(chatId))

      const ticketLabel = ticketNumber ? `#${ticketNumber}` : '#—'
      await tgApi('sendMessage', {
        chat_id: chatId,
        text:
          `✅ *Заявка принята!*\n\n` +
          `Категория: ${cat?.label ?? sst.category}\n` +
          `Номер заявки: *${ticketLabel}*\n\n` +
          `Мы свяжемся с тобой в течение 24 часов.\n` +
          `Спасибо за обращение!`,
        parse_mode: 'Markdown',
      })

      if (OWNER_ID) {
        const userDisplay = sst.username ? `@${sst.username}` : (sst.firstName || String(chatId))
        const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        const replyButton = ticketNumber
          ? [{ text: '💬 Ответить пользователю', callback_data: `sup_reply_${chatId}_${ticketNumber}` }]
          : [{ text: '💬 Ответить пользователю', callback_data: `sup_reply_${chatId}_0` }]
        const ownerText =
          `🆘 Новая заявка в поддержку!\n\n` +
          `Заявка: ${ticketLabel}\n` +
          `Пользователь: ${userDisplay} (ID: ${chatId})\n` +
          `Категория: ${cat?.label ?? sst.category}\n` +
          `Время: ${now} МСК\n\n` +
          `Описание:\n${text}`
        console.log('[support] notifying owner NOW, chat_id:', OWNER_ID)
        const ownerRes = await tgApi('sendMessage', {
          chat_id: OWNER_ID,
          text: ownerText,
          reply_markup: { inline_keyboard: [replyButton] },
        })
        console.log('[support] owner response:', JSON.stringify(ownerRes))
      } else {
        console.warn('[support] OWNER_ID not set — cannot notify owner')
      }
      return
    }

    // ── Payment: waiting for proof ──────────────────────────────────────────
    const pst = payStates.get(String(chatId))
    if (pst?.step === 'awaiting_proof' && pst.method === 'crypto' && !isCommand && (message.photo || message.document || message.text)) {
      await forwardProofToOwner(chatId, message, pst).catch(err => {
        console.error('[pay] forwardProof error:', err.message)
        tgApi('sendMessage', { chat_id: chatId, text: '✅ Получено! Ожидай активации в течение 1 часа.' })
      })
      return
    }

    // ── /start router + /menu ───────────────────────────────────────────────
    if (text === '/start' || text.startsWith('/start ') || text === '/pay' || text === '/menu') {
      // /menu — refresh keyboard without touching payment/support state
      if (text === '/menu') {
        await tgApi('sendMessage', { chat_id: chatId, text: 'Выберите раздел 👇', reply_markup: PUBLIC_KB })
        return
      }

      payStates.delete(String(chatId))
      supportStates.delete(String(chatId))
      const startArg  = text.startsWith('/start ') ? text.slice(7).trim() : ''
      const username  = message.from?.username
      const firstName = message.from?.first_name

      // Deep link: link_<token> — Telegram binding from the web app
      if (startArg.startsWith('link_')) {
        const token = startArg.slice(5)
        try {
          const rows = await sbGet('tg_link_tokens', `token=eq.${encodeURIComponent(token)}&select=user_id,expires_at,used_at,created_at`)
          if (!rows || rows.length === 0) {
            await safeSendMessage(chatId, '❌ Ссылка недействительна. Получите новую в настройках сервиса: lefiro.co/settings')
            return
          }
          const row = rows[0]
          if (row.used_at) {
            await safeSendMessage(chatId, '❌ Ссылка уже была использована. Получите новую в настройках сервиса: lefiro.co/settings')
            return
          }
          if (new Date(row.expires_at) < new Date()) {
            await safeSendMessage(chatId, '❌ Ссылка устарела — она действует 60 минут. Получите новую в настройках сервиса: lefiro.co/settings')
            return
          }
          await sbPatch('profiles', `id=eq.${row.user_id}`, { telegram_chat_id: String(chatId) })
          await sbPatch('tg_link_tokens', `token=eq.${encodeURIComponent(token)}`, { used_at: new Date().toISOString() })
          await safeSendMessage(chatId,
            '✅ *Telegram подключён!*\n\n' +
            'Теперь вы будете получать уведомления:\n' +
            '• Иллюстрации сгенерированы\n' +
            '• Озвучка готова\n' +
            '• Видео собрано\n\n' +
            'Уведомление придёт сюда, как только задача завершится.',
            { parse_mode: 'Markdown' }
          )

          // Catch-up: job may have finished between "Подключить" click and pressing START in Telegram.
          // Only notify for jobs completed AFTER the token was created (= user clicked "Подключить").
          // If no job is currently running, check for such completed jobs and notify now.
          try {
            const uid = row.user_id
            const tokenCreatedAt = row.created_at
            const [actImg, actAud, actVid] = await Promise.all([
              sbGet('image_jobs', `user_id=eq.${uid}&status=in.(pending,processing)&select=id`),
              sbGet('audio_jobs', `user_id=eq.${uid}&status=in.(pending,processing)&select=id`),
              sbGet('video_jobs', `user_id=eq.${uid}&status=in.(pending,processing)&select=id`),
            ])
            const hasActive = (actImg?.length || 0) + (actAud?.length || 0) + (actVid?.length || 0) > 0
            if (!hasActive) {
              const [doneImg, doneAud, doneVid] = await Promise.all([
                sbGet('image_jobs', `user_id=eq.${uid}&status=eq.completed&completed_at=gte.${encodeURIComponent(tokenCreatedAt)}&order=completed_at.desc&limit=1&select=scene_images`),
                sbGet('audio_jobs', `user_id=eq.${uid}&status=eq.completed&completed_at=gte.${encodeURIComponent(tokenCreatedAt)}&limit=1&select=id`),
                sbGet('video_jobs', `user_id=eq.${uid}&status=eq.completed&completed_at=gte.${encodeURIComponent(tokenCreatedAt)}&limit=1&select=id`),
              ])
              const parts = []
              if (doneImg?.length) {
                const count = Array.isArray(doneImg[0].scene_images) ? doneImg[0].scene_images.filter(Boolean).length : 0
                parts.push(`🖼 Иллюстрации готовы! (${count} шт.)`)
              }
              if (doneAud?.length) parts.push('🎙 Озвучка готова!')
              if (doneVid?.length) parts.push('🎬 Видео готово!')
              if (parts.length > 0) {
                console.log(`[link] catch-up notify user=${uid} chat_id=${chatId}: ${parts.join(', ')}`)
                await safeSendMessage(chatId, parts.join('\n') + `\nПерейти в студию: ${APP_URL}/studio`)
              } else {
                console.log(`[link] catch-up: no recent completed jobs for user=${uid}`)
              }
            } else {
              console.log(`[link] catch-up: active job found for user=${uid}, skip (will notify on completion)`)
            }
          } catch (catchUpErr) {
            console.warn('[link] catch-up check failed:', catchUpErr.message)
          }
        } catch (e) {
          console.error('[link] error:', e.message)
          await safeSendMessage(chatId, '❌ Ошибка при привязке. Попробуйте позже.').catch(() => {})
        }
        return
      }

      // Deep link: support
      if (startArg === 'support') {
        supportStates.set(String(chatId), { step: 'waiting_category', username, firstName })
        await tgApi('sendMessage', {
          chat_id: chatId,
          text:
            `👋 Привет! Я помогу решить твой вопрос.\n\n` +
            `Выбери тему обращения:`,
          parse_mode: 'Markdown',
          reply_markup: supportCategoryInline(),
        })
        return
      }

      // Deep link: pay_<plan>
      if (startArg.startsWith('pay_') && startArg !== 'pay') {
        const planKey  = startArg.slice(4)
        const planInfo = PAY_PLANS[planKey]
        if (planInfo) {
          payStates.set(String(chatId), { step: 'method_for_plan', plan: planKey, username, firstName })
          const rate      = await getUsdToRub()
          const rubAmount = planInfo.usd ? Math.ceil(planInfo.usd * rate) : null
          const rubNote   = rubAmount ? ` (~${rubAmount} ₽)` : ''
          await tgApi('sendMessage', {
            chat_id: chatId,
            text:
              `💳 *Оплата тарифа ${planInfo.name}*\n\n` +
              `📦 Тариф: *${planInfo.name}* — ${fmtCr(planInfo.credits)} кредитов\n` +
              `💰 Стоимость: *${planInfo.price}*${rubNote}\n\n` +
              `Выбери способ оплаты:`,
            parse_mode: 'Markdown',
            reply_markup: payMethodInline(),
          })
          return
        }
      }

      // Default /start — welcome + public keyboard + payment options
      await tgApi('sendMessage', {
        chat_id: chatId,
        text:
          '👋 Привет! Это *[Lefiro](https://lefiro.co)* — сервис, который\n' +
          'превращает идею в готовый ролик для YouTube.\n\n' +
          'Анализирует нишу и конкурентов, пишет сценарий, озвучивает,\n' +
          'генерирует иллюстрации, готовит SEO и собирает видео.\n\n' +
          'Нужен только текст задумки. Остальное — на нас.\n\n' +
          'Я бот-консультант: отвечаю на вопросы о сервисе, тарифах и оплате.\n' +
          'Спросите, например:\n\n' +
          '- Сколько стоит попробовать сервис?\n' +
          '- Как это работает?\n' +
          '- Как оплатить из-за рубежа?\n\n' +
          'Пишите вопрос прямо в чат или выберите раздел в меню внизу 👇',
        parse_mode: 'Markdown',
        reply_markup: PUBLIC_KB,
      })
      await tgApi('sendMessage', {
        chat_id: chatId,
        text: 'Для оплаты Lefiro из России выбери удобный способ:',
        reply_markup: payMethodInline(),
      })
      return
    }

    // ── Reply keyboard shortcuts ───────────────────────────────────────────────
    if (text === '🆘 Поддержка') {
      const username  = message.from?.username
      const firstName = message.from?.first_name
      supportStates.set(String(chatId), { step: 'waiting_category', username, firstName })
      await tgApi('sendMessage', {
        chat_id: chatId,
        text: '👋 Выбери тему обращения:',
        parse_mode: 'Markdown',
        reply_markup: supportCategoryInline(),
      })
      return
    }

    const KB_QUERIES = {
      '💰 Тарифы и цены':    'Расскажи о тарифах и ценах',
      '🎬 Как это работает': 'Как работает сервис, из каких шагов',
      '❓ Частые вопросы':   'Какие вопросы задают чаще всего',
    }
    if (KB_QUERIES[text] && lefiroKB) {
      await runConsultant(chatId, KB_QUERIES[text])
      return
    }

    // ── AI consultant (P3.5) ───────────────────────────────────────────────────
    // Fires only when KB is loaded, no command, no active support/pay state.
    // P1 and P2 already returned above; P4 catch-all follows below.
    if (lefiroKB && text && !isCommand
        && !supportStates.get(String(chatId))
        && !payStates.get(String(chatId))) {
      await runConsultant(chatId, text)
      return
    }

    const threadOpt = msgThreadId ? { message_thread_id: msgThreadId } : {}
    await tgApi('sendMessage', { chat_id: chatId, text: 'Используй /start для оплаты или обращения в поддержку.', ...threadOpt })
    return
  }

  console.log('[tg] msg:', text.slice(0, 60))

  // Owner: awaiting support reply text
  if (awaitingSupportReply && text && !text.startsWith('/')) {
    const { userChatId, ticketNumber } = awaitingSupportReply
    awaitingSupportReply = null
    await tgApi('sendMessage', {
      chat_id: userChatId,
      text:
        `📩 *Ответ от поддержки Lefiro:*\n\n` +
        `${text}\n\n` +
        `_Если вопрос не решён — просто напиши нам снова._`,
      parse_mode: 'Markdown',
    })
    await sendTo(chatId, `✅ Ответ на заявку *#${ticketNumber}* отправлен пользователю`)
    return
  }

  // Owner: awaiting email for Russia payment activation
  if (awaitingActivate && text && !text.startsWith('/')) {
    const { userChatId, plan, planInfo, claimId } = awaitingActivate
    awaitingActivate = null
    const email = text.trim()
    await sendTo(chatId, `⏳ Активирую *${planInfo.name}* для \`${email}\`...`)
    try {
      const result = await activateUserPlan(email, plan, claimId, userChatId)
      if (result.already_activated) {
        await sendTo(chatId, `⚠️ Заявка уже была активирована ранее для *${email}* — повторное начисление пропущено.`)
        return
      }
      if (result.data?.topup) {
        // Topup: only credits added, plan unchanged
        const creditsAdded = result.data.credits
        await sendTo(chatId, `✅ Топап *${fmtCr(creditsAdded)} кредитов* начислен для *${email}*`)
        await tgApi('sendMessage', {
          chat_id: userChatId,
          text:
            `🎉 *Пополнение баланса!*\n\n` +
            `*${fmtCr(creditsAdded)} кредитов* успешно добавлены на ваш аккаунт.\n\n` +
            `Войдите в Lefiro: ${APP_URL}`,
          parse_mode: 'Markdown',
        })
      } else {
        // Subscription plan
        await sendTo(chatId, `✅ Тариф *${planInfo.name}* активирован для *${email}*`)
        await tgApi('sendMessage', {
          chat_id: userChatId,
          text:
            `🎉 *Тариф активирован!*\n\n` +
            `Тариф *${planInfo.name}* успешно активирован на вашем аккаунте.\n\n` +
            `Войдите в Lefiro: ${APP_URL}`,
          parse_mode: 'Markdown',
        })
      }
    } catch (err) {
      await sendTo(chatId, `❌ Ошибка активации: ${err.message}`)
    }
    return
  }

  // Awaiting edited text from "✏️ Редактировать" on monitor post
  if (awaitingEdit && text && !text.startsWith('/')) {
    awaitingEdit = false
    if (pendingMonitorPost) {
      pendingMonitorPost.post = text
      await tgApi('sendMessage', {
        chat_id: chatId,
        text: '✅ Текст обновлён. Публикуем?',
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📢 В канал',  callback_data: 'mon_pub_ch'   },
              { text: '💬 В группу', callback_data: 'mon_pub_gr'   },
              { text: '🌐 Везде',    callback_data: 'mon_pub_both' },
            ],
            [{ text: '❌ Отмена', callback_data: 'mon_skip' }],
          ],
        },
      })
    }
    return
  }

  // Awaiting list of topics for content plan
  if (awaitingPlan && text && !text.startsWith('/')) {
    awaitingPlan = false
    const topics = text.split('\n').map(t => t.trim()).filter(t => t.length > 0)
    if (!topics.length) { await sendTo(chatId, '❌ Список тем пуст'); return }
    await addToQueue(topics)
    const stats = await getQueueStats()
    await sendTo(chatId,
      `✅ Добавлено тем: *${topics.length}*\n` +
      `📋 Всего в очереди: *${stats.pending}*\n` +
      `⏰ Следующая публикация: *${String(planConfig.postHour).padStart(2, '0')}:00 UTC*`)
    return
  }

  // Awaiting new posting hour
  if (awaitingTime && text && !text.startsWith('/')) {
    awaitingTime = false
    const match = text.match(/\d+/)
    const hour = match ? Math.min(23, Math.max(0, parseInt(match[0], 10))) : null
    if (hour === null) { await sendTo(chatId, '❌ Укажи час от 0 до 23'); return }
    planConfig.postHour = hour
    await setSetting('post_time', `${String(hour).padStart(2, '0')}:00`)
    await sendTo(chatId,
      `✅ Время постинга обновлено: *${String(hour).padStart(2, '0')}:00 UTC*`)
    return
  }

  // Awaiting free-text topic after "✍️ Написать пост"
  if (awaitingTopic && text && !text.startsWith('/')) {
    awaitingTopic = false
    await sendTo(chatId, '⏳ Генерирую пост и изображение...')
    await generateAndHandle(chatId, text)
    return
  }

  try {
    switch (true) {
      case (text === '/start' || text === '/help'):
        await sendTo(chatId,
          '🤖 *Lefiro Bot*\n\n' +
          'Используй кнопки внизу или команды:\n' +
          '`/post [тема]` — сгенерировать и опубликовать\n' +
          '`/preview [тема]` — посмотреть перед публикацией\n' +
          '`/stats` — статистика в канал\n' +
          '`/idea` — случайная тема\n' +
          '`/settings` — настройки'
        )
        break

      case (text === '💡 Идея' || text === '/idea'): {
        console.log('[idea] step1: sendTo thinking')
        await sendTo(chatId, '⏳ Придумываю тему...')
        console.log('[idea] step2: generateIdea')
        let idea
        try {
          idea = await withTimeout(generateIdea(), 30000, 'generateIdea')
        } catch (e) {
          console.error('[idea] generateIdea failed:', e.message)
          await sendTo(chatId, `❌ Ошибка генерации темы: ${e.message}`)
          break
        }
        console.log('[idea] step3: idea =', idea.slice(0, 60))
        await sendTo(chatId, `💡 *Тема:* ${idea}\n\n⏳ Генерирую пост...`)
        console.log('[idea] step4: generateAndHandle')
        await generateAndHandle(chatId, idea)
        console.log('[idea] step5: done')
        break
      }

      case (text === '📊 Статистика' || text === '/stats'):
        await sendTo(chatId, '⏳ Получаю статистику...')
        await publishStats(chatId)
        break

      case (text === '✍️ Написать пост'):
        awaitingTopic = true
        await sendTo(chatId, '✏️ Введите тему поста:')
        break

      case (text === '📡 Мониторинг'): {
        const iLabel = INTERVAL_LABELS[monitorConfig.interval] ?? 'daily'
        const status = monitorConfig.interval === 'off' ? '🔴 ВЫКЛ' : '🟢 ВКЛ'
        await tgApi('sendMessage', {
          chat_id: chatId,
          text:
            `📡 *Мониторинг контента*\n\n` +
            `Статус: ${status}\n` +
            `Интервал: *${iLabel}*\n` +
            `Источников: ${RSS_SOURCES.length} RSS лент\n` +
            `Ключевых слов: ${KEYWORDS.length}\n` +
            `Оцениваются: топ 5 по релевантности (score ≥ 7)\n\n` +
            `Материалы предлагаются владельцу на одобрение.`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🔍 Проверить сейчас', callback_data: 'mon_scan' },
              { text: '⏱ Изменить интервал', callback_data: 'mi_menu' },
            ]],
          },
        })
        break
      }

      case (text === '📅 Контент-план' || text === '/plan'): {
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: await planStatusText(),
          parse_mode: 'Markdown',
          reply_markup: planInline(),
        })
        break
      }

      case (text === '⚙️ Настройки' || text === '/settings'):
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: '⚙️ *Настройки бота*',
          parse_mode: 'Markdown',
          reply_markup: settingsInline(),
        })
        break

      case text.startsWith('/post '): {
        const topic = text.slice(6).trim()
        if (!topic) { await sendTo(chatId, 'Укажи тему: `/post тема`'); break }
        await sendTo(chatId, '⏳ Генерирую пост и изображение...')
        await generateAndHandle(chatId, topic)
        break
      }

      case text.startsWith('/preview '): {
        const topic = text.slice(9).trim()
        if (!topic) { await sendTo(chatId, 'Укажи тему: `/preview тема`'); break }
        await sendTo(chatId, '⏳ Генерирую пост и изображение...')
        await generateAndHandle(chatId, topic, true)
        break
      }

      default:
        if (!awaitingTopic && !awaitingPlan && !awaitingTime && !awaitingEdit) {
          const threadOpt = msgThreadId ? { message_thread_id: msgThreadId } : {}
          await safeSendMessage(chatId, 'Используй кнопки внизу или /help', threadOpt)
        }
    }
  } catch (err) {
    console.error('[tg/webhook]', err.message)
    const threadOpt = msgThreadId ? { message_thread_id: msgThreadId } : {}
    await safeSendMessage(chatId, `❌ Ошибка: ${err.message.slice(0, 120)}`, threadOpt)
  }
})

// ── Database backup to B2 ────────────────────────────────────────────────────
// SigV4 helper for backup bucket operations (GET list / PUT upload / DELETE)
function b2BackupSign(method, key, queryString, contentType, bodyHash) {
  const endpoint = env('B2_ENDPOINT').replace(/\/$/, '')
  const region   = env('B2_REGION') || 'us-east-005'
  const bucket   = env('B2_BACKUP_BUCKET') || 'youtubegen-db-backups'

  const now           = new Date()
  const amzDate       = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp     = amzDate.slice(0, 8)
  const service       = 's3'
  const credScope     = `${dateStamp}/${region}/${service}/aws4_request`

  const baseUrl   = key ? `${endpoint}/${bucket}/${key}` : `${endpoint}/${bucket}`
  const fullUrl   = queryString ? `${baseUrl}?${queryString}` : baseUrl
  const parsed    = new URL(fullUrl)
  const host      = parsed.hostname
  const urlPath   = parsed.pathname
  const canonicalQS = [...parsed.searchParams.entries()]
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const ctLine       = contentType ? `content-type:${contentType}\n` : ''
  const ctSigned     = contentType ? 'content-type;' : ''
  const canonHeaders = `${ctLine}host:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n`
  const signedHdrs   = `${ctSigned}host;x-amz-content-sha256;x-amz-date`

  const canonReq = [method, urlPath, canonicalQS, canonHeaders, signedHdrs, bodyHash].join('\n')
  const sts      = ['AWS4-HMAC-SHA256', amzDate, credScope, crypto.createHash('sha256').update(canonReq).digest('hex')].join('\n')
  const hmac     = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const backupKeyId  = env('B2_BACKUP_KEY_ID')  || env('B2_KEY_ID')
  const backupAppKey = env('B2_BACKUP_APPLICATION_KEY') || env('B2_APPLICATION_KEY')
  const sigKey   = hmac(hmac(hmac(hmac(`AWS4${backupAppKey}`, dateStamp), region), service), 'aws4_request')
  const sig      = crypto.createHmac('sha256', sigKey).update(sts).digest('hex')

  return {
    fullUrl,
    headers: {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      'x-amz-content-sha256': bodyHash,
      'x-amz-date': amzDate,
      'Authorization': `AWS4-HMAC-SHA256 Credential=${backupKeyId}/${credScope}, SignedHeaders=${signedHdrs}, Signature=${sig}`,
    },
  }
}

async function b2BackupUpload(buffer, key) {
  const bodyHash = crypto.createHash('sha256').update(buffer).digest('hex')
  const { fullUrl, headers } = b2BackupSign('PUT', key, '', 'application/gzip', bodyHash)
  const res = await fetch(fullUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Length': String(buffer.length) },
    body: buffer,
  })
  if (!res.ok) throw new Error(`[b2-backup] PUT ${key} → HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
}

async function b2BackupList() {
  const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  const { fullUrl, headers } = b2BackupSign('GET', '', 'list-type=2&prefix=backup_', '', emptyHash)
  const res = await fetch(fullUrl, { headers })
  if (!res.ok) throw new Error(`[b2-backup] LIST → HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
  const xml = await res.text()
  // Parse <Key> tags from S3 XML response
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1])
  return keys
}

async function b2BackupDelete(key) {
  const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  const { fullUrl, headers } = b2BackupSign('DELETE', key, '', '', emptyHash)
  const res = await fetch(fullUrl, { method: 'DELETE', headers })
  if (!res.ok && res.status !== 204) throw new Error(`[b2-backup] DELETE ${key} → HTTP ${res.status}`)
}

async function backupDatabase() {
  const supabaseUrl = SUPABASE_URL.replace(/\/$/, '')
  const serviceKey  = SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.warn('[backup] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping')
    return
  }

  const now = new Date()
  const ts  = now.toISOString().replace(/T/, '_').replace(/:/g, '').slice(0, 15)
  const key = `backup_${ts}.sql.gz`
  console.log(`[backup] starting REST backup → ${key}`)
  const t0 = Date.now()

  // Tables to include in backup (schema is in git; this captures live data)
  const tables = [
    'profiles', 'projects', 'credit_transactions',
    'analytics_events', 'analytics_reports',
    'bot_content_queue', 'bot_seen_urls', 'bot_settings',
    'support_tickets', 'sentry_alert_dedup',
  ]

  const hdrs = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  let sql = `-- Lefiro DB backup ${now.toISOString()}\n-- Source: Supabase REST API (service role)\n\n`

  for (const table of tables) {
    try {
      // Paginate in batches of 1000 (Supabase default max per request)
      const PAGE = 1000
      let allRows = []
      let offset  = 0
      while (true) {
        const res = await fetch(
          `${supabaseUrl}/rest/v1/${table}?select=*&limit=${PAGE}&offset=${offset}`,
          { headers: { ...hdrs, 'Range-Unit': 'items', Range: `${offset}-${offset + PAGE - 1}` } }
        )
        if (!res.ok) { console.warn(`[backup] ${table}: HTTP ${res.status}`); break }
        const rows = await res.json()
        if (!Array.isArray(rows) || rows.length === 0) break
        allRows = allRows.concat(rows)
        if (rows.length < PAGE) break
        offset += PAGE
      }

      if (allRows.length === 0) {
        sql += `-- Table ${table}: empty\n\n`
        console.log(`[backup] ${table}: empty`)
        continue
      }

      sql += `-- Table: ${table} (${allRows.length} rows)\n`
      for (const row of allRows) {
        const cols = Object.keys(row)
        const vals = cols.map(c => {
          const v = row[c]
          if (v === null || v === undefined) return 'NULL'
          if (typeof v === 'number') return String(v)
          if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
          if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`
          return `'${String(v).replace(/'/g, "''")}'`
        })
        sql += `INSERT INTO public.${table} (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT DO NOTHING;\n`
      }
      sql += '\n'
      console.log(`[backup] ${table}: ${allRows.length} rows`)
    } catch (e) {
      console.warn(`[backup] ${table} error:`, e.message)
      sql += `-- Table ${table}: error — ${e.message}\n\n`
    }
  }

  const buffer = await new Promise((resolve, reject) => {
    const chunks = []
    const gz = zlib.createGzip({ level: 6 })
    gz.on('data', chunk => chunks.push(chunk))
    gz.on('end', () => resolve(Buffer.concat(chunks)))
    gz.on('error', reject)
    gz.end(Buffer.from(sql, 'utf8'))
  })
  console.log(`[backup] dump ready: ${(buffer.length / 1024 / 1024).toFixed(2)} MB compressed`)

  await b2BackupUpload(buffer, key)
  console.log(`[backup] uploaded ${key} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  // Prune backups older than 30 days
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const keys   = await b2BackupList()
    const stale  = keys.filter(k => {
      const m = k.match(/backup_(\d{4}-\d{2}-\d{2})/)
      return m && new Date(m[1]) < cutoff
    })
    if (stale.length) {
      await Promise.all(stale.map(k => b2BackupDelete(k)))
      console.log(`[backup] pruned ${stale.length} old backup(s)`)
    } else {
      console.log('[backup] no old backups to prune')
    }
  } catch (pruneErr) {
    console.warn('[backup] prune failed:', pruneErr.message)
    Sentry.captureException(pruneErr, { extra: { stage: 'backup_prune' } })
  }

  // Record successful backup in bot_settings (read by admin panel)
  try {
    const sizeMb = (buffer.length / 1024 / 1024).toFixed(2)
    await Promise.all([
      setSetting('last_backup_at', new Date().toISOString()),
      setSetting('last_backup_status', 'success'),
      setSetting('last_backup_size_mb', sizeMb),
    ])
    console.log(`[backup] status written to bot_settings (${sizeMb} MB)`)
  } catch (e) { console.warn('[backup] status write failed:', e.message) }
}

// ── Media retention: B2 helpers (main bucket, not backup) ────────────────────
function b2MediaSign(method, key, queryString, contentType, bodyHash) {
  const endpoint = env('B2_ENDPOINT').replace(/\/$/, '')
  const region   = env('B2_REGION') || 'us-east-005'
  const bucket   = env('B2_BUCKET')
  const now      = new Date()
  const amzDate  = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp = amzDate.slice(0, 8)
  const service  = 's3'
  const credScope = `${dateStamp}/${region}/${service}/aws4_request`
  const baseUrl  = key ? `${endpoint}/${bucket}/${key}` : `${endpoint}/${bucket}`
  const fullUrl  = queryString ? `${baseUrl}?${queryString}` : baseUrl
  const parsed   = new URL(fullUrl)
  const canonicalQS = [...parsed.searchParams.entries()]
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const ctLine   = contentType ? `content-type:${contentType}\n` : ''
  const ctSigned = contentType ? 'content-type;' : ''
  const canonHeaders = `${ctLine}host:${parsed.hostname}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n`
  const signedHdrs   = `${ctSigned}host;x-amz-content-sha256;x-amz-date`
  const canonReq = [method, parsed.pathname, canonicalQS, canonHeaders, signedHdrs, bodyHash].join('\n')
  const sts      = ['AWS4-HMAC-SHA256', amzDate, credScope, crypto.createHash('sha256').update(canonReq).digest('hex')].join('\n')
  const hmac     = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const sigKey   = hmac(hmac(hmac(hmac(`AWS4${env('B2_APPLICATION_KEY')}`, dateStamp), region), service), 'aws4_request')
  const sig      = crypto.createHmac('sha256', sigKey).update(sts).digest('hex')
  return {
    fullUrl,
    headers: {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      'x-amz-content-sha256': bodyHash,
      'x-amz-date': amzDate,
      'Authorization': `AWS4-HMAC-SHA256 Credential=${env('B2_KEY_ID')}/${credScope}, SignedHeaders=${signedHdrs}, Signature=${sig}`,
    },
  }
}

// List all objects under prefix in the main B2 bucket; returns [{key, size}]
async function b2MediaListObjects(prefix) {
  const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  const qs = `list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`
  const { fullUrl, headers } = b2MediaSign('GET', '', qs, '', emptyHash)
  const res = await fetch(fullUrl, { headers })
  if (!res.ok) throw new Error(`b2MediaList prefix=${prefix} HTTP ${res.status}`)
  const xml = await res.text()
  const keys  = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1])
  const sizes = [...xml.matchAll(/<Size>([^<]+)<\/Size>/g)].map(m => parseInt(m[1], 10))
  const times = [...xml.matchAll(/<LastModified>([^<]+)<\/LastModified>/g)].map(m => new Date(m[1]).getTime())
  return keys.map((key, i) => ({ key, size: sizes[i] || 0, lastModified: times[i] || 0 }))
}

// Batch-delete keys from the main B2 bucket (S3 DeleteObjects, up to 1000/call)
async function b2MediaDeleteObjects(keys) {
  if (!keys.length) return
  const body = '<Delete>' + keys.map(k => `<Object><Key>${k}</Key></Object>`).join('') + '</Delete>'
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex')
  const { fullUrl, headers } = b2MediaSign('POST', '', 'delete', 'application/xml', bodyHash)
  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`b2MediaDeleteObjects HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const xml = await res.text().catch(() => '')
  const errs = [...xml.matchAll(/<Error>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<Message>([^<]+)<\/Message>[\s\S]*?<\/Error>/g)]
  for (const m of errs) console.warn('[retention/b2] delete error', m[1], m[2])
}

// ── Media retention: Supabase Storage helpers ─────────────────────────────────
// Returns objects relative to bucket root; name is the full path within the bucket.
async function supabaseStorageList(bucket, prefix) {
  const url = `${SUPABASE_URL}/storage/v1/object/list/${bucket}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`supabaseStorageList ${bucket}/${prefix}: ${res.status} ${text.slice(0, 200)}`)
  }
  const items = await res.json()
  return (Array.isArray(items) ? items : []).filter(item => item.id !== null)
}

// prefixes = full paths within the bucket (e.g. "userId/projectId/audio.mp3")
async function supabaseStorageRemove(bucket, prefixes) {
  if (!prefixes.length) return
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes }),
  })
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '')
    throw new Error(`supabaseStorageRemove ${bucket}: ${res.status} ${text.slice(0, 200)}`)
  }
}

// ── Media retention: main cleanup function ────────────────────────────────────
// Cron: daily 04:00 UTC. Safe default: dry-run unless RETENTION_DRY_RUN=false.
// NEW MODEL: projects row is NEVER deleted. Only media (images/audio/video) are purged.
// Sets media_purged_at on the project so UI can show banner and block render.
async function cleanupExpiredMedia() {
  const DRY_RUN = env('RETENTION_DRY_RUN') !== 'false'
  const tag = DRY_RUN ? '[retention/dry]' : '[retention]'
  console.log(`${tag} pass start, dry=${DRY_RUN}`)
  console.log(`${tag} thresholds: free=${RETENTION_MEDIA_HOURS.free}h paid=${RETENTION_MEDIA_HOURS.paid}h`)

  // 1. Collect project_ids with active jobs (never touch these)
  const activeProjectIds = new Set()
  try {
    const activeJobs = await sbGet('video_jobs', 'select=project_id&status=in.(pending,processing)')
    activeJobs.forEach(j => { if (j.project_id) activeProjectIds.add(j.project_id) })
    console.log(`${tag} active job projects: ${activeProjectIds.size}`)
  } catch (e) {
    console.error(`${tag} failed to fetch active jobs — aborting for safety:`, e.message)
    return
  }

  const now = Date.now()

  // 2B. Set media_expires_at ONCE for projects that don't have it yet (including stuck-generating ones).
  // Uses created_at — not updated_at — to avoid triggering on_projects_updated → updated_at reset.
  // Already-set values are never rewritten: no drift re-check, no daily overwrite cycle.
  let plannedCount = 0
  try {
    const liveRows = await sbGet('projects',
      `select=id,created_at` +
      `&media_purged_at=is.null` +
      `&media_expires_at=is.null` +
      `&or=(audio_url.not.is.null,video_url.not.is.null,scene_images.not.is.null,thumbnail_url.not.is.null)` +
      `&limit=2000`
    )
    for (const p of liveRows) {
      await sbPatch('projects', `id=eq.${p.id}`, { media_expires_at: computeMediaExpiry(p.created_at) })
      plannedCount++
    }
    console.log(`${tag} planned media_expires_at: set ${plannedCount} new projects`)
  } catch (e) {
    console.error(`${tag} planning step error (non-fatal):`, e.message)
    // Non-fatal: continue to deletion step
  }

  // 2. Candidates: projects whose media_expires_at has passed (set once from created_at, never overwritten).
  const isoNow = new Date(now).toISOString()
  let rawCandidates = []
  try {
    rawCandidates = await sbGet('projects',
      `select=id,user_id,media_expires_at,status,audio_url,video_url,scene_images` +
      `&media_purged_at=is.null` +
      `&status=not.like.generating_*` +
      `&media_expires_at=lt.${isoNow}` +
      `&or=(audio_url.not.is.null,video_url.not.is.null,scene_images.not.is.null,thumbnail_url.not.is.null)` +
      `&limit=500`
    )
  } catch (e) { console.error(`${tag} candidates query:`, e.message) }

  // 3. Exclude projects with active jobs (safety: never touch generating projects)
  const candidates = []
  for (const p of rawCandidates) {
    if (activeProjectIds.has(p.id)) continue
    const expiredHours = ((now - new Date(p.media_expires_at).getTime()) / 3_600_000).toFixed(1)
    candidates.push({ ...p, _ageHours: expiredHours })
  }
  console.log(`${tag} ${rawCandidates.length} raw, ${candidates.length} after active-job filter`)

  // 4. Process each candidate — purge media, mark project with media_purged_at
  let totalBytes = 0
  let purgedCount = 0

  for (const project of candidates) {
    const { id: pid, user_id: uid, _ageHours: age } = project
    console.log(`${tag} project=${pid} age=${age}h`)
    let projectBytes = 0
    let purgeErrors  = 0  // media_purged_at only written when ALL steps succeeded

    // 4A. Supabase audio bucket
    try {
      const audioItems = await supabaseStorageList('audio', `${uid}/${pid}`)
      if (audioItems.length) {
        projectBytes += audioItems.reduce((s, f) => s + (f.metadata?.size || 0), 0)
        const paths = audioItems.map(f => `${uid}/${pid}/${f.name}`)
        if (DRY_RUN) {
          console.log(`${tag} would remove audio: ${paths.length} file(s)`)
        } else {
          await supabaseStorageRemove('audio', paths)
          console.log(`${tag} removed audio: ${paths.length} file(s)`)
        }
      }
    } catch (e) { console.error(`${tag} audio error ${pid}:`, e.message); purgeErrors++ }

    // 4B. Supabase images bucket
    try {
      const imageItems = await supabaseStorageList('images', `${uid}/${pid}`)
      if (imageItems.length) {
        projectBytes += imageItems.reduce((s, f) => s + (f.metadata?.size || 0), 0)
        const paths = imageItems.map(f => `${uid}/${pid}/${f.name}`)
        if (DRY_RUN) {
          console.log(`${tag} would remove images: ${paths.length} file(s)`)
        } else {
          await supabaseStorageRemove('images', paths)
          console.log(`${tag} removed images: ${paths.length} file(s)`)
        }
      }
    } catch (e) { console.error(`${tag} images error ${pid}:`, e.message); purgeErrors++ }

    // 4C. B2 video bucket (users/<uid>/<pid>/ — rendered .mp4)
    try {
      const b2Objects = await b2MediaListObjects(`users/${uid}/${pid}/`)
      if (b2Objects.length) {
        const b2Bytes = b2Objects.reduce((s, o) => s + o.size, 0)
        projectBytes += b2Bytes
        if (DRY_RUN) {
          console.log(`${tag} would delete B2 video: ${b2Objects.length} object(s), ${(b2Bytes / 1024 / 1024).toFixed(2)} MB`)
        } else {
          const keys = b2Objects.map(o => o.key)
          for (let i = 0; i < keys.length; i += 1000) { await b2MediaDeleteObjects(keys.slice(i, i + 1000)) }
          console.log(`${tag} deleted B2 video: ${b2Objects.length} object(s)`)
        }
      }
    } catch (e) { console.error(`${tag} B2 video error ${pid}:`, e.message); purgeErrors++ }

    // 4D. B2 audio bucket (audio/<uid>/<pid>/ — migrated from Supabase 2025-07-16)
    try {
      const b2AudioObjects = await b2MediaListObjects(`audio/${uid}/${pid}/`)
      if (b2AudioObjects.length) {
        const b2AudioBytes = b2AudioObjects.reduce((s, o) => s + o.size, 0)
        projectBytes += b2AudioBytes
        if (DRY_RUN) {
          console.log(`${tag} would delete B2 audio: ${b2AudioObjects.length} object(s), ${(b2AudioBytes / 1024 / 1024).toFixed(2)} MB`)
        } else {
          const keys = b2AudioObjects.map(o => o.key)
          for (let i = 0; i < keys.length; i += 1000) { await b2MediaDeleteObjects(keys.slice(i, i + 1000)) }
          console.log(`${tag} deleted B2 audio: ${b2AudioObjects.length} object(s)`)
        }
      }
    } catch (e) { console.error(`${tag} B2 audio error ${pid}:`, e.message); purgeErrors++ }

    // 4F. R2 video bucket (users/<uid>/<pid>/ — Cloudflare R2, S3-compatible)
    // Skipped silently when R2 env vars are absent; r2ListObjects returns [] in that case.
    try {
      const r2Objects = await r2ListObjects(`users/${uid}/${pid}/`)
      if (r2Objects.length) {
        const r2Bytes = r2Objects.reduce((s, o) => s + o.size, 0)
        projectBytes += r2Bytes
        if (DRY_RUN) {
          console.log(`${tag} would delete R2: ${r2Objects.length} object(s), ${(r2Bytes / 1024 / 1024).toFixed(2)} MB`)
        } else {
          const keys = r2Objects.map(o => o.key)
          for (let i = 0; i < keys.length; i += 1000) { await r2DeleteObjects(keys.slice(i, i + 1000)) }
          console.log(`${tag} deleted R2: ${r2Objects.length} object(s)`)
        }
      }
    } catch (e) { console.error(`${tag} R2 error ${pid}:`, e.message); purgeErrors++ }

    // 4E. Mark project: set media_purged_at ONLY after all steps succeeded.
    // Partial failure (purgeErrors > 0) leaves the row unmarked so the next cron retries.
    if (!DRY_RUN) {
      if (purgeErrors === 0) {
        try {
          await sbPatch('projects', `id=eq.${pid}`, { media_purged_at: new Date(now).toISOString() })
          console.log(`${tag} marked media_purged_at for ${pid}`)
        } catch (e) { console.error(`${tag} mark media_purged_at error ${pid}:`, e.message) }
      } else {
        console.warn(`${tag} skipping media_purged_at for ${pid}: ${purgeErrors} step(s) failed — will retry next run`)
      }
    } else {
      console.log(`${tag} would set media_purged_at for ${pid}`)
    }

    totalBytes += projectBytes
    purgedCount++
  }

  // 5. B2 temp/ orphan cleanup — age-based (no project_id in path)
  // temp/subs_<jobId>.ass and temp/img_<jobId>_N.ext are deleted at render end,
  // but crash-orphans accumulate. Safe threshold: 48 h (renders never exceed a few hours).
  let tempOrphanCount = 0, tempOrphanBytes = 0
  try {
    const TEMP_ORPHAN_MAX_AGE_MS = 48 * 60 * 60 * 1000
    const tempObjs = await b2MediaListObjects('temp/')
    const stale = tempObjs.filter(o => o.lastModified && (now - o.lastModified) > TEMP_ORPHAN_MAX_AGE_MS)
    tempOrphanCount = stale.length
    tempOrphanBytes = stale.reduce((s, o) => s + o.size, 0)
    console.log(`${tag} B2 temp/: ${tempObjs.length} total, ${stale.length} orphan(s) >48h, ${(tempOrphanBytes/1024/1024).toFixed(2)} MB`)
    if (stale.length) {
      if (DRY_RUN) {
        console.log(`${tag} would delete B2 temp/ orphans: ${stale.map(o => o.key).join(', ')}`)
      } else {
        await b2MediaDeleteObjects(stale.map(o => o.key))
        console.log(`${tag} deleted B2 temp/ orphans: ${stale.length} object(s)`)
      }
    }
  } catch (e) { console.error(`${tag} B2 temp/ orphan cleanup:`, e.message) }

  // 6. Summary + Telegram alert
  const mbStr = (totalBytes / 1024 / 1024).toFixed(2)
  const tmpMbStr = (tempOrphanBytes / 1024 / 1024).toFixed(2)
  const actionPrefix = DRY_RUN ? 'DRY RUN: БЫЛО БЫ очищено медиа' : 'Медиа очищены'
  const summary =
    `${actionPrefix}:\n` +
    `порог: ${RETENTION_MEDIA_HOURS}ч (единый)\n` +
    `expires обновлено: ${plannedCount} проектов\n` +
    `к удалению: ${candidates.length} (очищено: ${purgedCount}), ~${mbStr} МБ\n` +
    `temp/ сирот: ${tempOrphanCount} файл(ов), ~${tmpMbStr} МБ`

  console.log(`${tag}`, summary.trim())

  if (OWNER_ID) {
    await tgApi('sendMessage', {
      chat_id: OWNER_ID,
      text: `📦 *Retention cleanup*\n\n\`\`\`\n${summary}\n\`\`\``,
      parse_mode: 'Markdown',
    }).catch(e => console.error(`${tag} tg alert failed:`, e.message))
  }
}

// ── Balance monitoring — fal.ai, ElevenLabs, APIHOST ─────────────────────────
const FAL_ADMIN_KEY                    = env('FAL_ADMIN_KEY') || env('FAL_KEY')
const FAL_BALANCE_THRESHOLD            = parseFloat(env('FAL_BALANCE_ALERT_THRESHOLD')      || '10')
const ELEVENLABS_CHARS_ALERT_THRESHOLD = parseInt  (env('ELEVENLABS_CHARS_ALERT_THRESHOLD') || '50000')
const APIHOST_BALANCE_ALERT_THRESHOLD  = parseFloat(env('APIHOST_BALANCE_ALERT_THRESHOLD')  || '100')

// Send billing-exhaustion alert from Railway with 1h dedup per service.
async function notifyBillingErrorRailway(service, route) {
  const key = `billing_alert_ts:${service.toLowerCase()}`
  try {
    const lastAlert = await getSetting(key)
    const hoursSince = lastAlert ? (Date.now() - new Date(lastAlert).getTime()) / 3_600_000 : Infinity
    if (hoursSince < 1) return
    await setSetting(key, new Date().toISOString())
    if (OWNER_ID) {
      await tgApi('sendMessage', {
        chat_id: OWNER_ID,
        text: `🔴 Billing error: ${service}\nRoute: ${route}\n${new Date().toUTCString()}`,
      }).catch(() => {})
    }
  } catch {
    // DB unreachable — swallow to never throw into caller
  }
}

async function fetchFalBalance() {
  if (!FAL_ADMIN_KEY) return { error: 'no_key' }
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch('https://api.fal.ai/v1/account/billing?expand=credits', {
      headers: { Authorization: `Key ${FAL_ADMIN_KEY}` },
      signal: controller.signal,
    })
    if (res.status === 401 || res.status === 403) return { error: 'unauthorized' }
    if (!res.ok) return { error: 'unavailable' }
    const data = await res.json()
    const balance = data?.credits?.current_balance
    const currency = data?.credits?.currency ?? 'USD'
    if (typeof balance !== 'number') return { error: 'unavailable' }
    return { balance, currency }
  } catch {
    return { error: 'unavailable' }
  } finally {
    clearTimeout(t)
  }
}

async function checkFalBalance() {
  const tag = '[fal/balance]'
  const result = await fetchFalBalance()

  if ('balance' in result) {
    await setSetting('fal_balance',          String(result.balance))
    await setSetting('fal_balance_currency', result.currency ?? 'USD')
    await setSetting('fal_balance_ts',       new Date().toISOString())
    console.log(`${tag} balance=${result.balance} ${result.currency}`)
  }

  if (!OWNER_ID) return

  const alertState      = await getSetting('fal_balance_alert_state') // 'low' | 'unauthorized' | ''
  const alertAt         = await getSetting('fal_balance_alert_at')
  const hoursSinceAlert = alertAt
    ? (Date.now() - new Date(alertAt).getTime()) / 3_600_000
    : Infinity

  // Needs admin key
  if (result.error === 'unauthorized' || result.error === 'no_key') {
    if (alertState !== 'unauthorized') {
      const tgResult = await tgApi('sendMessage', {
        chat_id: OWNER_ID,
        text: `⚙️ fal.ai мониторинг\n\nНе удаётся получить баланс — нужен admin API ключ.\nДобавь FAL_ADMIN_KEY в переменные Railway.\n\nhttps://fal.ai/dashboard/keys`,
      })
      if (tgResult?.ok) {
        await setSetting('fal_balance_alert_state', 'unauthorized')
        await setSetting('fal_balance_alert_at',    new Date().toISOString())
      } else {
        console.error(`${tag} tg alert failed:`, JSON.stringify(tgResult))
      }
    }
    return
  }

  // API unavailable (network error / 5xx) — skip alert, don't spam
  if (result.error === 'unavailable') {
    console.warn(`${tag} API unavailable, skipping alert`)
    return
  }

  const { balance, currency } = result

  if (balance < FAL_BALANCE_THRESHOLD) {
    const shouldAlert = alertState !== 'low' || hoursSinceAlert >= 24
    if (shouldAlert) {
      const tgResult = await tgApi('sendMessage', {
        chat_id: OWNER_ID,
        text: `⚠️ fal.ai баланс низкий!\n\nТекущий баланс: $${balance.toFixed(2)} ${currency}\nПорог: $${FAL_BALANCE_THRESHOLD.toFixed(2)}\n\nПополнить: https://fal.ai/dashboard/billing`,
      })
      if (tgResult?.ok) {
        await setSetting('fal_balance_alert_state', 'low')
        await setSetting('fal_balance_alert_at',    new Date().toISOString())
      } else {
        console.error(`${tag} tg alert failed:`, JSON.stringify(tgResult))
      }
    }
    return
  }

  // Balance above threshold
  if (alertState === 'low') {
    const tgResult = await tgApi('sendMessage', {
      chat_id: OWNER_ID,
      text: `✅ fal.ai баланс восстановлен\n\nТекущий баланс: $${balance.toFixed(2)} ${currency}`,
    })
    if (tgResult?.ok) {
      await setSetting('fal_balance_alert_state', '')
      await setSetting('fal_balance_alert_at',    '')
    } else {
      console.error(`${tag} tg restored alert failed:`, JSON.stringify(tgResult))
    }
  } else if (alertState === 'unauthorized') {
    await setSetting('fal_balance_alert_state', '')
    await setSetting('fal_balance_alert_at',    '')
  }
}

// ── ElevenLabs characters balance ─────────────────────────────────────────────
async function fetchElevenLabsBalance() {
  const apiKey = env('ELEVENLABS_API_KEY')
  if (!apiKey) return { error: 'no_key' }
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': apiKey },
      signal: controller.signal,
    })
    if (res.status === 401 || res.status === 403) return { error: 'unauthorized' }
    if (!res.ok) return { error: 'unavailable' }
    const data = await res.json()
    const sub   = data.subscription ?? {}
    const used  = sub.character_count ?? null
    const limit = sub.character_limit ?? null
    const reset = sub.next_character_count_reset_unix ?? null
    if (typeof used !== 'number' || typeof limit !== 'number') return { error: 'unavailable' }
    return { used, limit, remaining: limit - used, reset }
  } catch {
    return { error: 'unavailable' }
  } finally {
    clearTimeout(t)
  }
}

async function checkElevenLabsBalance() {
  const tag = '[elevenlabs/balance]'
  const result = await fetchElevenLabsBalance()

  if ('used' in result) {
    await setSetting('elevenlabs_chars_used',  String(result.used))
    await setSetting('elevenlabs_chars_limit', String(result.limit))
    await setSetting('elevenlabs_chars_ts',    new Date().toISOString())
    if (result.reset) await setSetting('elevenlabs_chars_reset', String(result.reset))
    console.log(`${tag} used=${result.used}/${result.limit} remaining=${result.remaining}`)
  }

  if (!OWNER_ID) return

  if (result.error === 'no_key') { console.warn(`${tag} ELEVENLABS_API_KEY not set on Railway — add to Railway env`); return }
  if (result.error === 'unauthorized') { console.warn(`${tag} key unauthorized`); return }
  if (result.error === 'unavailable')  { console.warn(`${tag} API unavailable, skipping`); return }

  const { remaining } = result
  const alertState      = await getSetting('elevenlabs_chars_alert_state')
  const alertAt         = await getSetting('elevenlabs_chars_alert_at')
  const hoursSinceAlert = alertAt ? (Date.now() - new Date(alertAt).getTime()) / 3_600_000 : Infinity

  if (remaining < ELEVENLABS_CHARS_ALERT_THRESHOLD) {
    const shouldAlert = alertState !== 'low' || hoursSinceAlert >= 24
    if (shouldAlert) {
      const tgResult = await tgApi('sendMessage', {
        chat_id: OWNER_ID,
        text: `⚠️ ElevenLabs символы на исходе!\n\nОсталось: ${remaining.toLocaleString('ru')} из ${result.limit.toLocaleString('ru')}\nПорог: ${ELEVENLABS_CHARS_ALERT_THRESHOLD.toLocaleString('ru')}\n\nПополнить: https://elevenlabs.io/app/subscription`,
      })
      if (tgResult?.ok) {
        await setSetting('elevenlabs_chars_alert_state', 'low')
        await setSetting('elevenlabs_chars_alert_at',    new Date().toISOString())
      } else {
        console.error(`${tag} tg alert failed:`, JSON.stringify(tgResult))
      }
    }
    return
  }

  if (alertState === 'low') {
    const tgResult = await tgApi('sendMessage', {
      chat_id: OWNER_ID,
      text: `✅ ElevenLabs символы восстановлены\n\nОсталось: ${remaining.toLocaleString('ru')} из ${result.limit.toLocaleString('ru')}`,
    })
    if (tgResult?.ok) {
      await setSetting('elevenlabs_chars_alert_state', '')
      await setSetting('elevenlabs_chars_alert_at',    '')
    } else {
      console.error(`${tag} restored alert failed:`, JSON.stringify(tgResult))
    }
  }
}

// ── APIHOST ruble balance ──────────────────────────────────────────────────────
async function fetchApihostBalance() {
  const apiKey = env('APIHOST_API_KEY')
  if (!apiKey) return { error: 'no_key' }
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch('https://apihost.ru/api/v1/balance', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    if (res.status === 401 || res.status === 403) return { error: 'unauthorized' }
    if (!res.ok) return { error: 'unavailable' }
    const data = await res.json()
    const balance = data.balance ?? data.amount ?? data.rub ?? null
    if (typeof balance !== 'number') return { error: 'unavailable' }
    return { balance }
  } catch {
    return { error: 'unavailable' }
  } finally {
    clearTimeout(t)
  }
}

async function checkApihostBalance() {
  const tag = '[apihost/balance]'
  const result = await fetchApihostBalance()

  if ('balance' in result) {
    await setSetting('apihost_balance',    String(result.balance))
    await setSetting('apihost_balance_ts', new Date().toISOString())
    console.log(`${tag} balance=${result.balance} RUB`)
  }

  if (!OWNER_ID) return

  if (result.error === 'no_key') { console.warn(`${tag} APIHOST_API_KEY not set on Railway — add to Railway env`); return }
  if (result.error === 'unauthorized') { console.warn(`${tag} key unauthorized`); return }
  if (result.error === 'unavailable')  { console.warn(`${tag} API unavailable, skipping`); return }

  const { balance } = result
  const alertState      = await getSetting('apihost_balance_alert_state')
  const alertAt         = await getSetting('apihost_balance_alert_at')
  const hoursSinceAlert = alertAt ? (Date.now() - new Date(alertAt).getTime()) / 3_600_000 : Infinity

  if (balance < APIHOST_BALANCE_ALERT_THRESHOLD) {
    const shouldAlert = alertState !== 'low' || hoursSinceAlert >= 24
    if (shouldAlert) {
      const tgResult = await tgApi('sendMessage', {
        chat_id: OWNER_ID,
        text: `⚠️ APIHOST баланс низкий!\n\nТекущий баланс: ${Number(balance).toLocaleString('ru-RU')} ₽\nПорог: ${APIHOST_BALANCE_ALERT_THRESHOLD.toLocaleString('ru-RU')} ₽\n\nПополнить: https://apihost.ru`,
      })
      if (tgResult?.ok) {
        await setSetting('apihost_balance_alert_state', 'low')
        await setSetting('apihost_balance_alert_at',    new Date().toISOString())
      } else {
        console.error(`${tag} tg alert failed:`, JSON.stringify(tgResult))
      }
    }
    return
  }

  if (alertState === 'low') {
    const tgResult = await tgApi('sendMessage', {
      chat_id: OWNER_ID,
      text: `✅ APIHOST баланс восстановлен\n\nТекущий баланс: ${Number(balance).toLocaleString('ru-RU')} ₽`,
    })
    if (tgResult?.ok) {
      await setSetting('apihost_balance_alert_state', '')
      await setSetting('apihost_balance_alert_at',    '')
    } else {
      console.error(`${tag} restored alert failed:`, JSON.stringify(tgResult))
    }
  }
}

// ── Balance check — every 30 minutes (fal.ai · ElevenLabs · APIHOST) ──────────
// ELEVENLABS_API_KEY and APIHOST_API_KEY must be set as Railway env vars.
// If missing, the corresponding check logs a warning and skips silently.
cron.schedule('*/30 * * * *', async () => {
  console.log('[cron] balance check: fal / elevenlabs / apihost')
  try { await checkFalBalance()        } catch (err) { console.error('[cron/fal-balance]', err.message);        Sentry.captureException(err, { extra: { cron: 'checkFalBalance' } }) }
  try { await checkElevenLabsBalance() } catch (err) { console.error('[cron/elevenlabs-balance]', err.message); Sentry.captureException(err, { extra: { cron: 'checkElevenLabsBalance' } }) }
  try { await checkApihostBalance()    } catch (err) { console.error('[cron/apihost-balance]', err.message);    Sentry.captureException(err, { extra: { cron: 'checkApihostBalance' } }) }
}, { timezone: 'UTC' })

// ── Daily DB backup cron — 03:00 UTC ─────────────────────────────────────────
cron.schedule('0 3 * * *', async () => {
  console.log('[cron] daily db backup')
  const attemptAt = new Date().toISOString()
  try {
    await backupDatabase()
  } catch (err) {
    console.error('[cron/backup]', err.message)
    Sentry.captureException(err, { extra: { cron: 'backupDatabase' } })
    // Write failure status; last_backup_at (success date) intentionally NOT overwritten
    try {
      await Promise.all([
        setSetting('last_backup_status', 'failed'),
        setSetting('last_backup_error', String(err.message || err).slice(0, 200)),
        setSetting('last_backup_attempt_at', attemptAt),
      ])
    } catch (e) { console.warn('[cron/backup] status write failed:', e.message) }
  }
}, { timezone: 'UTC' })

// ── Daily media retention cron — 04:00 UTC (after 03:00 backup) ──────────────
cron.schedule('0 4 * * *', async () => {
  console.log('[cron] media retention cleanup')
  try { await cleanupExpiredMedia() } catch (err) { console.error('[cron/retention]', err.message); Sentry.captureException(err, { extra: { cron: 'cleanupExpiredMedia' } }) }
}, { timezone: 'UTC' })

// ── Weekly stats cron — Monday 10:00 UTC ─────────────────────────────────────
cron.schedule('0 10 * * 1', async () => {
  console.log('[cron] weekly stats')
  try { await publishStats() } catch (err) { console.error('[cron]', err.message); Sentry.captureException(err, { extra: { cron: 'publishStats' } }) }
}, { timezone: 'UTC' })

// ── Monitor cron — hourly tick, fires based on configured interval ─────────────
cron.schedule('0 * * * *', async () => {
  const h = new Date().getUTCHours()
  const d = new Date().getUTCDay() // 0=Sun, 1=Mon
  const { interval } = monitorConfig
  const fire =
    (interval === 'daily'  && h === 9) ||
    (interval === 'twice'  && (h === 9 || h === 18)) ||
    (interval === 'weekly' && d === 1 && h === 9)
  if (!fire) return
  console.log(`[cron] monitor scan (${interval})`)
  try { await runMonitor() } catch (err) { console.error('[cron/monitor]', err.message); Sentry.captureException(err, { extra: { cron: 'runMonitor' } }) }
}, { timezone: 'UTC' })

// ── Content plan cron — every hour, fires at hours from POST_SCHEDULES ────────
cron.schedule('0 * * * *', async () => {
  const h = new Date().getUTCHours()
  const schedule = POST_SCHEDULES[planConfig.postsPerDay] ?? [planConfig.postHour]
  if (!schedule.includes(h)) return
  console.log(`[cron] plan post at ${h}:00 UTC (postsPerDay=${planConfig.postsPerDay})`)
  try { await postFromQueue() } catch (err) { console.error('[cron/plan]', err.message); Sentry.captureException(err, { extra: { cron: 'postFromQueue' } }) }
}, { timezone: 'UTC' })

// ── Subscription expiry cron — 09:00 UTC daily ───────────────────────────────
// Downgrades paid users whose plan_expires_at < now().
// Fuses: contradiction (totalPaid=0 with N>0), credit-volume, ratio (≥10 paid), absolute (<10 paid).
cron.schedule('0 9 * * *', async () => {
  console.log('[cron/subscriptions] checking expired plans')
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn('[cron/subscriptions] Supabase not configured — skipping')
    return
  }
  try {
    const now = new Date().toISOString()

    // ── Expiry fuse constants ─────────────────────────────────────────────────
    // Ratio threshold: abort if expired / totalPaid exceeds this fraction.
    // Applied only when pool is large enough (>= EXPIRY_RATIO_MIN_PAID) to avoid
    // false positives — e.g. 1 expiry out of 3 paid users is 33% but not anomalous.
    const EXPIRY_RATIO_THRESHOLD   = 0.20
    // Minimum paid-user count required to use ratio mode; below this, absolute cap applies.
    const EXPIRY_RATIO_MIN_PAID    = 10
    // Absolute cap for small pools (totalPaid < EXPIRY_RATIO_MIN_PAID).
    // Blocks unexpectedly large batches when the pool is too small for a ratio to be meaningful.
    const EXPIRY_ABS_MAX           = 5
    // Credit-volume cap per run. Anything above this is anomalous at current scale
    // and likely indicates a data or date bug. Revisit when monthly plan-credit totals
    // grow materially beyond this figure.
    const EXPIRY_MAX_CREDITS_PER_RUN = 300_000

    // Count active paid users (plan != 'free' AND plan_expires_at > now) — required for ratio fuse.
    // Excludes profiles whose plan was set without activatePlan (plan_expires_at IS NULL).
    const allPaidRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?plan=neq.free&plan_expires_at=gt.${now}&select=id`,
      { headers: { ...sbHeaders(), 'Prefer': 'count=exact' } },
    )
    if (!allPaidRes.ok) {
      const errText = await allPaidRes.text().catch(() => '')
      const alertMsg = `⚠️ [subscriptions] ABORTED — paid-user count query failed (HTTP ${allPaidRes.status}). expire_plan не вызван.\n${errText.slice(0, 200)}`
      console.error('[cron/subscriptions]', alertMsg)
      if (OWNER_ID) await tgApi('sendMessage', { chat_id: OWNER_ID, text: alertMsg })
      return
    }
    const contentRange = allPaidRes.headers.get('content-range') ?? ''
    const totalPaidRaw = contentRange.split('/')[1]
    const totalPaid = totalPaidRaw !== undefined ? parseInt(totalPaidRaw, 10) : NaN
    if (!Number.isFinite(totalPaid)) {
      const alertMsg = `⚠️ [subscriptions] ABORTED — не удалось разобрать число платных из Content-Range "${contentRange}". expire_plan не вызван.`
      console.error('[cron/subscriptions]', alertMsg)
      if (OWNER_ID) await tgApi('sendMessage', { chat_id: OWNER_ID, text: alertMsg })
      return
    }

    // Count anomalous: plan != 'free' with plan_expires_at IS NULL — set outside activatePlan,
    // never expire through the normal mechanism. Штатно истёкшие (expires_at < now) не включены.
    const anomalyRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?plan=neq.free&plan_expires_at=is.null&select=id`,
      { headers: { ...sbHeaders(), 'Prefer': 'count=exact' } },
    )
    let anomalySuffix
    if (!anomalyRes.ok) {
      console.error('[cron/subscriptions] anomaly count query failed:', anomalyRes.status)
      anomalySuffix = '\nТарифы мимо механизма: не удалось проверить'
    } else {
      const anomalyRange = anomalyRes.headers.get('content-range') ?? ''
      const anomalyRaw = anomalyRange.split('/')[1]
      const anomalyCount = anomalyRaw !== undefined ? parseInt(anomalyRaw, 10) : NaN
      if (Number.isFinite(anomalyCount) && anomalyCount > 0) {
        anomalySuffix = `\nТарифы мимо механизма: ${anomalyCount}`
      } else if (Number.isFinite(anomalyCount)) {
        anomalySuffix = ''
      } else {
        console.error('[cron/subscriptions] anomaly count: unparseable content-range:', anomalyRange)
        anomalySuffix = '\nТарифы мимо механизма: не удалось проверить'
      }
    }

    // Find expired paid users — include notification fields
    const expiredRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?plan=neq.free&plan_expires_at=lt.${now}` +
      `&select=id,plan,plan_credits,purchased_credits,telegram_chat_id,email`,
      { headers: sbHeaders() },
    )
    if (!expiredRes.ok) {
      const errText = await expiredRes.text().catch(() => '')
      const alertMsg = `⚠️ [subscriptions] ABORTED — expired-users query failed (HTTP ${expiredRes.status}). expire_plan не вызван.\n${errText.slice(0, 200)}`
      console.error('[cron/subscriptions]', alertMsg)
      if (OWNER_ID) await tgApi('sendMessage', { chat_id: OWNER_ID, text: alertMsg })
      return
    }
    const expired = await expiredRes.json()
    const N = Array.isArray(expired) ? expired.length : 0

    if (N === 0) {
      console.log('[subscriptions] no expired plans')
      if (OWNER_ID) await tgApi('sendMessage', { chat_id: OWNER_ID, text: `✅ Подписки (cron 09:00 UTC): проверка выполнена, истёкших нет. Платных пользователей: ${totalPaid}.${anomalySuffix}` })
    } else {
      const totalCreditsToBurn = expired.reduce((s, u) => s + (u.plan_credits ?? 0), 0)

      // Contradiction: expired paid users found but totalPaid reports zero — data inconsistency.
      if (totalPaid === 0) {
        const alertMsg = `⚠️ [subscriptions] ABORTED — противоречие: N=${N} истёкших платных, но totalPaid=0.\nИстёкших: ${N} · Платных всего: 0 · Кредитов к списанию: ${totalCreditsToBurn.toLocaleString()}.\nexpire_plan не вызван. Нужна ручная проверка.`
        console.error('[cron/subscriptions]', alertMsg)
        if (OWNER_ID) await tgApi('sendMessage', { chat_id: OWNER_ID, text: alertMsg })
      // Credit-volume fuse: total plan_credits about to burn exceeds anomaly threshold.
      } else if (totalCreditsToBurn > EXPIRY_MAX_CREDITS_PER_RUN) {
        const alertMsg = `⚠️ [subscriptions] ABORTED — кредитный предохранитель (credit-volume fuse).\nИстёкших: ${N} · Платных всего: ${totalPaid} · Кредитов к списанию: ${totalCreditsToBurn.toLocaleString()} > порог ${EXPIRY_MAX_CREDITS_PER_RUN.toLocaleString()}.\nexpire_plan не вызван. Нужна ручная проверка.`
        console.error('[cron/subscriptions]', alertMsg)
        if (OWNER_ID) await tgApi('sendMessage', { chat_id: OWNER_ID, text: alertMsg })
      // Ratio fuse: applied only on pools large enough for the ratio to be meaningful.
      } else if (totalPaid >= EXPIRY_RATIO_MIN_PAID && N / totalPaid > EXPIRY_RATIO_THRESHOLD) {
        const alertMsg = `⚠️ [subscriptions] ABORTED — процентный предохранитель (ratio fuse): ${N}/${totalPaid} = ${(N / totalPaid * 100).toFixed(1)}% > ${EXPIRY_RATIO_THRESHOLD * 100}%.\nИстёкших: ${N} · Платных всего: ${totalPaid} · Кредитов к списанию: ${totalCreditsToBurn.toLocaleString()}.\nexpire_plan не вызван. Нужна ручная проверка.`
        console.error('[cron/subscriptions]', alertMsg)
        if (OWNER_ID) await tgApi('sendMessage', { chat_id: OWNER_ID, text: alertMsg })
      // Absolute fuse: ratio is meaningless on tiny pools; use a hard count cap instead.
      } else if (totalPaid < EXPIRY_RATIO_MIN_PAID && N > EXPIRY_ABS_MAX) {
        const alertMsg = `⚠️ [subscriptions] ABORTED — абсолютный предохранитель (absolute fuse): ${N} > ${EXPIRY_ABS_MAX} на малой базе из ${totalPaid} платных.\nИстёкших: ${N} · Платных всего: ${totalPaid} · Кредитов к списанию: ${totalCreditsToBurn.toLocaleString()}.\nexpire_plan не вызван. Нужна ручная проверка.`
        console.error('[cron/subscriptions]', alertMsg)
        if (OWNER_ID) await tgApi('sendMessage', { chat_id: OWNER_ID, text: alertMsg })
      } else {
        let successCount = 0
        let totalBurned = 0
        const errors = []

        for (const user of expired) {
          try {
            const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/expire_plan`, {
              method: 'POST',
              headers: sbHeaders(),
              body: JSON.stringify({ p_user_id: user.id }),
            })
            if (!rpcRes.ok) {
              errors.push(`${user.id}: HTTP ${rpcRes.status}`)
              continue
            }
            const result = await rpcRes.json()
            if (result.ok && !result.noop) {
              successCount++
              const burned = result.burned ?? 0
              totalBurned += burned

              // Notify user about expiry and credit burn
              const planName = user.plan.charAt(0).toUpperCase() + user.plan.slice(1)
              const purchased = user.purchased_credits ?? 0
              if (user.telegram_chat_id) {
                const msg = burned > 0
                  ? `⏰ Ваш тариф *${planName}* истёк.\n\n🔥 Тарифные кредиты: *${burned.toLocaleString('ru-RU')}* — списаны.\n🟢 Постоянные кредиты: *${purchased.toLocaleString('ru-RU')}* — сохранены.\n\nПродлите тариф: ${APP_URL}/billing`
                  : `⏰ Ваш тариф *${planName}* истёк. Вы переведены на Free-план.`
                await sendTo(user.telegram_chat_id, msg).catch(() => {})
              } else if (user.email) {
                await sendExpiryBurnEmail(user.email, { planName, burned, purchased }).catch(() => {})
              }
            }
          } catch (e) {
            errors.push(`${user.id}: ${e.message}`)
          }
        }

        const summary = `[subscriptions] expired ${successCount} plans, burned ${totalBurned} plan_credits`
        console.log(summary)
        if (errors.length > 0) console.error('[subscriptions] errors:', errors)

        if (successCount > 0 && OWNER_ID) {
          const tgMsg = `📊 Подписки: истекло ${successCount} тарифов\n` +
            `Списано план-кредитов: ${totalBurned.toLocaleString()}\n` +
            (errors.length > 0 ? `⚠️ Ошибок: ${errors.length}` : '✅ Без ошибок')
          await tgApi('sendMessage', { chat_id: OWNER_ID, text: tgMsg })
        } else if (OWNER_ID) {
          await tgApi('sendMessage', { chat_id: OWNER_ID, text: `✅ Подписки (cron 09:00 UTC): проверено ${N} истёкших, фактически не списано (пользователи уже переведены на free ранее). Платных пользователей: ${totalPaid}.${anomalySuffix}` })
        }
      }
    }

    // ── Expiry reminders: users with plan expiring in 1–3 days ──────────────
    const in1d    = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString()
    const in3d    = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const cut48h  = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

    const remindRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?plan=neq.free` +
      `&plan_expires_at=gte.${in1d}&plan_expires_at=lte.${in3d}` +
      `&select=id,plan,plan_credits,telegram_chat_id,email,plan_expires_at,last_expiry_notice_at`,
      { headers: sbHeaders() },
    )
    if (!remindRes.ok) {
      console.error('[subscriptions/reminders] query failed:', await remindRes.text())
    } else {
      const candidates = await remindRes.json()
      const toRemind = (Array.isArray(candidates) ? candidates : []).filter(u =>
        !u.last_expiry_notice_at || new Date(u.last_expiry_notice_at) < new Date(cut48h)
      )

      let remindersSent = 0
      for (const u of toRemind) {
        try {
          const expiresDate = new Date(u.plan_expires_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
          const planName = u.plan.charAt(0).toUpperCase() + u.plan.slice(1)
          const planCredits = u.plan_credits ?? 0

          let notified = false
          if (u.telegram_chat_id) {
            const msg = `⚠️ Ваш тариф *${planName}* истекает *${expiresDate}*.\n\nНа тарифном балансе: *${planCredits.toLocaleString('ru-RU')}* кредитов — они сгорят при истечении.\nДокупленные кредиты останутся.\n\nПродлите тариф: ${APP_URL}/billing`
            await sendTo(u.telegram_chat_id, msg)
            notified = true
          } else if (u.email) {
            await sendExpiryReminderEmail(u.email, { planName, expiresDate, planCredits })
            notified = true
          }

          if (notified) {
            // Anti-spam: mark last_expiry_notice_at so we don't re-send within 48h
            await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${u.id}`, {
              method: 'PATCH',
              headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ last_expiry_notice_at: new Date().toISOString() }),
            })
            remindersSent++
          }
        } catch (e) {
          console.error(`[subscriptions/reminders] user ${u.id}:`, e.message)
        }
      }

      if (remindersSent > 0) console.log(`[subscriptions/reminders] sent ${remindersSent} reminders`)
    }
  } catch (err) {
    console.error('[cron/subscriptions] error:', err.message)
    Sentry.captureException(err, { extra: { cron: 'expire_plans' } })
  }
}, { timezone: 'UTC' })

// ── Watchdog: stuck projects / audio_jobs ─────────────────────────────────────
const WATCHDOG_DRY_RUN            = env('WATCHDOG_DRY_RUN') !== 'false'
// Must exceed IMAGES_ASYNC_POLL_MAX_MIN (default 30 min) so watchdog never kills a still-polling job
const WATCHDOG_IMAGES_TIMEOUT_MIN = parseInt(env('WATCHDOG_IMAGES_TIMEOUT_MIN') || '45', 10)
const WATCHDOG_VIDEO_TIMEOUT_MIN  = parseInt(env('WATCHDOG_VIDEO_TIMEOUT_MIN')  || '40', 10)
const WATCHDOG_AUDIO_TIMEOUT_MIN  = parseInt(env('WATCHDOG_AUDIO_TIMEOUT_MIN')  || '20', 10)

async function runWatchdog() {
  const tag = WATCHDOG_DRY_RUN ? '[watchdog/dry]' : '[watchdog]'
  const now = Date.now()
  const cutoffImages = new Date(now - WATCHDOG_IMAGES_TIMEOUT_MIN * 60_000).toISOString()
  const cutoffVideo  = new Date(now - WATCHDOG_VIDEO_TIMEOUT_MIN  * 60_000).toISOString()
  const cutoffAudio  = new Date(now - WATCHDOG_AUDIO_TIMEOUT_MIN  * 60_000).toISOString()

  const resets = []

  try {
    const rows = await sbGet('projects',
      `status=eq.generating_images&updated_at=lt.${cutoffImages}&select=id,updated_at`)
    for (const row of rows) {
      const ageMin = Math.round((now - new Date(row.updated_at).getTime()) / 60_000)
      console.log(`${tag} project ${row.id} stuck in generating_images ${ageMin} min`)
      if (!WATCHDOG_DRY_RUN) await sbPatch('projects', `id=eq.${row.id}`, { status: 'failed' })
      resets.push({ type: 'images', id: row.id, ageMin })
    }
  } catch (e) { console.warn(`${tag} images query failed:`, e.message) }

  try {
    const rows = await sbGet('projects',
      `status=eq.generating_video&updated_at=lt.${cutoffVideo}&select=id,updated_at`)
    for (const row of rows) {
      const ageMin = Math.round((now - new Date(row.updated_at).getTime()) / 60_000)
      console.log(`${tag} project ${row.id} stuck in generating_video ${ageMin} min`)
      let creditsCharged = 0
      let wdVideoRefund = null
      if (!WATCHDOG_DRY_RUN) {
        await sbPatch('projects', `id=eq.${row.id}`, { status: 'failed' })
        try {
          const vJobs = await sbGet('video_jobs',
            `project_id=eq.${row.id}&status=in.(pending,processing)&select=id,user_id,credits_charged,credits_refunded_at,phase`)
          for (const vj of (Array.isArray(vJobs) ? vJobs : [])) {
            creditsCharged = vj.credits_charged ?? 0
            await updateJob(vj.id, { status: 'failed', error_message: `watchdog: no progress ${ageMin} min (phase: ${vj.phase ?? 'unknown'})` })
            wdVideoRefund = await refundVideoJobCredits(vj.id, vj.user_id, row.id)
            if (!wdVideoRefund.ok && wdVideoRefund.amount > 0) {
              await recordRefundIncident(vj.id, vj.user_id, wdVideoRefund.amount, 'video', wdVideoRefund.error)
            }
          }
        } catch (e) {
          console.warn(`${tag} video_jobs cleanup for project ${row.id}:`, e.message)
        }
      }
      resets.push({ type: 'video', id: row.id, ageMin, creditsCharged, refundResult: wdVideoRefund })
    }
  } catch (e) { console.warn(`${tag} video query failed:`, e.message) }

  try {
    const rows = await sbGet('audio_jobs',
      `status=in.(pending,processing)&updated_at=lt.${cutoffAudio}&select=id,project_id,user_id,status,updated_at,credits_charged,credits_refunded_at`)
    for (const row of rows) {
      const ageMin = Math.round((now - new Date(row.updated_at).getTime()) / 60_000)
      console.log(`${tag} audio_job ${row.id} stuck in ${row.status} ${ageMin} min (project ${row.project_id})`)
      const needsRefund = !!(row.credits_charged > 0 && !row.credits_refunded_at)
      let wdAudioRefund = null
      if (!WATCHDOG_DRY_RUN) {
        await updateAudioJob(row.id, { status: 'failed', error: `watchdog: stuck in '${row.status}' for ${ageMin} min` })
        if (row.project_id) await sbPatch('projects', `id=eq.${row.project_id}`, { status: 'failed' })
        wdAudioRefund = await refundAudioJobCredits(row.id, row.user_id, row.project_id)
        if (!wdAudioRefund.ok && wdAudioRefund.amount > 0) {
          await recordRefundIncident(row.id, row.user_id, wdAudioRefund.amount, 'audio', wdAudioRefund.error)
        }
      }
      resets.push({ type: 'audio', id: row.id, project_id: row.project_id, jobStatus: row.status, ageMin, creditsCharged: row.credits_charged ?? 0, needsRefund, refundResult: wdAudioRefund })
    }
  } catch (e) { console.warn(`${tag} audio query failed:`, e.message) }

  try {
    const rows = await sbGet('image_jobs',
      `status=in.(pending,processing)&updated_at=lt.${cutoffImages}&select=id,project_id,user_id,status,updated_at,credits_charged,credits_refunded_at`)
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const ageMin = Math.round((now - new Date(row.updated_at).getTime()) / 60_000)
      console.log(`${tag} image_job ${row.id} stuck in ${row.status} ${ageMin} min (project ${row.project_id})`)
      const needsRefund = !!(row.credits_charged > 0 && !row.credits_refunded_at)
      let wdImageRefund = null
      if (!WATCHDOG_DRY_RUN) {
        await updateImageJob(row.id, { status: 'failed', error_message: `watchdog: stuck in '${row.status}' for ${ageMin} min` })
        if (row.project_id) await sbPatch('projects', `id=eq.${row.project_id}&status=eq.generating_images`, { status: 'failed' })
          .catch(e => console.warn(`${tag} project reset for ${row.id}:`, e.message))
        wdImageRefund = await refundImageJobCredits(row.id, row.user_id, row.project_id)
        if (!wdImageRefund.ok && wdImageRefund.amount > 0) {
          await recordRefundIncident(row.id, row.user_id, wdImageRefund.amount, 'image', wdImageRefund.error)
        }
      }
      resets.push({ type: 'image_job', id: row.id, project_id: row.project_id, jobStatus: row.status, ageMin, creditsCharged: row.credits_charged ?? 0, needsRefund, refundResult: wdImageRefund })
    }
  } catch (e) { console.warn(`${tag} image_jobs query failed:`, e.message) }

  if (resets.length === 0) { console.log(`${tag} clean`); return }

  if (!OWNER_ID) return
  const dryLabel = WATCHDOG_DRY_RUN ? ' [DRY RUN]' : ''
  if (resets.length <= 5) {
    for (const r of resets) {
      const emoji   = r.type === 'audio' ? '🔊' : r.type === 'video' ? '🎬' : r.type === 'image_job' ? '🖼' : '🖼'
      const subject = r.type === 'audio'
        ? `audio_job ${r.id.slice(0, 8)} (${r.jobStatus}, project ${(r.project_id ?? '?').slice(0, 8)})`
        : r.type === 'image_job'
        ? `image_job ${r.id.slice(0, 8)} (${r.jobStatus}, project ${(r.project_id ?? '?').slice(0, 8)})`
        : `project ${r.id.slice(0, 8)} (generating_${r.type})`
      const refundNote = r.refundResult
        ? (r.refundResult.ok && r.refundResult.amount > 0
            ? `, ${r.refundResult.amount} кр. возвращены`
            : r.refundResult.ok
            ? ', refund не потребовался'
            : `, возврат ${r.refundResult.amount} кр. — СБОЙ`)
        : (r.creditsCharged > 0 ? ', refund пропущен (dry run)' : '')
      const msg = `${emoji} Watchdog${dryLabel}\n${subject} stuck ${r.ageMin} min → reset to failed${refundNote}`
      await tgApi('sendMessage', { chat_id: OWNER_ID, text: msg })
        .catch(e => console.warn(`${tag} tg notify failed:`, e.message))
    }
  } else {
    const imgs      = resets.filter(r => r.type === 'images').length
    const imgJobs   = resets.filter(r => r.type === 'image_job').length
    const vids      = resets.filter(r => r.type === 'video').length
    const audios    = resets.filter(r => r.type === 'audio').length
    const lines  = [
      imgs      ? `🖼 generating_images: ${imgs}`    : '',
      imgJobs   ? `🖼 image_jobs: ${imgJobs}`         : '',
      vids      ? `🎬 generating_video: ${vids}`      : '',
      audios    ? `🔊 audio_jobs: ${audios}`           : '',
    ].filter(Boolean).join('\n')
    await tgApi('sendMessage', { chat_id: OWNER_ID, text: `⚠️ Watchdog${dryLabel}\nСброшено ${resets.length} задач:\n${lines}` })
      .catch(e => console.warn(`${tag} tg notify failed:`, e.message))
  }
}

// ── Watchdog cron — every 10 minutes ─────────────────────────────────────────
cron.schedule('*/10 * * * *', async () => {
  console.log('[cron] watchdog')
  try { await runWatchdog() } catch (err) { console.error('[cron/watchdog]', err.message); Sentry.captureException(err, { extra: { cron: 'runWatchdog' } }) }
}, { timezone: 'UTC' })

// ── Vercel deployment polling ─────────────────────────────────────────────────
async function checkVercelDeploy() {
  if (!VERCEL_TOKEN) { console.log('[vercel] VERCEL_TOKEN not set, skipping'); return }

  let latest
  try {
    const res = await fetch(
      'https://api.vercel.com/v6/deployments?projectId=youtubegen&limit=1&target=production&state=READY',
      { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
    )
    if (!res.ok) { console.warn('[vercel] API error:', res.status); return }
    const data = await res.json()
    latest = data.deployments?.[0]
  } catch (err) {
    console.warn('[vercel] fetch failed:', err.message)
    return
  }

  if (!latest) return

  const deployId = latest.uid ?? latest.id  // uid in v6, id in newer API versions
  console.log('[vercel] api fields: uid=', latest.uid, 'id=', latest.id, '→ using:', deployId)

  const lastId = await getSetting('last_deployment_id')
  console.log('[vercel] last known id:', lastId)
  console.log('[vercel] current id:', deployId)

  if (deployId === lastId) {
    console.log('[vercel] same deployment, skipping')
    return
  }

  console.log('[vercel] new deployment detected, saving id:', deployId)
  await setSetting('last_deployment_id', deployId)
  const verifyId = await getSetting('last_deployment_id')
  console.log('[vercel] verify save: expected=', deployId, 'got=', verifyId, 'ok=', verifyId === deployId)

  const commit = latest.meta?.githubCommitMessage ?? latest.name ?? ''
  if (!commit) { console.log('[vercel] no commit message, skipping post'); return }

  try {
    const text = await generateDeployPost(commit)
    if (config.autoPublish) {
      const pubResVercel = await publishToChannel(text)
      if (pubResVercel?.ok) {
        const vLink = channelPostLink(pubResVercel)
        console.log('[vercel] deploy post auto-published', vLink ?? '')
      } else {
        console.error('[vercel] deploy post publish failed:', pubResVercel?.description ?? 'no response')
        if (OWNER_ID) await sendTo(OWNER_ID, `❌ Не удалось опубликовать пост о деплое: ${pubResVercel?.description ?? 'нет ответа от Telegram'}`).catch(() => {})
      }
    } else {
      pendingDeployPost = { text, commitMessage: commit, deployUrl: latest.url }
      if (OWNER_ID) {
        await tgApi('sendMessage', {
          chat_id: OWNER_ID,
          text: `🚀 *Новый деплой Lefiro!*\n\n${text}\n\n_Опубликовать в канал?_`,
          parse_mode: 'Markdown',
          reply_markup: deployInline(),
        })
      }
    }
  } catch (err) {
    console.error('[vercel] deploy post failed:', err.message)
  }
}

// ── Vercel deploy polling cron — every 30 minutes ────────────────────────────
cron.schedule('*/30 * * * *', async () => {
  console.log('[cron] vercel deploy check')
  try { await checkVercelDeploy() } catch (err) { console.error('[cron/vercel]', err.message); Sentry.captureException(err, { extra: { cron: 'checkVercelDeploy' } }) }
}, { timezone: 'UTC' })

// ── Register webhook at startup ───────────────────────────────────────────────
async function registerWebhook() {
  if (!BOT_TOKEN) { console.warn('[tg] TELEGRAM_BOT_TOKEN not set'); return }
  const url = `${SERVER_URL}/telegram/webhook`
  const r = await tgApi('setWebhook', { url, drop_pending_updates: true })
  if (r?.ok) console.log('[tg] webhook registered:', url)
  else console.warn('[tg] webhook failed:', JSON.stringify(r))
}

function verifySecret(req, res, next) {
  if (!API_SECRET || req.headers['x-api-secret'] !== API_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }
  next()
}

// Upload final video to Cloudflare R2.
// Env vars: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_BASE.
// NOTE: R2 keys use the same users/${userId}/${projectId}/... path format as B2.
// Future retention cleanup will need an R2 S3-compatible client to enumerate and delete these keys.
async function uploadVideoToR2(filePath, projectId, userId) {
  const accountId = env('R2_ACCOUNT_ID')
  const bucket = env('R2_BUCKET')
  const publicBase = env('R2_PUBLIC_BASE').replace(/\/$/, '')

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`
  const key = `users/${userId}/${projectId}/output_${Date.now()}.mp4`
  const fileSize = fs.statSync(filePath).size

  console.log(`[r2] node:${process.version}`)
  console.log(`[r2] endpoint: ${endpoint}  bucket: ${bucket}`)
  console.log(`[r2] uploading ${key} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`)

  const uploadUrl = `${endpoint}/${bucket}/${key}`
  const parsed = new URL(uploadUrl)
  const host = parsed.hostname
  const urlPath = parsed.pathname

  // UNSIGNED-PAYLOAD avoids SHA256 of entire file body; R2 accepts it (unlike B2).
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp = amzDate.slice(0, 8)
  const region = 'auto'
  const service = 's3'
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`

  const canonicalHeaders =
    `content-type:video/mp4\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:UNSIGNED-PAYLOAD\n` +
    `x-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = ['PUT', urlPath, '', canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${env('R2_SECRET_ACCESS_KEY')}`, dateStamp), region), service), 'aws4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${env('R2_ACCESS_KEY_ID')}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  // Stream file — avoids loading large videos into RAM (OOM risk on 1 GB+).
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(fileSize),
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-amz-date': amzDate,
      'Authorization': authorization,
    },
    body: Readable.toWeb(fs.createReadStream(filePath)),
    duplex: 'half',
    signal: AbortSignal.timeout(600_000),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`[r2-upload] HTTP ${res.status}: ${errBody.slice(0, 400)}`)
  }

  const publicUrl = `${publicBase}/${key}`
  console.log('[r2] uploaded:', publicUrl)
  return publicUrl
}

// Upload final video to Backblaze B2 (S3-compatible).
// Used as fallback when R2 upload fails (both attempts). Streams file to avoid OOM on large videos.
async function uploadVideoToB2(filePath, projectId, userId) {
  const key = `users/${userId}/${projectId}/output_${Date.now()}.mp4`
  const bucket = env('B2_BUCKET')
  const endpoint = env('B2_ENDPOINT').replace(/\/$/, '')
  const region = env('B2_REGION') || 'us-east-005'
  const b2PublicBase = env('B2_PUBLIC_BASE').replace(/\/$/, '')
  const fileSize = fs.statSync(filePath).size

  console.log(`[b2] node:${process.version}  endpoint: ${endpoint}  bucket: ${bucket}`)
  console.log(`[b2] uploading ${key} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`)

  // Stream SHA256 hash computation — avoids loading full file into RAM
  const bodyHash = await new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(filePath)
      .on('data', c => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })

  const uploadUrl = `${endpoint}/${bucket}/${key}`
  const parsed = new URL(uploadUrl)
  const host = parsed.hostname
  const urlPath = parsed.pathname

  const CC = 'public, max-age=31536000'

  // AWS SigV4 with actual body hash (B2 requires this, unlike R2 which accepted UNSIGNED-PAYLOAD)
  // Cache-Control must be in canonical headers and signed — otherwise B2 returns 403.
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp = amzDate.slice(0, 8)
  const service = 's3'
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`

  const canonicalHeaders =
    `cache-control:${CC}\n` +
    `content-type:video/mp4\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${bodyHash}\n` +
    `x-amz-date:${amzDate}\n`
  const signedHeaders = 'cache-control;content-type;host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = ['PUT', urlPath, '', canonicalHeaders, signedHeaders, bodyHash].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${env('B2_APPLICATION_KEY')}`, dateStamp), region), service), 'aws4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${env('B2_KEY_ID')}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Cache-Control': CC,
      'Content-Type': 'video/mp4',
      'Content-Length': String(fileSize),
      'x-amz-content-sha256': bodyHash,
      'x-amz-date': amzDate,
      'Authorization': authorization,
    },
    body: Readable.toWeb(fs.createReadStream(filePath)),
    duplex: 'half',
    signal: AbortSignal.timeout(600000), // 10 min max for large files
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`[b2-upload] HTTP ${res.status}: ${errBody.slice(0, 400)}`)
  }

  // Return CDN URL when B2_PUBLIC_BASE is set (new projects → CF cached).
  // Old projects store the direct B2 URL in the DB and continue to work as-is.
  const publicUrl = b2PublicBase ? `${b2PublicBase}/${key}` : `${endpoint}/${bucket}/${key}`
  console.log('[b2] uploaded:', publicUrl)
  return publicUrl
}

function downloadFile(url, destPath, _redirects = 0) {
  return new Promise((resolve, reject) => {
    if (_redirects > 5) {
      return reject(new Error(`[download] too many redirects: ${url}`))
    }
    const file = fs.createWriteStream(destPath)
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, (response) => {
      // Follow redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close()
        fs.unlink(destPath, () => {})
        resolve(downloadFile(response.headers.location, destPath, _redirects + 1))
        return
      }
      if (response.statusCode !== 200) {
        file.close()
        fs.unlink(destPath, () => {})
        reject(new Error(`[download] HTTP ${response.statusCode} for ${url}`))
        return
      }
      response.pipe(file)
      response.on('error', (err) => {
        fs.unlink(destPath, () => {})
        reject(new Error(`[download] response stream error for ${url}: ${err.message}`))
      })
      file.on('finish', () => file.close(resolve))
      file.on('error', (err) => reject(new Error(`[download] file write error: ${err.message}`)))
    })
    req.on('error', (err) => {
      fs.unlink(destPath, () => {})
      reject(new Error(`[download] request error for ${url}: ${err.message}`))
    })
  })
}

function parseSecs(timecode) {
  const parts = String(timecode || '0').split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0]
}

function hexToAss(hex) {
  // #RRGGBB → &H00BBGGRR (ASS subtitle color, reversed)
  const h = (hex || '#FFFFFF').replace('#', '')
  const r = h.slice(0, 2)
  const g = h.slice(2, 4)
  const b = h.slice(4, 6)
  return `&H00${b}${g}${r}`.toUpperCase()
}

// Shared style params used by both blocksToAss (for ASS [V4+ Styles]) and
// burnSubtitlesVGF (for force_style override). Keep in sync if adding new fields.
function computeSubtitleStyle(subtitle_style) {
  const sizeMap  = { small: 18, medium: 22, large: 28 }
  const alignMap = { top: 8, center: 5, bottom: 2 }
  return {
    fontSize:   sizeMap[subtitle_style.size] ?? 22,
    alignment:  alignMap[subtitle_style.position] ?? 2,
    primColour: hexToAss(subtitle_style.color),
    bg:         subtitle_style.background,
  }
}

function blocksToSrt(blocks) {
  function fmt(s) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    const ms = Math.round((s % 1) * 1000)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`
  }
  return blocks
    .map((b, i) => `${i + 1}\n${fmt(b.start)} --> ${fmt(b.end)}\n${b.text}`)
    .join('\n\n')
}

// Build an ASS subtitle file. The [V4+ Styles] section is generated but may be
// overridden by force_style in burnSubtitlesVGF. The file is used as the event
// container — Dialogue lines carry timing and text regardless of [V4+ Styles].
function blocksToAss(blocks, subtitle_style) {
  const { fontSize, alignment, primColour, bg } = computeSubtitleStyle(subtitle_style)

  let borderStyle, outline, shadow, outlineColour, backColour
  if (bg) {
    borderStyle = 3; outline = 0; shadow = 0
    outlineColour = '&H00000000'
    backColour    = '&H80000000'
  } else {
    borderStyle = 1; outline = 2; shadow = 1
    outlineColour = '&H00000000'
    backColour    = '&H00000000'
  }

  function fmtAss(s) {
    const h  = Math.floor(s / 3600)
    const m  = Math.floor((s % 3600) / 60)
    const sc = Math.floor(s % 60)
    const cs = Math.round((s % 1) * 100)
    return `${h}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}.${String(cs).padStart(2,'0')}`
  }

  const styleLine = [
    'Default', 'Arial', fontSize,
    primColour, '&H000000FF', outlineColour, backColour,
    -1, 0, 0, 0,        // Bold, Italic, Underline, Strikeout
    100, 100, 0, 0,     // ScaleX, ScaleY, Spacing, Angle
    borderStyle, outline, shadow, alignment,
    10, 10, 10, 0,      // MarginL, MarginR, MarginV, Encoding
  ].join(',')

  const events = blocks.map(b =>
    `Dialogue: 0,${fmtAss(b.start)},${fmtAss(b.end)},Default,,0,0,0,,${b.text.replace(/\n/g, '\\N')}`
  )

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'Collisions: Normal',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, Strikeout, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: ${styleLine}`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
  ].join('\n') + '\n'
}

// FFmpeg -vf filter string for each named effect (applied in the final mux pass).
// Single quotes are avoided — VGF shell interprets them inside double-quoted -vf args.
// Spaces in curve points use backslash-escape (\\ in JS → \ at runtime → FFmpeg unescapes).
// ken_burns is NOT here — it is applied per-clip at the still-image stage in getVfFilter().
const EFFECT_FILTERS = {
  film_grain: 'noise=alls=35:allf=t+u',
  vignette: 'vignette=PI/3',
  haze: 'colorbalance=rs=0.05:gs=0.02:bs=0.25',
  grayscale: 'hue=s=0',
  cinematic: 'curves=r=0/0\\ 1/0.88:b=0/0.05\\ 1/0.95',
  lens_flare: 'curves=r=0/0.02\\ 0.5/0.55\\ 1/1:g=0/0\\ 0.5/0.5\\ 1/0.97:b=0/0.05\\ 0.5/0.45\\ 1/0.9',
  vhs: 'noise=alls=20:allf=t,hue=s=0.65,colorbalance=rs=0.08:gs=-0.03:bs=-0.05',
}

const VF_BASE =
  'scale=1280:720:force_original_aspect_ratio=decrease,' +
  'pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1'

// Force-scale to exact 1280x720 — no AR preservation, no letterbox/pillarbox ever.
// Flux images are already 1280x720 (no change). GPT images (1536x1024) get slight
// horizontal compression (~17%) which is acceptable for AI-generated content.
const VF_SCALE = 'scale=1280:720,setsar=1'

// Build per-clip vf filter. Ken Burns is applied here (still-image stage) so that
// zoompan works on a looped static frame — the only context where it produces smooth motion.
//
// Key rules learned from testing:
//   • z=CONSTANT (e.g. z=1.5) applies that zoom to ALL d frames — no animation.
//   • on/duration is the per-output-frame variable (0→1) that produces smooth change.
//   • No commas or colons in expressions → no escaping needed.
//   • Command must use OUTPUT-side -t; INPUT-side -t N creates N×25 frames each expanded
//     d times by zoompan → N²×25 total (2500s for a 10s clip).
//
// Two alternating patterns prevent 19 identical zoom-ins in a row:
//   even scenes → zoom-in to center (z 1.0→1.5 over the clip)
//   odd  scenes → pan left→right with light zoom (z 1.1→1.3, x 0→128px out)
//
// UPSCALE before zoompan (scale=4000:2250) eliminates integer-rounding jitter.
// zoompan computes x/y in integer pixels on input canvas; at 1280px a 1-pixel
// rounding error = 1 output pixel of stutter. At 4000px, 1px error = 0.32 output
// pixels — sub-perceptual. Lanczos upscale is one-time per image; zoompan
// downscales each crop back to s=1280x720 internally.
function calcZoompanFrames(dur) {
  return Math.max(1, Math.round(dur * 25))
}

function getVfFilter(_img, dur, sceneIdx, hasKenBurns) {
  if (!hasKenBurns) return VF_SCALE
  const d = calcZoompanFrames(dur)
  if (sceneIdx % 2 === 0) {
    // Pattern A: zoom-in to center. z 1.0→1.5; at 4000px canvas: x varies by ~4.7px/frame→0.75 out-px/frame.
    return `scale=4000:2250:flags=lanczos,zoompan=z=1+0.5*on/duration:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=${d}:s=1280x720:fps=25,setsar=1`
  } else {
    // Pattern B: pan left→right + zoom. z 1.1→1.3; x 0→400px at 4000 canvas (=128 out-px).
    return `scale=4000:2250:flags=lanczos,zoompan=z=1.1+0.2*on/duration:x=iw*0.1*on/duration:y=ih/2-(ih/zoom/2):d=${d}:s=1280x720:fps=25,setsar=1`
  }
}

const BUILD_COMMIT = env('RAILWAY_GIT_COMMIT_SHA') || null
const BUILD_TS     = env('RAILWAY_GIT_COMMIT_TIMESTAMP') || null

app.get('/health', (_req, res) => res.json({
  ok:          true,
  commit:      BUILD_COMMIT,
  deployed_at: BUILD_TS,
  started_at:  STARTED_AT,
  source:      BUILD_COMMIT ? 'github' : 'manual-upload',
}))

// ── Purge-project: delete B2 objects for a specific project ──────────────────
// Called by Vercel DELETE /api/projects/[id] when the user deletes a project.
// Vercel lacks B2 credentials; this endpoint proxies the B2 cleanup.
// Protected by RAILWAY_API_SECRET via verifySecret middleware.
app.post('/purge-project', verifySecret, async (req, res) => {
  const { project_id, user_id } = req.body || {}
  if (!project_id || !user_id) {
    return res.status(400).json({ ok: false, error: 'project_id and user_id required' })
  }
  let deleted = 0
  const errors = []
  for (const prefix of [`users/${user_id}/${project_id}/`, `audio/${user_id}/${project_id}/`]) {
    try {
      const objs = await b2MediaListObjects(prefix)
      if (objs.length) {
        const keys = objs.map(o => o.key)
        for (let i = 0; i < keys.length; i += 1000) { await b2MediaDeleteObjects(keys.slice(i, i + 1000)) }
        deleted += objs.length
        console.log(`[purge-project] deleted ${objs.length} B2 object(s) at ${prefix}`)
      }
    } catch (e) {
      errors.push(`${prefix}: ${e.message}`)
      console.error(`[purge-project] error at ${prefix}:`, e.message)
    }
  }
  res.json({ ok: true, deleted, errors })
})

// ── Admin stats endpoint (Railway-only data for admin panel) ─────────────────
// Protected by RAILWAY_API_SECRET via verifySecret middleware.
// Returns B2 bucket stats + VGF key status. Called by Vercel admin once per page load.
app.get('/admin/stats', verifySecret, async (req, res) => {
  const result = {}

  // B2 main bucket — media video files (max 1000 per list; truncated flag set if ≥1000)
  try {
    const mediaObjs = await b2MediaListObjects('users/')
    const mediaSizeMb = mediaObjs.reduce((s, f) => s + f.size, 0) / 1024 / 1024
    result.b2Media = {
      files:     mediaObjs.length,
      sizeMb:    parseFloat(mediaSizeMb.toFixed(2)),
      truncated: mediaObjs.length >= 1000,
    }
  } catch (e) {
    result.b2Media = { error: e.message.slice(0, 150) }
  }

  // B2 backup bucket — list all backup files
  try {
    const backupKeys = await b2BackupList()
    const dates = backupKeys
      .map(k => k.match(/backup_(\d{4}-\d{2}-\d{2})/)?.[1])
      .filter(Boolean)
      .sort()
    result.b2Backup = {
      files:          backupKeys.length,
      lastBackupDate: dates.at(-1) ?? null,
    }
  } catch (e) {
    result.b2Backup = { error: e.message.slice(0, 150) }
  }

  // VGF — probe key: GET /api/jobs/<fake-uuid> → 400 "notFound" = key valid, 401/403 = invalid
  if (!VGF_API_KEY) {
    result.vgf = { keySet: false, status: 'unconfigured' }
  } else {
    try {
      const probeRes = await fetch('https://verygoodffmpeg.com/api/jobs/00000000-0000-0000-0000-000000000000', {
        headers: { Authorization: `Bearer ${VGF_API_KEY}` },
        signal: AbortSignal.timeout(7000),
      })
      const st = probeRes.status
      // 400 = job not found (valid key); 401/403 = invalid key; anything else = unknown
      result.vgf = {
        keySet: true,
        status: st === 400 ? 'ok' : (st === 401 || st === 403) ? 'error' : 'warn',
        statusNote: st === 400 ? '✓ Ключ активен'
          : (st === 401 || st === 403) ? '✗ Ключ недействителен'
          : `HTTP ${st}`,
      }
    } catch (e) {
      result.vgf = { keySet: true, status: 'error', statusNote: e.message.slice(0, 100) }
    }
  }

  res.json({ ok: true, ...result })
})

// ── Very Good FFmpeg API wrapper ───────────────────────────────────────────
// inputFiles:  { in_1: "https://...", in_2: "https://..." }
// outputFiles: { out_1: "output.mp4" }  ← converted internally to VGF array format
// ffmpegCommand: "-i {{in_1}} -vf ... {{out_1}}"  (no leading "ffmpeg")
// Returns: { out_1: "https://vgf-cdn.../output.mp4", ... }
async function runFFmpegOnVGF(inputFiles, outputFiles, ffmpegCommand, timeoutMs = 600000, onPoll = null) {
  if (!VGF_API_KEY) throw new Error('VGF_API_KEY not configured')

  // VGF uses output_files as array of filenames; replace {{out_N}} with {{filename}} in command
  let cmd = ffmpegCommand
  const outNames = []
  for (const [key, filename] of Object.entries(outputFiles)) {
    cmd = cmd.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), `{{${filename}}}`)
    outNames.push(filename)
  }
  console.log('[vgf] input_files:', JSON.stringify(inputFiles))
  console.log('[vgf] ffmpeg_command:', cmd)

  // Pre-flight: every {{in_*}} placeholder in the command must resolve to a non-empty string.
  const inputRefs = [...new Set([...cmd.matchAll(/\{\{(in_[^}]+)\}\}/g)].map(m => m[1]))]
  const missingInputs = inputRefs.filter(k => typeof inputFiles[k] !== 'string' || !inputFiles[k])
  if (missingInputs.length > 0) {
    throw new Error(`VGF pre-flight: command references ${missingInputs.join(', ')} but input_files has no value (keys present: ${Object.keys(inputFiles).join(',')})`)
  }

  // Submit with retry for transient 5xx / network errors.
  let submitRes = null
  for (let attempt = 1; attempt <= VGF_SUBMIT_RETRIES + 1; attempt++) {
    const ts = new Date().toISOString()
    try {
      submitRes = await fetch('https://verygoodffmpeg.com/api/ffmpeg', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${VGF_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_files: inputFiles, output_files: outNames, ffmpeg_commands: [cmd], timeout_seconds: Math.ceil(timeoutMs / 1000) }),
        signal: AbortSignal.timeout(30000),
      })
    } catch (fetchErr) {
      if (attempt > VGF_SUBMIT_RETRIES) throw new Error(`VGF submit network error after ${VGF_SUBMIT_RETRIES} retries: ${fetchErr.message}`)
      const delay = attempt * 3000
      console.warn(`[vgf] submit network error (attempt ${attempt}/${VGF_SUBMIT_RETRIES}, ${ts}), retry in ${delay}ms: ${fetchErr.message}`)
      await new Promise(r => setTimeout(r, delay))
      continue
    }
    if (submitRes.ok) break
    const errBody = await submitRes.text().catch(() => '')
    const status  = submitRes.status
    // Only retry on 5xx (transient infra errors); 4xx are client errors — throw immediately.
    if (status < 500) throw new Error(`VGF submit HTTP ${status}: ${errBody.slice(0, 300)}`)
    if (attempt > VGF_SUBMIT_RETRIES) throw new Error(`VGF submit HTTP ${status} after ${VGF_SUBMIT_RETRIES} retries: ${errBody.slice(0, 100)}`)
    const delay = attempt * 3000
    console.warn(`[vgf] submit HTTP ${status} (attempt ${attempt}/${VGF_SUBMIT_RETRIES}, ${ts}), retry in ${delay}ms`)
    await new Promise(r => setTimeout(r, delay))
  }
  const submitBody = await submitRes.json()
  const jobId = submitBody.data?.id
  if (!jobId) throw new Error(`VGF: no job id in submit response: ${JSON.stringify(submitBody).slice(0, 200)}`)
  console.log(`[vgf] job submitted: ${jobId}`)

  // Poll until completed or timed out
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000))
    const pollRes = await fetch(
      `https://verygoodffmpeg.com/api/jobs/${jobId}`,
      { headers: { 'Authorization': `Bearer ${VGF_API_KEY}` }, signal: AbortSignal.timeout(15000) }
    ).catch(e => { console.warn('[vgf] poll fetch error:', e.message); return null })
    if (!pollRes || !pollRes.ok) {
      const errTxt = pollRes ? await pollRes.text().catch(() => '') : ''
      console.warn(`[vgf] poll HTTP ${pollRes?.status ?? 'err'}: ${errTxt.slice(0, 200)}`)
      continue
    }
    const pollBody = await pollRes.json()
    const status = pollBody.data ?? pollBody
    console.log(`[vgf] job ${jobId} status: ${status.status}`)
    if (onPoll) await onPoll().catch(() => {})
    if (status.status === 'succeeded') {
      const result = {}
      const missing = []
      for (const [key, filename] of Object.entries(outputFiles)) {
        const url = status.output_files?.[filename]
        if (typeof url !== 'string' || !url) missing.push(filename)
        result[key] = url
      }
      if (missing.length > 0) {
        throw new Error(`VGF job ${jobId}: succeeded but output missing: ${missing.join(', ')} (output_files keys: ${Object.keys(status.output_files ?? {}).join(',')})`)
      }
      console.log('[vgf] ✓ outputs:', Object.entries(result).map(([k, v]) => `${k}=${String(v).slice(-40)}`).join(', '))
      return result
    }
    if (status.status === 'failed') {
      console.error('[vgf] error details:', JSON.stringify(status))
      const errParts = [
        status.error_message,
        status.error,
        status.stderr ? `stderr:${String(status.stderr).slice(0, 300)}` : null,
        status.logs  ? `logs:${String(status.logs).slice(0, 300)}`   : null,
      ].filter(Boolean)
      throw new Error(`VGF job ${jobId} failed: ${errParts.join(' | ') || 'unknown error'}`)
    }
  }
  throw new Error(`VGF job ${jobId} timed out after ${timeoutMs}ms`)
}

// Concurrency pool: limits how many async tasks run simultaneously.
// Returns a `run(fn)` function — call it instead of fn() to queue with the limit.
function makePool(concurrency) {
  let running = 0
  const pending = []
  function next() {
    while (running < concurrency && pending.length) {
      running++
      const { fn, resolve, reject } = pending.shift()
      fn().then(v => { running--; resolve(v); next() }, e => { running--; reject(e); next() })
    }
  }
  return fn => new Promise((resolve, reject) => { pending.push({ fn, resolve, reject }); next() })
}

// Parse audio duration from public URL via music-metadata (no ffprobe needed).
// music-metadata v10 dropped parseURL; we fetch the first 512KB (contains
// MP3 Xing/VBR headers) + total file size for accurate CBR duration.
async function getAudioDuration(url) {
  const { parseBuffer } = await import('music-metadata')
  // HEAD to get total file size (needed for CBR bitrate-based duration estimate)
  let totalSize
  try {
    const headRes = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) })
    totalSize = parseInt(headRes.headers.get('content-length') || '0', 10) || undefined
  } catch (_) { /* no-op — size is optional */ }
  // Fetch first 512KB (enough for Xing/VBRI frames and ID3 tags)
  const rangeRes = await fetch(url, {
    headers: { Range: 'bytes=0-524287' },
    signal: AbortSignal.timeout(30000),
  })
  const buffer = new Uint8Array(await rangeRes.arrayBuffer())
  const meta = await parseBuffer(buffer, { mimeType: 'audio/mpeg', size: totalSize })
  const dur = meta.format.duration
  if (!dur || !isFinite(dur)) throw new Error(`music-metadata: no duration for ${url.slice(0, 80)}`)
  return dur
}

// Upload raw bytes to B2 (audio, subtitle temp files, proxied images, etc.)
// cacheControl: pass 'public, max-age=31536000' for permanent files (audio);
// omit for temp files (subtitle ASS, proxied images) which are deleted after render.
// Cache-Control is included in SigV4 canonical headers when provided.
async function uploadBytesToB2(buffer, key, contentType = 'application/octet-stream', cacheControl = null) {
  const bucket      = env('B2_BUCKET')
  const endpoint    = env('B2_ENDPOINT').replace(/\/$/, '')
  const region      = env('B2_REGION') || 'us-east-005'
  const b2PublicBase = env('B2_PUBLIC_BASE').replace(/\/$/, '')
  const uploadUrl   = `${endpoint}/${bucket}/${key}`
  const parsed      = new URL(uploadUrl)
  const now         = new Date()
  const amzDate     = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp   = amzDate.slice(0, 8)
  const service     = 's3'
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const bodyHash    = crypto.createHash('sha256').update(buffer).digest('hex')
  // cache-control sorts before content-type alphabetically — required by SigV4.
  const ccLine      = cacheControl ? `cache-control:${cacheControl}\n` : ''
  const ccSigned    = cacheControl ? 'cache-control;' : ''
  const canonicalHeaders =
    ccLine +
    `content-type:${contentType}\n` +
    `host:${parsed.hostname}\n` +
    `x-amz-content-sha256:${bodyHash}\n` +
    `x-amz-date:${amzDate}\n`
  const signedHeaders = `${ccSigned}content-type;host;x-amz-content-sha256;x-amz-date`
  const canonicalRequest = ['PUT', parsed.pathname, '', canonicalHeaders, signedHeaders, bodyHash].join('\n')
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${env('B2_APPLICATION_KEY')}`, dateStamp), region), service), 'aws4_request')
  const signature  = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${env('B2_KEY_ID')}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  const fetchHeaders = { 'Content-Type': contentType, 'x-amz-content-sha256': bodyHash, 'x-amz-date': amzDate, 'Authorization': authorization }
  if (cacheControl) fetchHeaders['Cache-Control'] = cacheControl
  const res = await fetch(uploadUrl, { method: 'PUT', headers: fetchHeaders, body: buffer })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`[b2-bytes] HTTP ${res.status}: ${errBody.slice(0, 300)}`)
  }
  // Return CDN URL for permanent files when B2_PUBLIC_BASE is configured.
  // Temp files (no cacheControl) return the direct B2 URL — VGF accesses them during render
  // and they are deleted afterwards, so CF caching provides no benefit.
  return (b2PublicBase && cacheControl) ? `${b2PublicBase}/${key}` : uploadUrl
}

// Delete temp files from B2 by key list
async function deleteTempImagesFromB2(keys) {
  if (!keys.length) return
  const bucket   = env('B2_BUCKET')
  const endpoint = env('B2_ENDPOINT').replace(/\/$/, '')
  const region   = env('B2_REGION') || 'us-east-005'
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  await Promise.all(keys.map(async (key) => {
    try {
      const deleteUrl = `${endpoint}/${bucket}/${key}`
      const parsed = new URL(deleteUrl)
      const now = new Date()
      const amzDate   = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
      const dateStamp = amzDate.slice(0, 8)
      const service   = 's3'
      const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
      const canonicalHeaders =
        `host:${parsed.hostname}\n` +
        `x-amz-content-sha256:${emptyHash}\n` +
        `x-amz-date:${amzDate}\n`
      const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
      const canonicalRequest = ['DELETE', parsed.pathname, '', canonicalHeaders, signedHeaders, emptyHash].join('\n')
      const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope,
        crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')
      const signingKey = hmac(hmac(hmac(hmac(`AWS4${env('B2_APPLICATION_KEY')}`, dateStamp), region), service), 'aws4_request')
      const signature  = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
      const authorization =
        `AWS4-HMAC-SHA256 Credential=${env('B2_KEY_ID')}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`
      const res = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { 'x-amz-content-sha256': emptyHash, 'x-amz-date': amzDate, Authorization: authorization },
      })
      console.log(`[b2-cleanup] deleted ${key}: ${res.status}`)
    } catch (err) {
      console.warn(`[b2-cleanup] failed to delete ${key}:`, err.message)
    }
  }))
}

// Burn subtitles via VGF. ASS file supplies events (timing + text); force_style
// overrides [V4+ Styles] in the FFmpeg command so the style is applied regardless
// of whether VGF's libass picks up the embedded style section.
// Comma escaping in force_style: \\\\, in JS source (same pattern as ken_burns filter)
// → \\, at runtime → \, after bash double-quote processing → , parsed by FFmpeg.
// & in &H color codes is literal inside bash "..." — no escaping needed.
// Compute dynamic VGF timeout for full-video encode passes (mux, subtitle burn).
// Base 10 min + 30s per minute of content, capped at 30 min.
// Slideshow H.264 encodes fast (~300+ fps), but 60-min content needs headroom.
async function appendJobWarning(jobId, warnText) {
  // Try warnings JSONB column first (available after: ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS warnings jsonb)
  let jsonbOk = false
  try {
    const readRes = await fetch(`${SUPABASE_URL}/rest/v1/video_jobs?id=eq.${jobId}&select=warnings`, {
      headers: sbHeaders(), signal: AbortSignal.timeout(8000),
    })
    if (readRes.ok) {
      const rows = await readRes.json()
      const current = Array.isArray(rows[0]?.warnings) ? rows[0].warnings : []
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/video_jobs?id=eq.${jobId}`, {
        method: 'PATCH', headers: sbHeaders(),
        body: JSON.stringify({ warnings: [...current, warnText] }),
        signal: AbortSignal.timeout(8000),
      })
      jsonbOk = patchRes.ok
      if (jsonbOk) console.log(`[warn] ${jobId} warnings JSONB: ${warnText}`)
    }
  } catch {}
  // Always write error_message [warn:] prefix — status/route.ts reads this for subtitle_warn.
  // Post-migration: warnings JSONB is the audit log; error_message is the live signal for the banner.
  try {
    await sbPatch('video_jobs', `id=eq.${jobId}`, { error_message: `[warn:${warnText}]` })
    console.log(`[warn] ${jobId} error_message: ${warnText}`)
  } catch (e) {
    if (!jsonbOk) console.warn('[warn] appendJobWarning failed entirely:', e.message)
  }
}

function vgfLongTimeout(audioDurationSeconds) {
  const contentMinutes = Math.ceil(audioDurationSeconds / 60)
  return Math.min(1_800_000, 600_000 + contentMinutes * 30_000)
}

async function burnSubtitlesVGF(videoUrl, subtitle_blocks, subtitle_style, jobId, projectId, timeoutMs = 600_000) {
  const assContent = blocksToAss(subtitle_blocks, subtitle_style)
  const assKey = `temp/subs_${jobId}.ass`
  let assUrl
  try {
    assUrl = await uploadBytesToB2(Buffer.from(assContent, 'utf-8'), assKey, 'text/plain')
    console.log('[vgf] ASS uploaded:', assKey, '| size=%s bg=%s', subtitle_style.size, subtitle_style.background)
  } catch (e) {
    console.warn('[vgf] ASS upload failed, skipping subtitles:', e.message)
    Sentry.captureException(e, { extra: { jobId, stage: 'subtitle_burn_upload' } })
    return videoUrl
  }
  const { fontSize, primColour, bg, alignment } = computeSubtitleStyle(subtitle_style)
  const forceParams = bg
    ? ['FontSize='+fontSize, 'PrimaryColour='+primColour, 'BorderStyle=3',
       'BackColour=&H80000000', 'Outline=1', 'Shadow=0', 'Bold=1', 'Alignment='+alignment]
    : ['FontSize='+fontSize, 'PrimaryColour='+primColour, 'OutlineColour=&H00000000',
       'BorderStyle=1', 'Outline=2', 'Shadow=1', 'Bold=1', 'Alignment='+alignment]
  const forceStyle = forceParams.join('\\\\,')

  // Budget: vgfLongTimeout max = 30 min per attempt; two attempts + 10 s pause = ≤60.2 min.
  // onPoll heartbeat refreshes projects.updated_at → 40-min watchdog never fires during retry.
  // Precedent b32adfb3: att1=16min(transient fail)+10s+att2≤30min ≈ 46min — safe with heartbeat.
  const heartbeat = makeHeartbeat(projectId)
  let lastErr = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await runFFmpegOnVGF(
        { in_1: videoUrl, in_2: assUrl },
        { out_1: 'output_subs.mp4' },
        `-i {{in_1}} -vf subtitles={{in_2}}:force_style=${forceStyle} -c:v libx264 -preset fast -crf 26 -maxrate 4M -bufsize 8M -pix_fmt yuv420p -c:a copy {{out_1}}`,
        timeoutMs,
        heartbeat,
      )
      console.log('[vgf] subtitle burn-in done')
      return result.out_1
    } catch (subsErr) {
      lastErr = subsErr
      console.warn(`[vgf] subtitle burn-in attempt ${attempt}/2 failed: ${subsErr.message}`)
      if (attempt < 2) await new Promise(r => setTimeout(r, 10_000))
    }
  }

  // Both attempts failed — honest degradation.
  // No refund: subtitle transcription is preserved in projects.subtitle_blocks and was not re-billed.
  const warnDetail = lastErr.message.slice(0, 200)
  await appendJobWarning(jobId, `subtitles_burn_failed: ${warnDetail}`)
  await sendTo(OWNER_ID, `🟡 *Subtitle burn-in degraded* — job \`${jobId}\`\n${warnDetail.slice(0, 120)}`, {}).catch(() => {})
  Sentry.captureMessage(`subtitle burn-in degraded job ${jobId}`, {
    level: 'warning',
    extra: { jobId, projectId, error: warnDetail },
  })
  return videoUrl
}

// ── Batch xfade helper (VGF) ───────────────────────────────────────────────
// Process a batch of clip URLs via VGF filter_complex xfade chain.
// O(N) per batch — each clip decoded/encoded exactly once on VGF's servers.
async function xfadeBatchPassVGF(clipUrls, clipDurations, transition, td, batchId) {
  if (clipUrls.length === 1) {
    return { url: clipUrls[0], contentDuration: clipDurations[0] }
  }
  const inputFiles = {}
  for (let i = 0; i < clipUrls.length; i++) {
    inputFiles[`in_${i + 1}`] = clipUrls[i]
  }
  const filterParts = []
  let cumDur = 0
  let prevLabel = '[0:v]'
  for (let i = 1; i < clipUrls.length; i++) {
    cumDur += clipDurations[i - 1]
    const offset = Math.max(0, cumDur - td).toFixed(3)
    const outLabel = i === clipUrls.length - 1 ? '[vout]' : `[vt${i}]`
    filterParts.push(`${prevLabel}[${i}:v]xfade=transition=${transition}:duration=${td.toFixed(2)}:offset=${offset}${outLabel}`)
    prevLabel = outLabel
  }
  const inputArgs = clipUrls.map((_, i) => `-i {{in_${i + 1}}}`).join(' ')
  const result = await runFFmpegOnVGF(
    inputFiles,
    { out_1: `${batchId}.mp4` },
    `${inputArgs} -filter_complex "${filterParts.join(';')}" -map [vout] -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p -an {{out_1}}`
  )
  return { url: result.out_1, contentDuration: clipDurations.reduce((a, b) => a + b, 0) }
}

// Concat a batch of pre-encoded clip URLs into one MP4 (no audio, no effects).
// Used for hierarchical cut-concat to stay within VGF's per-job input limit.
// crf=28 default for Phase A (small files, fast); pass crf=20 for Phase B merge
// so the direct input to the CRF-20 mux pass is not further degraded.
async function concatBatchVGF(clipUrls, batchId, timeoutMs = 600_000, crf = 28) {
  if (clipUrls.length === 1) return clipUrls[0]
  const inputFiles = {}
  for (let i = 0; i < clipUrls.length; i++) {
    if (typeof clipUrls[i] !== 'string' || !clipUrls[i]) throw new Error(`concatBatch ${batchId}: clip[${i}] URL is ${String(clipUrls[i])} — missing clip URL`)
    inputFiles[`in_${i + 1}`] = clipUrls[i]
  }
  const filterStr = clipUrls.map((_, i) => `[${i}:v]`).join('') + `concat=n=${clipUrls.length}:v=1[vout]`
  const inputArgs = clipUrls.map((_, i) => `-i {{in_${i + 1}}}`).join(' ')
  const result = await runFFmpegOnVGF(
    inputFiles,
    { out_1: `${batchId}.mp4` },
    `${inputArgs} -filter_complex "${filterStr}" -map [vout] -c:v libx264 -preset ultrafast -crf ${crf} -pix_fmt yuv420p -an {{out_1}}`,
    timeoutMs
  )
  return result.out_1
}

// ── Async video rendering pipeline (VGF) ─────────────────────────────────
async function processVideoJob(jobId, body) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytgen-'))
  await updateJob(jobId, { status: 'processing', progress: 0, phase: 'clips' })
  const T = (label) => `[${jobId.slice(0,8)}] ${label}`
  console.time(T('TOTAL'))
  const t0Job = Date.now()
  let tempImageB2Keys = []

  try {
    const {
      audio_url,
      images,
      subtitle_blocks,
      subtitle_style,
      project_id,
      user_id,
      image_interval,
      transition = 'cut',
      transition_duration = 0.5,
      effects = [],
    } = body

    console.log(`[job:${jobId}] project:`, project_id,
      '| images:', images.length,
      '| transition:', transition,
      '| effects:', effects,
      '| burnIn:', subtitle_style?.burnIn ?? false)
    const heartbeat = makeHeartbeat(project_id)
    renderActiveJobs.set(jobId, { phase: 'clips', clipsDone: 0, totalClips: images.length })

    const defaultDuration = Math.max(1, Number(image_interval) || 10)
    const effectFilters = (Array.isArray(effects) ? effects : []).map(e => EFFECT_FILTERS[e]).filter(Boolean)
    const hasKenBurns = Array.isArray(effects) && effects.includes('ken_burns')
    const useXfade = transition && transition !== 'cut' && images.length > 1
    const td = Math.max(0.1, Math.min(1.5, Number(transition_duration) || 0.5))

    // ── Stage 0: Repair potentially-concatenated MP3 ─────────────────────────
    // ElevenLabs splits scripts >4800 chars into chunks and joins them via
    // Buffer.concat. Each chunk has its own ID3v2/Xing header, so the resulting
    // file has stray ID3 tags mid-stream. This confuses FFmpeg's MP3 demuxer:
    //   • PTS resets at the second ID3 tag → audio-video drift in the final MP4
    //   • music-metadata reads only first 512 KB (chunk-1 Xing) → wrong duration
    //     → image clips cover wrong length → video ends early with -shortest flag
    //   • If loudnorm falls back to the original, the malformed audio reaches
    //     the AAC mux step → AAC frames with bad PTS → progressive distortion
    // Full decode+re-encode via FFmpeg resolves all three issues at once.
    console.time(T('0_audio_repair'))
    let sourceAudioUrl = audio_url
    try {
      const repairResult = await runFFmpegOnVGF(
        { in_1: audio_url },
        { out_1: 'audio_repaired.mp3' },
        '-i {{in_1}} -c:a libmp3lame -b:a 128k -ar 44100 {{out_1}}'
      )
      sourceAudioUrl = repairResult.out_1
      console.log('[audio] repair re-encode done (was concatenated MP3)')
    } catch (repairErr) {
      console.warn('[audio] repair step failed, continuing with original:', repairErr.message)
    }
    console.timeEnd(T('0_audio_repair'))

    // ── Stage 1: Normalize audio via VGF + get duration ──────────────────────
    console.time(T('1_audio_norm'))
    const audioDuration = await getAudioDuration(sourceAudioUrl)
    console.log(`[audio] duration: ${audioDuration.toFixed(2)}s`)

    let finalAudioUrl = sourceAudioUrl
    try {
      const normResult = await runFFmpegOnVGF(
        { in_1: sourceAudioUrl },
        { out_1: 'audio_norm.mp3' },
        '-i {{in_1}} -filter:a loudnorm=I=-14:LRA=7:TP=-1 -ar 44100 {{out_1}}'
      )
      finalAudioUrl = normResult.out_1
      console.log('[audio] loudnorm applied via VGF')
    } catch (normErr) {
      console.warn('[audio] loudnorm failed, using repaired audio:', normErr.message)
      // fallback is sourceAudioUrl (already clean), not the original
    }
    console.timeEnd(T('1_audio_norm'))

    const durations = images.map((img) => {
      if (img.timecode_start && img.timecode_end) {
        const tc = parseSecs(img.timecode_end) - parseSecs(img.timecode_start)
        if (tc > 0.5) return tc
      }
      return defaultDuration
    })
    const totalImagesDuration = durations.reduce((a, b) => a + b, 0)
    if (totalImagesDuration < audioDuration) {
      durations[durations.length - 1] += audioDuration - totalImagesDuration
    }
    console.log(`[job:${jobId}] durations (${durations.length}): [${durations.map(d => d.toFixed(2)).join(', ')}]`)

    // ── Proxy gpt_mini and fal.ai CDN images through B2 so VGF can download them ─
    // gpt_mini images are stored in a non-public Supabase path — must proxy.
    // flux_schnell may fall back to fal.ai CDN URLs when Supabase upload fails;
    // VGF hitting 155 fal.ai URLs simultaneously can cause rate-limit failures.
    const isFalCdnUrl = url => typeof url === 'string' && /\bfal\.(media|run|ai)\b|cdn\.fal\.ai/i.test(url)
    const resolvedImages = await Promise.all(images.map(async (img, i) => {
      const needsProxy = img.url && (img.engine === 'gpt_mini' || isFalCdnUrl(img.url))
      if (!needsProxy) return img
      const engineTag = img.engine ?? 'unknown'
      console.log(`[render] proxying ${engineTag} image ${i} to B2:`, img.url?.slice(0, 80))
      try {
        const resp = await fetch(img.url)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const buf = Buffer.from(await resp.arrayBuffer())
        const ext = img.engine === 'gpt_mini' ? 'png' : 'jpg'
        const mime = img.engine === 'gpt_mini' ? 'image/png' : 'image/jpeg'
        const key = `temp/img_${jobId}_${i}.${ext}`
        const b2Url = await uploadBytesToB2(buf, key, mime)
        tempImageB2Keys.push(key)
        console.log(`[render] ${engineTag} image ${i} → B2:`, b2Url.slice(0, 80))
        return { ...img, url: b2Url }
      } catch (err) {
        console.error(`[render] proxy failed for image ${i}:`, err.message)
        Sentry.captureException(err, { extra: { jobId, imageIndex: i, engine: img.engine, stage: 'image_proxy_b2' } })
        // Do NOT fall back to the original (likely expired) FAL CDN URL — sending a
        // dead URL to VGF/RunPod produces a cryptic "expired" error with no recourse.
        // Fail fast instead: the job error_message will tell the user which scene to fix.
        throw new Error(`scene ${i + 1} image unavailable (${img.engine ?? 'flux'}) — regenerate images and retry`)
      }
    }))

    const outputPath = path.join(tmpDir, 'output.mp4')
    const clipPool = makePool(VGF_CLIP_CONCURRENCY)

    let clipsDone = 0
    let lastClipUpdate = 0
    const totalClips = resolvedImages.length

    if (useXfade) {
      // ── Stage 2: Encode all clips via VGF (parallel, max 20 concurrent) ─────
      console.time(T('2_clips_encode'))
      console.log(`[vgf] encoding ${resolvedImages.length} clips in parallel (pool=${VGF_CLIP_CONCURRENCY})...`)
      const clipUrls = await Promise.all(resolvedImages.map((img, i) =>
        clipPool(async () => {
          const clipDur = (durations[i] + td).toFixed(3)
          const vfFilter = getVfFilter(img, durations[i] + td, i, hasKenBurns)
          const clipTimeout = hasKenBurns
            ? Math.min(1_800_000, Math.max(600_000, calcZoompanFrames(durations[i] + td) * 120))
            : 600_000
          console.log(`[render] clip_${i} engine=${img.engine ?? 'undefined'} url=${img.url?.slice(0, 80)} vf=${vfFilter}`)
          // Ken Burns: -t on OUTPUT side; INPUT-side -t creates N×25 frames each expanded
          // by zoompan d=N×25 → N²×25 total frames (2500s for a 10s clip). No -tune stillimage
          // because the video has motion. For plain clips, keep the original INPUT-side -t.
          const clipCmd = hasKenBurns
            ? `-loop 1 -i {{in_1}} -vf "${vfFilter}" -t ${clipDur} -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -an {{out_1}}`
            : `-loop 1 -r 25 -t ${clipDur} -i {{in_1}} -vf "${vfFilter}" -c:v libx264 -preset ultrafast -tune stillimage -crf 28 -pix_fmt yuv420p -an {{out_1}}`
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              const result = await runFFmpegOnVGF(
                { in_1: img.url },
                { out_1: `clip_${i}.mp4` },
                clipCmd,
                clipTimeout
              )
              if (attempt > 1) console.log(`[vgf] clip_${i} retry succeeded`)
              console.log(`[vgf] clip_${i} done (engine=${img.engine ?? 'flux'})`)
              const done = ++clipsDone
              const now = Date.now()
              if (done === totalClips || now - lastClipUpdate >= 2500) {
                lastClipUpdate = now
                await updateJob(jobId, { progress: Math.round(60 * done / totalClips), phase: 'clips', phase_done: done, phase_total: totalClips })
              }
              renderActiveJobs.set(jobId, { phase: 'clips', clipsDone: done, totalClips })
              await heartbeat()
              return result.out_1
            } catch (err) {
              if (attempt < 2) {
                console.warn(`[vgf] clip_${i} attempt 1 failed, retrying in 5s: ${err.message}`)
                await new Promise(r => setTimeout(r, 5000))
                continue
              }
              throw new Error(`clip_${i}(engine=${img.engine ?? 'flux'},url=${img.url?.slice(-50) ?? 'null'}): ${err.message}`)
            }
          }
        })
      ))
      console.log(`[vgf] all ${clipUrls.length} clips encoded`)
      console.timeEnd(T('2_clips_encode'))
      await updateJob(jobId, { progress: 60, phase: 'concat', phase_done: null, phase_total: null })
      await heartbeatProject(project_id)

      // ── Stage 3: Batch xfade → merge → mux+effects ──────────────────────────
      console.time(T('3_xfade'))
      const XFADE_BATCH_SIZE = 4

      // Phase A: process clips in batches of 4 via VGF filter_complex
      const batchResults = []
      for (let b = 0; b < clipUrls.length; b += XFADE_BATCH_SIZE) {
        const bClips = clipUrls.slice(b, b + XFADE_BATCH_SIZE)
        const bDurs  = durations.slice(b, b + XFADE_BATCH_SIZE)
        const bNum   = Math.floor(b / XFADE_BATCH_SIZE)
        console.log(`[vgf] xfade batch ${bNum}: ${bClips.length} clips, ${bDurs.reduce((a, c) => a + c, 0).toFixed(1)}s`)
        const result = await xfadeBatchPassVGF(bClips, bDurs, transition, td, `batch_${bNum}`)
        batchResults.push(result)
        renderActiveJobs.set(jobId, { phase: 'xfade_batch', clipsDone: Math.min(b + XFADE_BATCH_SIZE, clipUrls.length), totalClips })
        await heartbeat()
      }
      console.log(`[vgf] ${batchResults.length} batch(es) ready, merging...`)

      // Phase B: merge batch outputs
      let accUrl = batchResults[0].url
      let accDur = batchResults[0].contentDuration
      for (let i = 1; i < batchResults.length; i++) {
        const offset = Math.max(0, accDur - td)
        const mergeResult = await runFFmpegOnVGF(
          { in_1: accUrl, in_2: batchResults[i].url },
          { out_1: `merge_${i}.mp4` },
          `-i {{in_1}} -i {{in_2}} -filter_complex "[0:v][1:v]xfade=transition=${transition}:duration=${td.toFixed(2)}:offset=${offset.toFixed(3)}[vout]" -map [vout] -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p -an {{out_1}}`
        )
        accUrl = mergeResult.out_1
        accDur += batchResults[i].contentDuration
        renderActiveJobs.set(jobId, { phase: 'xfade_merge', clipsDone: i, totalClips: batchResults.length - 1 })
        await heartbeat()
      }

      // Phase C: mux audio + bake effects in one pass (saves a separate encode)
      const muxVf = effectFilters.length > 0
        ? `format=yuv420p,${effectFilters.join(',')}`
        : 'format=yuv420p'
      console.log(`[vgf] mux+effects vf: ${muxVf}`)
      const longTimeout = vgfLongTimeout(audioDuration)
      const muxResult = await runFFmpegOnVGF(
        { in_1: accUrl, in_2: finalAudioUrl },
        { out_1: 'temp_1.mp4' },
        `-i {{in_1}} -i {{in_2}} -map 0:v -map 1:a -vf ${muxVf} -c:v libx264 -preset fast -crf 20 -maxrate 6M -bufsize 12M -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart -shortest {{out_1}}`,
        longTimeout
      )
      let currentUrl = muxResult.out_1
      console.log(`[vgf] xfade+mux+effects done: ${transition}, effects=[${effects.join(', ')}]`)
      console.timeEnd(T('3_xfade'))
      await updateJob(jobId, { progress: 70, phase: 'mux', phase_done: null, phase_total: null })
      await heartbeatProject(project_id)

      // ── Stage 4: effects merged into Stage 3 mux pass ──────────────────────
      console.log(`[perf] 4_effects: ${effectFilters.length > 0 ? `merged into mux (${effects.join(', ')})` : 'skipped (no effects)'}`)

      // ── Stage 5: Burn subtitles ─────────────────────────────────────────────
      if (subtitle_blocks?.length && subtitle_style?.burnIn) {
        console.time(T('5_subtitles'))
        currentUrl = await burnSubtitlesVGF(currentUrl, subtitle_blocks, subtitle_style, jobId, project_id, longTimeout)
        console.timeEnd(T('5_subtitles'))
        await updateJob(jobId, { progress: 85, phase: 'subtitles', phase_done: null, phase_total: null })
        await heartbeatProject(project_id)
      } else {
        console.log('[perf] 5_subtitles: skipped (no burn-in)')
      }

      // Download final output from VGF for B2 upload
      await downloadFile(currentUrl, outputPath)

    } else {
      // ── Stage 2+3 (cut): Encode clips in parallel (max 20 concurrent) + concat ─
      console.time(T('2_clips_encode'))
      console.log(`[vgf] encoding ${resolvedImages.length} clips in parallel (cut, pool=${VGF_CLIP_CONCURRENCY})...`)
      const clipUrls = await Promise.all(resolvedImages.map((img, i) =>
        clipPool(async () => {
          const vfFilter = getVfFilter(img, durations[i], i, hasKenBurns)
          const clipTimeout = hasKenBurns
            ? Math.min(1_800_000, Math.max(600_000, calcZoompanFrames(durations[i]) * 120))
            : 600_000
          console.log(`[render] clip_${i} engine=${img.engine ?? 'undefined'} url=${img.url?.slice(0, 80)} vf=${vfFilter}`)
          const clipCmd = hasKenBurns
            ? `-loop 1 -i {{in_1}} -vf "${vfFilter}" -t ${durations[i].toFixed(3)} -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -an {{out_1}}`
            : `-loop 1 -r 25 -t ${durations[i].toFixed(3)} -i {{in_1}} -vf "${vfFilter}" -c:v libx264 -preset ultrafast -tune stillimage -crf 28 -pix_fmt yuv420p -an {{out_1}}`
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              const result = await runFFmpegOnVGF(
                { in_1: img.url },
                { out_1: `clip_${i}.mp4` },
                clipCmd,
                clipTimeout
              )
              if (attempt > 1) console.log(`[vgf] clip_${i} retry succeeded`)
              console.log(`[vgf] clip_${i} done (engine=${img.engine ?? 'flux'})`)
              const done = ++clipsDone
              const now = Date.now()
              if (done === totalClips || now - lastClipUpdate >= 2500) {
                lastClipUpdate = now
                await updateJob(jobId, { progress: Math.round(60 * done / totalClips), phase: 'clips', phase_done: done, phase_total: totalClips })
              }
              renderActiveJobs.set(jobId, { phase: 'clips', clipsDone: done, totalClips })
              await heartbeat()
              return result.out_1
            } catch (err) {
              if (attempt < 2) {
                console.warn(`[vgf] clip_${i} attempt 1 failed, retrying in 5s: ${err.message}`)
                await new Promise(r => setTimeout(r, 5000))
                continue
              }
              throw new Error(`clip_${i}(engine=${img.engine ?? 'flux'},url=${img.url?.slice(-50) ?? 'null'}): ${err.message}`)
            }
          }
        })
      ))
      console.timeEnd(T('2_clips_encode'))
      await updateJob(jobId, { progress: 60, phase: 'concat', phase_done: null, phase_total: null })
      await heartbeatProject(project_id)

      console.time(T('3_concat'))
      // Hierarchical concat: batch clips to stay within VGF's per-job input limit.
      // A single VGF job with 155+ inputs triggers FFmpeg resource exhaustion.
      // Batch size 50: eliminates Phase B for most videos (≤50 scenes), saving one
      // full re-encode pass — critical for Ken Burns where clips are heavy 25fps video.
      const CUT_CONCAT_BATCH = 50
      console.log(`[vgf] concat ${clipUrls.length} clips in batches of ${CUT_CONCAT_BATCH}...`)

      // Phase A: concat clips in batches
      const concatBatches = []
      for (let b = 0; b < clipUrls.length; b += CUT_CONCAT_BATCH) {
        const bClips = clipUrls.slice(b, b + CUT_CONCAT_BATCH)
        const bNum   = Math.floor(b / CUT_CONCAT_BATCH)
        console.log(`[vgf] concat batch ${bNum}: ${bClips.length} clips`)
        concatBatches.push(await concatBatchVGF(bClips, `cutbatch_${bNum}`, vgfLongTimeout(audioDuration)))
        renderActiveJobs.set(jobId, { phase: 'concat_batch', clipsDone: Math.min(b + CUT_CONCAT_BATCH, clipUrls.length), totalClips })
        await heartbeat()
      }

      // Phase B: merge batches (skipped for ≤50 scenes; longTimeout for rare >50-scene videos)
      let mergedVideoUrl
      if (concatBatches.length === 1) {
        mergedVideoUrl = concatBatches[0]
      } else {
        console.log(`[vgf] merging ${concatBatches.length} batches...`)
        renderActiveJobs.set(jobId, { phase: 'concat_merge', clipsDone: concatBatches.length, totalClips })
        await heartbeat()
        mergedVideoUrl = await concatBatchVGF(concatBatches, 'cutmerge', vgfLongTimeout(audioDuration), 20)
      }

      // Phase C: mux audio + bake effects in one pass
      const muxVf = effectFilters.length > 0
        ? `format=yuv420p,${effectFilters.join(',')}`
        : 'format=yuv420p'
      const longTimeout = vgfLongTimeout(audioDuration)
      const cutMuxResult = await runFFmpegOnVGF(
        { in_1: mergedVideoUrl, in_2: finalAudioUrl },
        { out_1: 'temp_1.mp4' },
        `-i {{in_1}} -i {{in_2}} -map 0:v -map 1:a -vf ${muxVf} -c:v libx264 -preset fast -crf 20 -maxrate 6M -bufsize 12M -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart -shortest {{out_1}}`,
        longTimeout
      )
      let currentUrl = cutMuxResult.out_1
      console.log(`[vgf] concat+effects done: effects=[${effects.join(', ')}]`)
      console.timeEnd(T('3_concat'))
      await updateJob(jobId, { progress: 70, phase: 'mux', phase_done: null, phase_total: null })
      await heartbeatProject(project_id)

      // ── Stage 4: effects merged into concat pass ────────────────────────────
      console.log(`[perf] 4_effects: ${effectFilters.length > 0 ? `merged into concat (${effects.join(', ')})` : 'skipped (no effects)'}`)

      // ── Stage 5: Burn subtitles ─────────────────────────────────────────────
      if (subtitle_blocks?.length && subtitle_style?.burnIn) {
        console.time(T('5_subtitles'))
        currentUrl = await burnSubtitlesVGF(currentUrl, subtitle_blocks, subtitle_style, jobId, project_id, longTimeout)
        console.timeEnd(T('5_subtitles'))
        await updateJob(jobId, { progress: 85, phase: 'subtitles', phase_done: null, phase_total: null })
        await heartbeatProject(project_id)
      } else {
        console.log('[perf] 5_subtitles: skipped (no burn-in)')
      }

      // Download final output from VGF for B2 upload
      await downloadFile(currentUrl, outputPath)
    }

    await updateJob(jobId, { progress: 95, phase: 'upload', phase_done: null, phase_total: null })

    // ── Stage 6: Upload to Cloudflare R2 (fallback → Backblaze B2) ──────────
    const fileSizeBytes = fs.statSync(outputPath).size
    console.log(`[upload] file size: ${fileSizeBytes} bytes = ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB`)
    console.time(T('6_upload'))
    let publicUrl
    try {
      publicUrl = await uploadVideoToR2(outputPath, project_id, user_id ?? 'anon')
    } catch (r2Err) {
      console.warn('[r2] attempt 1 failed:', r2Err.message, '— retrying...')
      try {
        publicUrl = await uploadVideoToR2(outputPath, project_id, user_id ?? 'anon')
      } catch (r2Err2) {
        const alertMsg = `[non-critical] R2 upload failed, fell back to B2: ${r2Err2.message}`
        console.error(alertMsg)
        Sentry.captureMessage(alertMsg, 'warning')
        publicUrl = await uploadVideoToB2(outputPath, project_id, user_id ?? 'anon')
      }
    }
    console.timeEnd(T('6_upload'))
    console.timeEnd(T('TOTAL'))

    await updateJob(jobId, {
      status: 'completed',
      progress: 100,
      video_url: publicUrl,
      completed_at: new Date().toISOString(),
    })
    console.log(`[job:${jobId}] done →`, publicUrl)

    if (Date.now() - t0Job > 90_000) {
      notifyUserJobDone(user_id, 'video').catch(() => {})
    }

    // Write video_url to projects so the video appears after page reload
    // without requiring frontend polling. Idempotent: WHERE video_url IS NULL
    // ensures we never overwrite if the status-route polling bridge ran first.
    // Credits are NOT spent here — the status-route handles that atomically.
    if (project_id) {
      try {
        await sbPatch('projects', `id=eq.${project_id}&video_url=is.null`, {
          video_url: publicUrl,
          status: 'generating_seo',
        })
        console.log(`[job:${jobId}] projects.video_url written`)
      } catch (projErr) {
        console.warn(`[job:${jobId}] projects update non-fatal:`, projErr.message)
        Sentry.captureException(projErr, { extra: { jobId, project_id, stage: 'projects_video_url' } })
      }
    }
  } catch (err) {
    console.error(`[job:${jobId}] failed:`, err.message)
    Sentry.withScope(scope => {
      scope.setContext('job', {
        jobId,
        project_id: body.project_id,
        user_id: body.user_id,
        transition: body.transition,
        effects: body.effects,
        stage: 'processVideoJob',
      })
      Sentry.captureException(err)
    })
    try { console.timeEnd(T('TOTAL')) } catch (_) {}
    await updateJob(jobId, { status: 'failed', error_message: err.message })
    const videoRefund = await refundVideoJobCredits(jobId, body.user_id, body.project_id)
    if (!videoRefund.ok && videoRefund.amount > 0) {
      await recordRefundIncident(jobId, body.user_id, videoRefund.amount, 'video', videoRefund.error)
    }
    if (body.project_id) {
      await sbPatch('projects', `id=eq.${body.project_id}&status=eq.generating_video`, { status: 'failed' })
        .catch(e => console.warn(`[job:${jobId}] project status reset failed:`, e.message))
    }
    if (Date.now() - t0Job > 90_000) {
      notifyUserJobDone(body.user_id, 'video_failed').catch(() => {})
    }
  } finally {
    renderActiveJobs.delete(jobId)
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      console.warn('[cleanup] rmSync failed:', e.message)
    }
    if (tempImageB2Keys.length) {
      await deleteTempImagesFromB2(tempImageB2Keys).catch(e => console.warn('[b2-cleanup] images:', e.message))
    }
    await deleteTempImagesFromB2([`temp/subs_${jobId}.ass`]).catch(e => console.warn('[b2-cleanup] subs:', e.message))
  }
}

// ── Audio transcription endpoint ──────────────────────────────────────────────
// Split audio into ≤24MB chunks (Whisper limit 25MB) using pure-JS byte offsets.
// CBR MP3 (produced by all TTS engines) has constant bytes/second, so byte offset
// accurately maps to time offset without needing ffprobe.
async function splitMp3Buffer(buffer, maxBytes) {
  if (buffer.byteLength <= maxBytes) return [{ buffer, offsetSeconds: 0 }]

  const { parseBuffer } = await import('music-metadata')
  const meta = await parseBuffer(new Uint8Array(buffer), { mimeType: 'audio/mpeg' })
  const totalDuration = meta.format.duration
  if (!totalDuration || !isFinite(totalDuration)) {
    throw new Error('[transcribe] could not determine audio duration for chunking')
  }

  const bytesPerSecond = buffer.byteLength / totalDuration
  const chunks = []
  let byteOffset = 0
  while (byteOffset < buffer.byteLength) {
    const end = Math.min(byteOffset + maxBytes, buffer.byteLength)
    chunks.push({ buffer: buffer.slice(byteOffset, end), offsetSeconds: byteOffset / bytesPerSecond })
    byteOffset = end
  }
  return chunks
}

async function whisperTranscribeBuffer(audioBuffer, language, openaiKey) {
  const blob = new Blob([audioBuffer], { type: 'audio/mpeg' })
  const form = new FormData()
  form.append('file', blob, 'audio.mp3')
  form.append('model', 'whisper-1')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'segment')
  if (language) form.append('language', language)

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
    signal: AbortSignal.timeout(240000), // 4 min per chunk
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Whisper HTTP ${res.status}: ${errBody.slice(0, 300)}`)
  }
  const json = await res.json()
  return json.segments ?? []
}

app.post('/transcribe', verifySecret, async (req, res) => {
  const { audio_url, language } = req.body
  if (!audio_url) return res.status(400).json({ ok: false, error: 'audio_url required' })

  const openaiKey = env('OPENAI_API_KEY')
  if (!openaiKey) return res.status(503).json({ ok: false, error: 'OPENAI_API_KEY not configured on video-server' })

  try {
    console.log(`[transcribe] downloading: ${audio_url.slice(0, 100)}`)
    const dlRes = await fetch(audio_url, { signal: AbortSignal.timeout(120000) })
    if (!dlRes.ok) return res.status(400).json({ ok: false, error: `Failed to download audio: HTTP ${dlRes.status}` })

    const audioBuffer = Buffer.from(await dlRes.arrayBuffer())
    console.log(`[transcribe] size: ${(audioBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`)

    const chunks = await splitMp3Buffer(audioBuffer, 24 * 1024 * 1024)
    console.log(`[transcribe] chunks: ${chunks.length}, language: ${language || 'auto'}`)

    const allSegments = []
    for (let i = 0; i < chunks.length; i++) {
      const { buffer: chunkBuf, offsetSeconds } = chunks[i]
      console.log(`[transcribe] chunk ${i + 1}/${chunks.length}: ${(chunkBuf.byteLength / 1024 / 1024).toFixed(2)} MB, offset ${offsetSeconds.toFixed(1)}s`)
      const segs = await whisperTranscribeBuffer(chunkBuf, language, openaiKey)
      for (const seg of segs) {
        allSegments.push({
          start: Math.round((seg.start + offsetSeconds) * 100) / 100,
          end:   Math.round((seg.end   + offsetSeconds) * 100) / 100,
          text:  (seg.text || '').trim(),
        })
      }
    }

    const durationSeconds = allSegments.length > 0 ? allSegments[allSegments.length - 1].end : 0
    console.log(`[transcribe] done: ${allSegments.length} segments, ${durationSeconds.toFixed(1)}s`)
    return res.json({ ok: true, data: { subtitle_blocks: allSegments, duration_seconds: durationSeconds } })
  } catch (e) {
    console.error('[transcribe] error:', e.message)
    Sentry.captureException(e, { extra: { audio_url: audio_url?.slice(0, 100) } })
    return res.status(500).json({ ok: false, error: e.message })
  }
})

app.post('/render', verifySecret, async (req, res) => {
  const { audio_url, images, project_id, user_id } = req.body

  if (!audio_url || !Array.isArray(images) || !images.length || !project_id) {
    return res.status(400).json({ ok: false, error: 'Missing audio_url, images, or project_id' })
  }

  let jobId
  try {
    const rows = await sbPost('video_jobs', {
      project_id,
      user_id: user_id ?? null,
      status: 'pending',
      progress: 0,
    })
    jobId = Array.isArray(rows) ? rows[0]?.id : rows?.id
    if (!jobId) throw new Error('no id returned from video_jobs insert')
  } catch (err) {
    console.error('[render] create job failed:', err.message)
    Sentry.captureException(err, { extra: { project_id, user_id: req.body.user_id, stage: 'job_create' } })
    return res.status(500).json({ ok: false, error: 'Failed to create render job' })
  }

  // Fire-and-forget: process in background without blocking the HTTP response
  setImmediate(() => {
    processVideoJob(jobId, req.body).catch(async (err) => {
      console.error(`[job:${jobId}] unhandled:`, err.message)
      Sentry.captureException(err, { extra: { jobId, stage: 'processVideoJob_unhandled' } })
      // Safety net: if processVideoJob threw before its own try/catch (e.g. updateJob or mkdtempSync),
      // mark the job and project failed so they don't hang until the watchdog (40 min).
      await updateJob(jobId, { status: 'failed', error_message: `unhandled: ${err.message}` })
        .catch(() => {})
      const pid = req.body?.project_id
      if (pid) {
        await sbPatch('projects', `id=eq.${pid}&status=eq.generating_video`, { status: 'failed' })
          .catch(() => {})
      }
    })
  })

  return res.json({ ok: true, job_id: jobId, status: 'pending' })
})

app.get('/status/:jobId', verifySecret, async (req, res) => {
  try {
    const rows = await sbGet(
      'video_jobs',
      `id=eq.${req.params.jobId}&select=id,status,progress,video_url,error_message`
    )
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Job not found' })
    return res.json({ ok: true, ...rows[0] })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/synthesize-audio', verifySecret, async (req, res) => {
  const {
    user_id, project_id, engine, voice_id, text_url,
    own_script, voice_style, stability, similarity_boost, speech_rate,
  } = req.body

  // Only async-capable engines — sync engines (ElevenLabs/OpenAI/Google/APIHOST) stay on Vercel Lambda
  if (!['secretvoicer', 'voicer'].includes(engine)) {
    return res.status(400).json({ ok: false, error: `engine '${engine}' is sync-only — run on Vercel Lambda, not this worker` })
  }
  if (!user_id || !project_id || !voice_id || !text_url) {
    return res.status(400).json({ ok: false, error: 'Missing required fields: user_id, project_id, voice_id, text_url' })
  }

  let job
  try {
    const rows = await sbPost('audio_jobs', {
      user_id,
      project_id,
      engine,
      voice_id,
      text_url,
      own_script:       own_script       ?? false,
      voice_style:      voice_style      ?? 0,
      stability:        stability        ?? 0.5,
      similarity_boost: similarity_boost ?? 0.75,
      speech_rate:      speech_rate      ?? 1.0,
      status:           'pending',
    })
    job = Array.isArray(rows) ? rows[0] : rows
    if (!job?.id) throw new Error('no id returned from audio_jobs insert')
  } catch (err) {
    console.error('[synthesize-audio] create job failed:', err.message)
    Sentry.captureException(err, { extra: { project_id, user_id, engine, stage: 'job_create' } })
    return res.status(500).json({ ok: false, error: 'Failed to create audio job' })
  }

  // Fire-and-forget: synthesize in background without blocking the HTTP response
  setImmediate(() => {
    processAudioJob(job).catch((err) => {
      console.error(`[audio-job:${job.id}] unhandled:`, err.message)
      Sentry.captureException(err, { extra: { jobId: job.id, stage: 'processAudioJob_unhandled' } })
    })
  })

  return res.json({ ok: true, job_id: job.id, status: 'pending' })
})

// ── Async image generation endpoints ─────────────────────────────────────────

app.post('/generate-images', verifySecret, async (req, res) => {
  const { project_id, user_id, engine = 'secretslider', image_count, image_interval = 10,
    image_style, custom_style, script, topic, duration_sec, credits_charged = 0 } = req.body
  if (!user_id) return res.status(400).json({ ok: false, error: 'user_id required' })
  if (!image_count || image_count < 1) return res.status(400).json({ ok: false, error: 'image_count required' })
  if (!script?.trim()) return res.status(400).json({ ok: false, error: 'script required' })

  try {
    const rows = await sbPost('image_jobs', {
      project_id: project_id ?? null,
      user_id,
      engine,
      status: 'pending',
      progress: 0,
      image_count,
      image_interval,
      image_style: image_style ?? null,
      custom_style: custom_style ?? null,
      script,
      topic: topic ?? '',
      duration_sec: duration_sec ?? null,
      credits_charged,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    const jobId = Array.isArray(rows) ? rows[0]?.id : rows?.id
    if (!jobId) throw new Error('image_jobs insert returned no id')
    console.log(`[image-job:${jobId}] created engine=${engine} count=${image_count} project=${project_id ?? '(none)'}`)

    setImmediate(() => {
      processImageJob(jobId, req.body).catch(async (err) => {
        console.error(`[image-job:${jobId}] unhandled:`, err.message)
        Sentry.captureException(err, { extra: { jobId, stage: 'processImageJob_unhandled' } })
        await updateImageJob(jobId, { status: 'failed', error_message: `unhandled: ${err.message}` }).catch(() => {})
        if (project_id) {
          await sbPatch('projects', `id=eq.${project_id}&status=eq.generating_images`, { status: 'failed' }).catch(() => {})
        }
      })
    })

    return res.json({ ok: true, job_id: jobId, status: 'pending' })
  } catch (e) {
    console.error('[generate-images] create job failed:', e.message)
    Sentry.captureException(e)
    return res.status(500).json({ ok: false, error: e.message })
  }
})

app.get('/image-status/:jobId', verifySecret, async (req, res) => {
  const { jobId } = req.params
  try {
    const rows = await sbGet('image_jobs', `id=eq.${jobId}&select=id,status,progress,scene_images,error_message,completed_at`)
    const job = Array.isArray(rows) ? rows[0] : null
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found' })
    return res.json({ ok: true, ...job })
  } catch (e) {
    console.error(`[image-status:${jobId}] failed:`, e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Supabase Storage / Audio-job helpers ──────────────────────────────────────
async function uploadToSupabaseStorage(buffer, userId, projectId) {
  const storagePath = `${userId}/${projectId}/audio.mp3`
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/audio/${storagePath}`, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'audio/mpeg',
      'x-upsert':      'true',
    },
    body: buffer,
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Storage upload failed: ${res.status} ${errText.slice(0, 200)}`)
  }
  return `${SUPABASE_URL}/storage/v1/object/public/audio/${storagePath}`
}

async function updateAudioJob(jobId, fields) {
  try {
    await sbPatch('audio_jobs', `id=eq.${jobId}`, { ...fields, updated_at: new Date().toISOString() })
  } catch (e) {
    console.error(`[audio-job:${jobId}] updateAudioJob failed:`, e.message)
    Sentry.captureException(e, { extra: { jobId, fields } })
  }
}

// Server-side refund: runs immediately when a job fails, so users who close the
// browser before the client poll sees status=failed still get their credits back.
// credits_charged is written by Vercel AFTER job creation, so we re-read from DB.
// The credits_refunded_at IS NULL guard ensures the Vercel poll fallback in
// status/route.ts cannot double-refund even if it races with this function.
async function refundAudioJobCredits(jobId, userId, projectId) {
  let amount = 0
  try {
    const rows = await sbGet('audio_jobs', `id=eq.${jobId}&select=credits_charged,credits_refunded_at`)
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row || !(row.credits_charged > 0) || row.credits_refunded_at) return { ok: true, amount: 0 }
    amount = row.credits_charged

    const updated = await sbPatch(
      'audio_jobs',
      `id=eq.${jobId}&credits_refunded_at=is.null`,
      { credits_refunded_at: new Date().toISOString() }
    )
    if (!Array.isArray(updated) || updated.length === 0) return { ok: true, amount: 0 }

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/add_credits`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({
        p_user_id:    userId,
        p_amount:     amount,
        p_operation:  'audio_refund',
        p_project_id: projectId ?? null,
      }),
    })
    if (!rpcRes.ok) throw new Error(`add_credits RPC: ${rpcRes.status} ${await rpcRes.text().catch(() => '')}`)
    console.log(`[audio-job:${jobId}] refunded ${amount} credits to ${userId}`)
    return { ok: true, amount }
  } catch (e) {
    console.error(`[audio-job:${jobId}] refundAudioJobCredits failed:`, e.message)
    Sentry.captureException(e, { extra: { jobId, userId, projectId } })
    return { ok: false, amount, error: e.message }
  }
}

// Mirror of refundAudioJobCredits for video jobs. Called from processVideoJob catch
// and the watchdog video branch. The Vercel status route has a secondary fallback.
async function refundVideoJobCredits(jobId, userId, projectId) {
  let amount = 0
  try {
    const rows = await sbGet('video_jobs', `id=eq.${jobId}&select=credits_charged,credits_refunded_at`)
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row || !(row.credits_charged > 0) || row.credits_refunded_at) return { ok: true, amount: 0 }
    amount = row.credits_charged

    const updated = await sbPatch(
      'video_jobs',
      `id=eq.${jobId}&credits_refunded_at=is.null`,
      { credits_refunded_at: new Date().toISOString() }
    )
    if (!Array.isArray(updated) || updated.length === 0) return { ok: true, amount: 0 }

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/add_credits`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({
        p_user_id:    userId,
        p_amount:     amount,
        p_operation:  'video_refund',
        p_project_id: projectId ?? null,
      }),
    })
    if (!rpcRes.ok) throw new Error(`add_credits RPC: ${rpcRes.status} ${await rpcRes.text().catch(() => '')}`)
    console.log(`[video-job:${jobId}] refunded ${amount} credits to ${userId}`)
    return { ok: true, amount }
  } catch (e) {
    console.error(`[video-job:${jobId}] refundVideoJobCredits failed:`, e.message)
    Sentry.captureException(e, { extra: { jobId, userId, projectId } })
    return { ok: false, amount, error: e.message }
  }
}

// ── Async image generation helpers ────────────────────────────────────────────

async function updateImageJob(jobId, fields) {
  try {
    await sbPatch('image_jobs', `id=eq.${jobId}`, { ...fields, updated_at: new Date().toISOString() })
  } catch (e) {
    console.error(`[image-job:${jobId}] updateImageJob failed:`, e.message)
    Sentry.captureException(e, { extra: { jobId, fields } })
  }
}

async function refundImageJobCredits(jobId, userId, projectId) {
  let amount = 0
  try {
    const rows = await sbGet('image_jobs', `id=eq.${jobId}&select=credits_charged,credits_refunded_at`)
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row || !(row.credits_charged > 0) || row.credits_refunded_at) return { ok: true, amount: 0 }
    amount = row.credits_charged

    const updated = await sbPatch('image_jobs', `id=eq.${jobId}&credits_refunded_at=is.null`, {
      credits_refunded_at: new Date().toISOString(),
    })
    if (!Array.isArray(updated) || updated.length === 0) return { ok: true, amount: 0 }

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/add_credits`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({
        p_user_id:    userId,
        p_amount:     amount,
        p_operation:  'image_refund',
        p_project_id: projectId ?? null,
      }),
    })
    if (!rpcRes.ok) throw new Error(`add_credits RPC: ${rpcRes.status} ${await rpcRes.text().catch(() => '')}`)
    console.log(`[image-job:${jobId}] refunded ${amount} credits to ${userId}`)
    return { ok: true, amount }
  } catch (e) {
    console.error(`[image-job:${jobId}] refundImageJobCredits failed:`, e.message)
    Sentry.captureException(e, { extra: { jobId, userId, projectId } })
    return { ok: false, amount, error: e.message }
  }
}

// Records a failed credit refund in payment_incidents for forensics.
// Never throws — best-effort only. Requires migration 014_refund_incidents.sql.
async function recordRefundIncident(jobId, userId, amount, jobType, errorMsg) {
  try {
    await sbPost('payment_incidents', {
      payment_id:      null,
      job_id:          jobId,
      user_id:         userId,
      kind:            jobType,
      amount_expected: amount,
      reason:          'refund_failed',
      raw_payload:     { job_id: jobId, job_type: jobType, credits: amount, error: errorMsg },
    })
    console.log(`[refund-incident] recorded: job=${jobId.slice(0, 8)} type=${jobType} amount=${amount}`)
  } catch (e) {
    console.error('[refund-incident] insert failed:', e.message)
  }
  if (OWNER_ID) {
    tgApi('sendMessage', {
      chat_id: OWNER_ID,
      text: `🔴 Возврат кредитов НЕ УДАЛСЯ\njob: ${jobId.slice(0, 8)} (${jobType})\nuser: ${userId}\nкредитов: ${amount}\nошибка: ${String(errorMsg).slice(0, 200)}`,
    }).catch(() => {})
  }
}

// Upload an image from a URL to Supabase Storage 'images' bucket (with retry).
async function uploadImageUrlToStorage(imageUrl, storagePath) {
  const delays = [500, 1000, 1500]
  let lastErr = new Error('upload failed')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) })
      if (!imgRes.ok) throw new Error(`fetch image: HTTP ${imgRes.status}`)
      const buffer = await imgRes.arrayBuffer()

      const uploadUrl = `${SUPABASE_URL}/storage/v1/object/images/${storagePath}?upsert=true`
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'apikey':        SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type':  'image/jpeg',
          'x-upsert':      'true',
        },
        body: buffer,
      })
      if (!uploadRes.ok) {
        const errText = await uploadRes.text().catch(() => '')
        throw new Error(`Storage upload: ${uploadRes.status} ${errText.slice(0, 200)}`)
      }
      return `${SUPABASE_URL}/storage/v1/object/public/images/${storagePath}`
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (attempt < 2) await new Promise(r => setTimeout(r, delays[attempt]))
    }
  }
  throw lastErr
}

// ── Image scene generation (ported from src/app/api/generate/images/route.ts) ─

const IMG_SS_ORIGIN  = 'https://secretslider.com'
const IMG_SS_POLL_MS = 5_000
// Empirical: API returned prompt_too_long above this; not from documentation.
const SS_PROMPT_MAX_CHARS = 1000

function imgGetStyleConfig(imageStyle, customStyle) {
  if (customStyle?.trim()) {
    return {
      claudeInstruction: `${customStyle.trim()}. Describe each scene strictly in this visual style.`,
      fluxSuffix: customStyle.trim(),
      negativePrompt: IMG_DEFAULT_STYLE.negativePrompt,
      fallbackPrompt: IMG_DEFAULT_STYLE.fallbackPrompt,
      illustrative: false,
    }
  }
  return imageStyle ? (IMG_STYLE_CONFIGS[imageStyle] ?? IMG_DEFAULT_STYLE) : IMG_DEFAULT_STYLE
}

function imgBuildScenesSystemPrompt(illustrative) {
  return illustrative ? IMG_SCENES_SYSTEM_PROMPT_ILLUSTRATION : IMG_SCENES_SYSTEM_PROMPT_PHOTO
}

function imgParseJsonArray(text) {
  const cleaned = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
  try {
    const v = JSON.parse(cleaned)
    return Array.isArray(v) ? v : []
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) return []
    try {
      const v = JSON.parse(match[0])
      return Array.isArray(v) ? v : []
    } catch { return [] }
  }
}

function imgSanitizeScenePrompt(prompt, sceneIdx) {
  const replacements = [
    [/question marks?/gi, 'tilted-head puzzled pose'],
    [/uncertainty symbols?/gi, 'tilted-head puzzled pose'],
    [/(speech|thought) bubble/gi, ''],
    [/caption box/gi, ''],
    [/montage of/gi, 'scene showing'],
    [/split screen/gi, 'single scene showing'],
    [/comic panels?/gi, 'single scene showing'],
    [/multiple panels?/gi, 'single scene showing'],
    [/\bgrid\b/gi, 'single scene showing'],
    [/text overlay/gi, ''],
    [/\bcaption\b/gi, ''],
  ]
  let result = prompt
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, (match) => {
      console.log(`[sanitize] scene ${sceneIdx}: replaced "${match}" → "${replacement || '(removed)'}"`)
      return replacement
    })
  }
  return result.replace(/\s{2,}/g, ' ').trim()
}

function imgTruncateSecretSliderPrompt(sceneText, fluxSuffix, limit, jobId, sceneIdx) {
  const suffixPart = `, ${fluxSuffix}`
  const full = `${sceneText}${suffixPart}`
  if (full.length <= limit) return full

  // Step a: remove injected character profiles (longest first).
  // imgInjectCharacterProfiles adds " (visual description 30+ chars)" after each name.
  const profiles = []
  const profileRe = /\s*\(([^)]{30,})\)/g
  let m
  while ((m = profileRe.exec(sceneText)) !== null) {
    profiles.push(m[0])
  }
  profiles.sort((a, b) => b.length - a.length)

  let trimmedScene = sceneText
  let removedCount = 0
  for (const profileMatch of profiles) {
    if (`${trimmedScene}${suffixPart}`.length <= limit) break
    trimmedScene = trimmedScene.replace(profileMatch, '').replace(/\s{2,}/g, ' ').trim()
    removedCount++
  }

  // Step b: if still over limit after removing all profiles, truncate at word boundary.
  if (`${trimmedScene}${suffixPart}`.length > limit) {
    const maxSceneChars = limit - suffixPart.length
    let cut = maxSceneChars > 0 ? trimmedScene.slice(0, maxSceneChars) : ''
    const lastSpace = cut.lastIndexOf(' ')
    if (lastSpace > 0) cut = cut.slice(0, lastSpace)
    trimmedScene = cut.trim()
  }

  const result = `${trimmedScene}${suffixPart}`
  console.log(`[image-job:${jobId}] prompt truncated scene ${sceneIdx + 1}: было ${full.length} символов, стало ${result.length}, удалено профилей: ${removedCount}`)
  return result
}

function imgFmtSec(s) {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(2)
  return `${String(m).padStart(2, '0')}:${sec.padStart(5, '0')}`
}

async function imgExtractCharacters(fullText, topic, styleConfig) {
  const styleDirective = styleConfig.illustrative
    ? `\nSTYLE: ILLUSTRATION MODE. Describe each character as a flat drawn SHAPE, not as anatomy.\nFORBIDDEN words in descriptions: hair, fur, mane, molars, teeth, jaw, gut, belly, swollen, coarse, texture, muscle, skin, nostril, pore.\nUse shape-language only: "round head", "flat body", "small ears", "thin stick arms", "short curvy tail".\n`
    : ''

  const descriptionTask = styleConfig.illustrative
    ? `For each recurring character, write a concise 15–35 word ENGLISH description of flat drawn appearance with mandatory shape anchors — self-contained, no script context needed:
• Human figures: age hint via shape (e.g. "small round-headed child figure", "tall stick adult"), flat hair-shape and color, beard shape or "no beard", flat clothing color.
• Drawn animals/creatures: species, flat body color(s), pattern shapes (e.g. "dark oval spots"), size relative to frame, two distinctive shape features (e.g. "wide flat ears", "short curvy tail").
FORBIDDEN — exclude any term that does not anchor flat-drawn appearance: "average", "ordinary", "typical", "generic".
This description will be copied verbatim into illustration prompts.`
    : `For each recurring character, write a concise 15–35 word ENGLISH visual description with mandatory visual anchors — self-contained, recognisable without reading the script:
• Humans: approximate age (e.g. "mid-30s"), hair color and length, hairstyle shape, facial hair or explicitly "no beard", skin tone, eye color, one characteristic clothing item with color.
• Animals and creatures: species, coat color and pattern (e.g. "white with black spots"), size (e.g. "large"), two or three distinctive body parts.
FORBIDDEN — exclude any term that adds no visual anchor: "average build", "casual appearance", "adult male human", "ordinary", "typical".
This description will be copied verbatim into scene prompts.`

  try {
    const msg = await claude().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Analyze this video script about "${topic}". Identify visual characters (animals, creatures, people, beings) that appear visually in multiple scenes.

PURPOSE: These profiles ensure the character looks IDENTICAL every time it appears in an illustration. A profile does NOT mean the character must appear in every scene.
${styleDirective}
${descriptionTask}

Rules:
- Include a character only if it will be visually depicted in 2 or more scenes
- Return [] if all scenes show completely different subjects with no visual repeats
- Maximum 4 characters
- Descriptions must be purely visual

Respond ONLY with valid JSON, no markdown:
[{"name": "name or species as used in script", "description": "english visual description"}]

Script (first 3000 chars):
${fullText.slice(0, 3000)}`,
      }],
    })
    const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '[]'
    return imgParseJsonArray(raw).slice(0, 4)
  } catch (e) {
    console.error('[images] extractCharacters failed:', e instanceof Error ? e.message : e)
    return []
  }
}

function imgInjectCharacterProfiles(prompts, characters) {
  if (!Array.isArray(characters) || !characters.length) return prompts
  return prompts.map((p) => {
    for (const char of characters) {
      if (!char.name || !char.description) continue
      const nameEscaped = char.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const namePattern = new RegExp(`(?<![\\p{L}\\p{N}_])${nameEscaped}(?![\\p{L}\\p{N}_])`, 'iu')
      if (!namePattern.test(p)) continue
      if (p.includes(char.description)) continue
      p = p.replace(namePattern, `${char.name} (${char.description})`)
    }
    return p
  })
}

const IMG_CLAUDE_CHUNK = 50

function imgSplitSubtitlesIntoGroups(blocks, n) {
  const groups = Array.from({ length: n }, () => [])
  if (!blocks.length) return groups
  const startTime = blocks[0].start
  const totalDuration = blocks[blocks.length - 1].end - startTime
  const groupDuration = totalDuration / n
  for (const block of blocks) {
    const idx = Math.min(n - 1, Math.floor((block.start - startTime) / groupDuration))
    groups[idx].push(block)
  }
  return groups
}

async function imgGenerateScenesFromSubtitles(topic, imageCount, durationSec, subtitleBlocks, styleConfig, fallbackTopic, jobId = 'unknown') {
  const groups = imgSplitSubtitlesIntoGroups(subtitleBlocks, imageCount)
  // Pass 1: build timecodes; empty windows get empty string — no "Сцена N" placeholder.
  const scenesRaw = groups.map((group, i) => ({
    start: group.length > 0 ? group[0].start : (durationSec / imageCount) * i,
    end:   group.length > 0 ? group[group.length - 1].end : (durationSec / imageCount) * (i + 1),
    text:  group.map(b => b.text).join(' ').trim(),
  }))
  // Pass 2: fill empty windows with text from the nearest non-empty neighbours.
  const scenesWithText = scenesRaw.map((s, i) => {
    if (s.text) return s
    const prevBlocks = []
    for (let p = i - 1; p >= 0; p--) {
      if (groups[p].length > 0) { prevBlocks.push(...groups[p].slice(-2).map(b => b.text)); break }
    }
    const nextBlocks = []
    for (let n = i + 1; n < groups.length; n++) {
      if (groups[n].length > 0) { nextBlocks.push(...groups[n].slice(0, 2).map(b => b.text)); break }
    }
    const neighbourText = [...prevBlocks, ...nextBlocks].join(' ').trim() || topic
    console.log(`[image-job:${jobId}] scene ${i + 1}: empty subtitle window, using neighbours (prev: ${prevBlocks.join(' ').length} chars, next: ${nextBlocks.join(' ').length} chars)`)
    return { ...s, text: neighbourText }
  })

  const fullText = subtitleBlocks.map(b => b.text).join(' ')
  const characters = await imgExtractCharacters(fullText, topic, styleConfig)
  const charSection = characters.length > 0
    ? `\nПЕРСОНАЖИ — включать точные описания в промпты для сцен где они присутствуют:\n${characters.map(c => `• ${c.name}: ${c.description}`).join('\n')}\n`
    : ''

  const totalChunks = Math.ceil(scenesWithText.length / IMG_CLAUDE_CHUNK)
  console.log(`[images/subtitles] scenes: ${scenesWithText.length}, chunks: ${totalChunks}`)
  let sceneFallbackCount = 0

  const chunkOutputs = await Promise.all(
    Array.from({ length: totalChunks }, async (_, ci) => {
      const chunkStart = ci * IMG_CLAUDE_CHUNK
      const chunk = scenesWithText.slice(chunkStart, chunkStart + IMG_CLAUDE_CHUNK)
      const chunkSize = chunk.length
      const maxTokens = Math.min(64000, Math.max(8000, chunkSize * 250))
      const label = `subtitles chunk ${ci + 1}/${totalChunks}`
      const t0 = Date.now()

      const callChunk = () => claude().messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system: [{ type: 'text', text: imgBuildScenesSystemPrompt(styleConfig.illustrative ?? false), cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: `Видео на тему: "${topic}". Ниже — ${chunkSize} сцен из реальной расшифровки аудио (Whisper).

КОНТЕКСТ РОЛИКА: «${topic}»
Если текст конкретной сцены краткий — иллюстрируй характерный момент из этой темы, не используй обобщённые фигуры без сюжета.

СТИЛЬ ИЛЛЮСТРАЦИЙ (соблюдать в каждом промте):
${styleConfig.claudeInstruction}
${charSection}
СЦЕНЫ:
${chunk.map((s, i) => `Сцена ${chunkStart + i + 1} [${imgFmtSec(s.start)}–${imgFmtSec(s.end)}]: "${s.text}"`).join('\n')}

Ответь JSON массивом ровно ${chunkSize} элементов.`,
        }],
      })

      let e1Msg = ''
      const ta = Date.now()
      const message = await callChunk().catch(async (e1) => {
        e1Msg = e1 instanceof Error ? e1.message.slice(0, 150) : String(e1)
        const dur1 = ((Date.now() - ta) / 1000).toFixed(1)
        console.warn(`[images/subtitles] ${label} attempt 1 failed (${dur1}s): ${e1Msg} — retrying in 5s`)
        await new Promise(r => setTimeout(r, 5000))
        return callChunk().catch((e2) => {
          const e2Msg = e2 instanceof Error ? e2.message.slice(0, 150) : String(e2)
          console.error(`[images/subtitles] ${label} both attempts failed: ${e1Msg} | ${e2Msg}`)
          return null
        })
      })

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      if (!message) {
        sceneFallbackCount += chunkSize
        return Array.from({ length: chunkSize }, (_, j) => ({
          scene: `Сцена ${chunkStart + j + 1}`,
          prompt: imgSanitizeScenePrompt(styleConfig.fallbackPrompt, chunkStart + j),
        }))
      }

      console.log(`[images/subtitles] ${label} done in ${elapsed}s`)
      const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
      const chunkResults = imgParseJsonArray(rawText)
      while (chunkResults.length < chunkSize) {
        const absIdx = chunkStart + chunkResults.length
        sceneFallbackCount++
        chunkResults.push({ scene: `Сцена ${absIdx + 1}`, prompt: imgSanitizeScenePrompt(styleConfig.fallbackPrompt, absIdx) })
      }
      return chunkResults
    })
  )

  let promptResults = chunkOutputs.flat()
  if (promptResults.length > imageCount) promptResults = promptResults.slice(0, imageCount)
  while (promptResults.length < imageCount) {
    const fallbackIdx = promptResults.length
    sceneFallbackCount++
    promptResults.push({ scene: `Сцена ${fallbackIdx + 1}`, prompt: imgSanitizeScenePrompt(styleConfig.fallbackPrompt, fallbackIdx) })
  }

  if (sceneFallbackCount > 0) {
    console.warn(`[images/subtitles] ${sceneFallbackCount}/${imageCount} scenes used fallback prompts`)
  }

  const rawPromptsForInject = promptResults.map(r => r.prompt)
  const injectedPrompts = imgInjectCharacterProfiles(rawPromptsForInject, characters)
  const injectedCount = injectedPrompts.filter((p, i) => p !== rawPromptsForInject[i]).length
  console.log(`[characters] extracted=${characters.length} names=${characters.map(c => c.name).join(', ')} injected=${injectedCount} prompts_total=${promptResults.length} first_desc="${(characters[0]?.description ?? '').slice(0, 80)}"`)
  if (injectedCount > 0) {
    promptResults = promptResults.map((r, i) => ({ ...r, prompt: injectedPrompts[i] }))
  }

  return promptResults.map((p, i) => ({
    ...p,
    timecode_start: imgFmtSec(scenesWithText[i].start),
    timecode_end: imgFmtSec(scenesWithText[i].end),
  }))
}

function imgSplitScriptByWords(script, n) {
  const sentences = script.split(/(?<=[.!?…])\s+/).filter(s => s.trim())
  if (sentences.length === 0) return [script]
  const totalWords = script.split(/\s+/).filter(Boolean).length
  const wordsPerBlock = totalWords / n
  const blocks = []
  let currentBlock = []
  let currentWordCount = 0
  for (const sentence of sentences) {
    currentBlock.push(sentence)
    currentWordCount += sentence.split(/\s+/).filter(Boolean).length
    if (currentWordCount >= wordsPerBlock && blocks.length < n - 1) {
      blocks.push(currentBlock.join(' '))
      currentBlock = []
      currentWordCount = 0
    }
  }
  if (currentBlock.length > 0) blocks.push(currentBlock.join(' '))
  while (blocks.length < n) blocks.push(blocks[blocks.length - 1] ?? script)
  return blocks.slice(0, n)
}

function imgCalculateTimecodes(blocks, totalDurationSec) {
  const counts = blocks.map(b => b.split(/\s+/).filter(Boolean).length)
  const total = counts.reduce((a, b) => a + b, 0) || 1
  let currentTime = 0
  return blocks.map((text, i) => {
    const duration = (counts[i] / total) * totalDurationSec
    const start = currentTime
    currentTime += duration
    return { start, end: currentTime, text }
  })
}

async function imgGenerateScenesFromScript(script, topic, durationSec, imageCount, styleConfig) {
  const blocks = imgSplitScriptByWords(script, imageCount)
  const blocksWithTimecodes = imgCalculateTimecodes(blocks, durationSec)

  const characters = await imgExtractCharacters(script, topic, styleConfig)
  const charSection = characters.length > 0
    ? `\nПЕРСОНАЖИ — включать точные описания в промпты для сцен где они присутствуют:\n${characters.map(c => `• ${c.name}: ${c.description}`).join('\n')}\n`
    : ''

  const totalChunks = Math.ceil(blocksWithTimecodes.length / IMG_CLAUDE_CHUNK)
  console.log(`[images/script] scenes: ${blocksWithTimecodes.length}, chunks: ${totalChunks}`)
  let sceneFallbackCount = 0

  const chunkOutputs = await Promise.all(
    Array.from({ length: totalChunks }, async (_, ci) => {
      const chunkStart = ci * IMG_CLAUDE_CHUNK
      const chunk = blocksWithTimecodes.slice(chunkStart, chunkStart + IMG_CLAUDE_CHUNK)
      const chunkSize = chunk.length
      const maxTokens = Math.min(64000, Math.max(8000, chunkSize * 250))
      const label = `script chunk ${ci + 1}/${totalChunks}`
      const t0 = Date.now()

      const callChunk = () => claude().messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system: [{ type: 'text', text: imgBuildScenesSystemPrompt(styleConfig.illustrative ?? false), cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: `Видео на тему: "${topic}". Ниже — ${chunkSize} отрывков сценария с тайм-кодами.

СТИЛЬ ИЛЛЮСТРАЦИЙ (соблюдать в каждом промте):
${styleConfig.claudeInstruction}
${charSection}
ОТРЫВКИ:
${chunk.map((b, i) => `Сцена ${chunkStart + i + 1} [${imgFmtSec(b.start)}–${imgFmtSec(b.end)}]:\n"${b.text.slice(0, 400)}"`).join('\n\n')}

Ответь JSON массивом ровно ${chunkSize} элементов.`,
        }],
      })

      let e1Msg = ''
      const ta = Date.now()
      const message = await callChunk().catch(async (e1) => {
        e1Msg = e1 instanceof Error ? e1.message.slice(0, 150) : String(e1)
        const dur1 = ((Date.now() - ta) / 1000).toFixed(1)
        console.warn(`[images/script] ${label} attempt 1 failed (${dur1}s): ${e1Msg} — retrying in 5s`)
        await new Promise(r => setTimeout(r, 5000))
        return callChunk().catch((e2) => {
          const e2Msg = e2 instanceof Error ? e2.message.slice(0, 150) : String(e2)
          console.error(`[images/script] ${label} both attempts failed: ${e1Msg} | ${e2Msg}`)
          return null
        })
      })

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      if (!message) {
        sceneFallbackCount += chunkSize
        return Array.from({ length: chunkSize }, (_, j) => {
          const absIdx = chunkStart + j
          return {
            scene: blocksWithTimecodes[absIdx]?.text.slice(0, 80).trim() ?? `Сцена ${absIdx + 1}`,
            prompt: imgSanitizeScenePrompt(styleConfig.fallbackPrompt, absIdx),
          }
        })
      }

      console.log(`[images/script] ${label} done in ${elapsed}s`)
      const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
      const chunkResults = imgParseJsonArray(rawText)
      while (chunkResults.length < chunkSize) {
        const absIdx = chunkStart + chunkResults.length
        sceneFallbackCount++
        chunkResults.push({
          scene: blocksWithTimecodes[absIdx]?.text.slice(0, 80).trim() ?? `Сцена ${absIdx + 1}`,
          prompt: imgSanitizeScenePrompt(styleConfig.fallbackPrompt, absIdx),
        })
      }
      return chunkResults
    })
  )

  let promptResults = chunkOutputs.flat()
  if (promptResults.length > imageCount) promptResults = promptResults.slice(0, imageCount)
  while (promptResults.length < imageCount) {
    const i = promptResults.length
    sceneFallbackCount++
    promptResults.push({
      scene: blocksWithTimecodes[i]?.text.slice(0, 80).trim() ?? `Сцена ${i + 1}`,
      prompt: imgSanitizeScenePrompt(styleConfig.fallbackPrompt, i),
    })
  }

  if (sceneFallbackCount > 0) {
    console.warn(`[images/script] ${sceneFallbackCount}/${imageCount} scenes used fallback prompts`)
  }

  const rawPromptsForInject = promptResults.map(r => r.prompt)
  const injectedPrompts = imgInjectCharacterProfiles(rawPromptsForInject, characters)
  const injectedCount = injectedPrompts.filter((p, i) => p !== rawPromptsForInject[i]).length
  console.log(`[characters] extracted=${characters.length} names=${characters.map(c => c.name).join(', ')} injected=${injectedCount} prompts_total=${promptResults.length} first_desc="${(characters[0]?.description ?? '').slice(0, 80)}"`)
  if (injectedCount > 0) {
    promptResults = promptResults.map((r, i) => ({ ...r, prompt: injectedPrompts[i] }))
  }

  return promptResults.map((p, i) => ({
    ...p,
    timecode_start: imgFmtSec(blocksWithTimecodes[i].start),
    timecode_end: imgFmtSec(blocksWithTimecodes[i].end),
  }))
}

async function imgGenerateSecretSlider(prompts, jobId) {
  const apiKey = env('SECRETSLIDER_API_KEY')
  if (!apiKey) throw new Error('[secretslider] SECRETSLIDER_API_KEY not configured')

  const pollMaxMs = parseInt(env('IMAGES_ASYNC_POLL_MAX_MIN') || '30', 10) * 60_000
  console.log(`[secretslider] task start: prompts=${prompts.length} poll_max=${Math.round(pollMaxMs / 1000)}s`)

  // Guard: reject if a task is already running (one active task per key).
  try {
    const activeRes = await fetch(`${IMG_SS_ORIGIN}/api/v2/tasks/active`, {
      headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (activeRes.ok) {
      const active = await activeRes.json()
      if ((active.active_count ?? 0) > 0) {
        const waitSec = active.active_tasks?.[0]?.estimated_wait_seconds ?? 0
        throw new Error(`SS_BUSY:${waitSec}`)
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('SS_BUSY')) throw err
    console.warn('[secretslider] tasks/active check failed, proceeding:', err instanceof Error ? err.message : String(err))
  }

  const form = new FormData()
  form.append('mode', 'visual')
  form.append('prompts', JSON.stringify(prompts))
  form.append('num_images', '1')
  form.append('aspect_ratio', '16:9')

  const genRes = await fetch(`${IMG_SS_ORIGIN}/api/v2/generate`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
    body: form,
    signal: AbortSignal.timeout(30_000),
  })
  if (genRes.status === 429) {
    const body = await genRes.text().catch(() => '')
    let retrySec = 0
    try { retrySec = JSON.parse(body).retry_after ?? 0 } catch { /* non-JSON */ }
    throw new Error(`SS_BUSY:${retrySec}`)
  }
  if (genRes.status !== 202) {
    const body = await genRes.text().catch(() => '')
    throw new Error(`[secretslider] POST /generate returned ${genRes.status}: ${body.slice(0, 300)}`)
  }

  const { task_id: taskId } = await genRes.json()
  if (!taskId) throw new Error('[secretslider] no task_id in response')
  console.log(`[secretslider] task=${taskId} prompts=${prompts.length}`)
  if (jobId) {
    await updateImageJob(jobId, { provider_task_id: taskId })
    console.log(`[images-async] provider task id: ${taskId}`)
  }

  const t0 = Date.now()
  const deadline = t0 + pollMaxMs
  let polls = 0
  let lastPoll = null
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, IMG_SS_POLL_MS))
    const elapsed = Math.round((Date.now() - t0) / 1000)

    const pollRes = await fetch(`${IMG_SS_ORIGIN}/api/v2/task/${taskId}`, {
      headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!pollRes.ok) {
      polls++
      console.warn(`[secretslider] poll ${elapsed}s http=${pollRes.status}`)
      continue
    }

    const poll = await pollRes.json()
    polls++
    lastPoll = poll
    console.log(`[secretslider] poll ${elapsed}s status=${poll.status} image_count=${poll.results?.image_count ?? '?'}`)

    if (poll.status === 'failed') throw new Error(`[secretslider] task ${taskId} failed`)

    if (poll.status === 'completed') {
      const urls = poll.results?.image_urls ?? []
      if (urls.length !== prompts.length) {
        throw new Error(`[secretslider] image_count mismatch: expected ${prompts.length}, got ${urls.length}`)
      }
      const duration = Math.round((Date.now() - t0) / 1000)
      console.log(`[secretslider] task done: task=${taskId} prompts=${prompts.length} duration=${duration}s polls=${polls}`)
      return urls.map(u => {
        if (u.startsWith('/')) return `${IMG_SS_ORIGIN}${u}`
        if (u.startsWith('http://')) return `https://${u.slice(7)}`
        return u
      })
    }
  }
  // One final check — task may have completed during the last poll interval
  const finalRes = await fetch(`${IMG_SS_ORIGIN}/api/v2/task/${taskId}`, {
    headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  const finalPoll = finalRes?.ok ? await finalRes.json().catch(() => null) : null
  const finalUrls = finalPoll?.results?.image_urls ?? []
  if (finalPoll?.status === 'completed' && finalUrls.length === prompts.length) {
    console.log(`[secretslider] RECOVERED after poll timeout: task=${taskId}`)
    return finalUrls.map(u => {
      if (u.startsWith('/')) return `${IMG_SS_ORIGIN}${u}`
      if (u.startsWith('http://')) return `https://${u.slice(7)}`
      return u
    })
  }
  const waited = Math.round((Date.now() - t0) / 1000)
  const lastStatus = finalPoll?.status ?? lastPoll?.status ?? 'unreachable'
  const lastImages = finalPoll?.results?.image_urls?.length ?? lastPoll?.results?.image_urls?.length ?? 0
  console.log(`[secretslider] task NOT done: task=${taskId} prompts=${prompts.length} waited=${waited}s last_status=${lastStatus} images=${lastImages}`)
  throw new Error('Генерация не завершилась в отведённое время. Кредиты за неполученные изображения не списаны. Попробуйте повторить.')
}

async function processImageJob(jobId, body) {
  const { project_id, user_id, engine, image_count, image_interval, image_style, custom_style, script, topic, duration_sec, cost_per_image = 0 } = body
  const count = Math.max(1, image_count)
  const interval = Math.max(3, Math.min(300, image_interval ?? 10))
  const t0Request = Date.now()

  await updateImageJob(jobId, { status: 'processing', progress: 5 })
  if (project_id) {
    await sbPatch('projects', `id=eq.${project_id}&user_id=eq.${user_id}`, { status: 'generating_images', scene_images: [] })
      .catch(e => console.warn(`[image-job:${jobId}] project status set failed:`, e.message))
  }

  try {
    const styleConfig = imgGetStyleConfig(image_style, custom_style)
    console.log(`[image-job:${jobId}] engine=${engine} style="${image_style ?? 'default'}" count=${count}`)

    // Read subtitle_blocks from projects table (avoids large payload in POST body).
    let subtitleBlocks = null
    let projectTitle = ''
    if (project_id) {
      try {
        const projRows = await sbGet('projects', `id=eq.${project_id}&user_id=eq.${user_id}&select=subtitle_blocks,title`)
        const proj = Array.isArray(projRows) ? projRows[0] : null
        subtitleBlocks = proj?.subtitle_blocks ?? null
        projectTitle = (proj?.title ?? '').trim()
      } catch (e) {
        console.warn(`[image-job:${jobId}] project read failed:`, e.message)
      }
    }
    const hasSubtitles = Array.isArray(subtitleBlocks) && subtitleBlocks.length > 0

    const effectiveTopic = (script ?? '').split(/\s+/).slice(0, 20).join(' ').trim() || (topic ?? '').slice(0, 150)
    const rawUserTopic = (topic ?? '').trim()
    const fallbackTopic = rawUserTopic && rawUserTopic.length <= 120
      ? rawUserTopic.split(/\s+/).slice(0, 8).join(' ')
      : projectTitle && projectTitle.length <= 120
        ? projectTitle.split(/\s+/).slice(0, 8).join(' ')
        : (script ?? '').split(/\s+/).slice(0, 8).join(' ')

    console.log(`[image-job:${jobId}] mode=${hasSubtitles ? 'subtitle' : 'script'} count=${count}`)
    await updateImageJob(jobId, { progress: 10 })

    const t0Claude = Date.now()
    const scenes = hasSubtitles
      ? await imgGenerateScenesFromSubtitles(effectiveTopic, count, duration_sec ?? 300, subtitleBlocks, styleConfig, fallbackTopic, jobId)
      : await imgGenerateScenesFromScript(script ?? '', effectiveTopic, duration_sec ?? 300, count, styleConfig)
    const claudeSec = ((Date.now() - t0Claude) / 1000).toFixed(1)
    console.log(`[image-job:${jobId}] claude done: ${scenes.length} scenes in ${claudeSec}s`)
    await updateImageJob(jobId, { progress: 30 })

    if (engine !== 'secretslider') {
      throw new Error(`[image-job] engine '${engine}' is not supported on Railway; only secretslider`)
    }

    const allStyledPrompts = scenes.map((scn, i) => {
      const cleanedScene = imgSanitizeScenePrompt(scn.prompt, i)
      const styledPrompt = engine === 'secretslider'
        ? imgTruncateSecretSliderPrompt(cleanedScene, styleConfig.fluxSuffix, SS_PROMPT_MAX_CHARS, jobId, i)
        : `${cleanedScene}, ${styleConfig.fluxSuffix}`
      console.log(`[image-job:${jobId}] scene ${i + 1} prompt: "${styledPrompt.slice(0, 120)}"`)
      return styledPrompt
    })

    const ssUrls = await imgGenerateSecretSlider(allStyledPrompts, jobId)
    console.log(`[image-job:${jobId}] secretslider returned ${ssUrls.length} URLs in ${((Date.now() - t0Request) / 1000).toFixed(1)}s`)
    await updateImageJob(jobId, { progress: 70 })

    const sceneImages = new Array(scenes.length)
    let successCount = 0
    let failCount = 0
    let chargedCredits = 0
    // Set to { stoppedAt: i, reason: string } when deduct_credits fails — triggers early stop after loop.
    let creditExhausted = null

    for (let i = 0; i < scenes.length; i++) {
      const scn = scenes[i]
      const styledPrompt = allStyledPrompts[i]
      const ssUrl = ssUrls[i]
      try {
        const storagePath = project_id ? `${user_id}/${project_id}/scene_ss_${i}.jpg` : null
        const t0Upload = Date.now()
        const url = project_id
          ? await uploadImageUrlToStorage(ssUrl, storagePath)
          : ssUrl
        const uploadMs = Date.now() - t0Upload
        const audioFp = duration_sec != null ? Math.round(duration_sec) : undefined
        sceneImages[i] = {
          scene_index: i, prompt: styledPrompt, url,
          scene: scn.scene, timecode_start: scn.timecode_start, timecode_end: scn.timecode_end,
          engine, audio_fingerprint: audioFp,
        }
        successCount++
        // Charge one credit per successfully uploaded image (mirrors images/route.ts:1279).
        // credits_charged tracks cumulative total in DB so watchdog/recovery can refund exactly.
        if (cost_per_image > 0) {
          const chargeRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/deduct_credits`, {
            method: 'POST',
            headers: sbHeaders(),
            body: JSON.stringify({
              p_user_id:    user_id,
              p_amount:     cost_per_image,
              p_operation:  `image_${engine}`,
              p_project_id: project_id ?? null,
            }),
            signal: AbortSignal.timeout(10_000),
          })
          if (chargeRes.ok) {
            const chargeJson = await chargeRes.json().catch(() => null)
            if (chargeJson?.success) {
              chargedCredits += cost_per_image
            } else {
              // HTTP 200 + success:false = insufficient balance — stop loop.
              // Image at index i is uploaded (storage file exists) but NOT charged and NOT included in paidImages.
              console.warn(`[image-job:${jobId}] deduct_credits scene ${i + 1}: insufficient balance (remaining=${chargeJson?.remaining ?? '?'}) — stopping`)
              creditExhausted = { stoppedAt: i, reason: `insufficient, remaining=${chargeJson?.remaining ?? '?'}` }
            }
          } else {
            console.warn(`[image-job:${jobId}] deduct_credits scene ${i + 1} http=${chargeRes.status} — stopping`)
            creditExhausted = { stoppedAt: i, reason: `deduct_credits http=${chargeRes.status}` }
          }
        }
        console.log(`[image-job:${jobId}] scene ${i + 1} upload: ${uploadMs}ms url=${url?.slice(0, 80) ?? 'NULL'}`)
      } catch (err) {
        failCount++
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[image-job:${jobId}] scene ${i + 1} upload FAILED:`, msg)
        sceneImages[i] = {
          scene_index: i, prompt: styledPrompt, url: null,
          scene: scn.scene, timecode_start: scn.timecode_start, timecode_end: scn.timecode_end,
          engine, audio_fingerprint: duration_sec != null ? Math.round(duration_sec) : undefined,
        }
      }
      const progress = 70 + Math.round(((i + 1) / scenes.length) * 25)
      await updateImageJob(jobId, { progress, credits_charged: chargedCredits })
      if (creditExhausted) break
    }

    // ── Credit-exhausted early stop ────────────────────────────────────────
    // Paid images (indices 0..stoppedAt-1) stay with the user; no refund for them.
    // Image at stoppedAt was uploaded but NOT charged — excluded from paidImages.
    if (creditExhausted) {
      const paidImages = sceneImages.slice(0, creditExhausted.stoppedAt).filter(Boolean)
      const paidCount = cost_per_image > 0 ? chargedCredits / cost_per_image : paidImages.length
      const errMsg = `Недостаточно кредитов — сгенерировано ${paidCount} из ${scenes.length} иллюстраций`
      console.warn(`[image-job:${jobId}] credit stop: ${creditExhausted.reason}; paid=${paidCount}/${scenes.length}`)
      await updateImageJob(jobId, {
        status: 'failed',
        progress: 70 + Math.round((creditExhausted.stoppedAt / scenes.length) * 25),
        credits_charged: chargedCredits,
        scene_images: paidImages.length > 0 ? paidImages : null,
        error_message: errMsg,
        completed_at: new Date().toISOString(),
      })
      if (project_id) {
        if (paidImages.length > 0) {
          await sbPatch('projects', `id=eq.${project_id}&user_id=eq.${user_id}`, {
            scene_images: paidImages,
            image_interval: interval,
            image_style: image_style ?? null,
            status: 'draft',
          }).catch(e => console.warn(`[image-job:${jobId}] project partial write failed:`, e.message))
        } else {
          await sbPatch('projects', `id=eq.${project_id}&status=eq.generating_images`, { status: 'failed' })
            .catch(e => console.warn(`[image-job:${jobId}] project failure mark (no paid images) failed:`, e.message))
        }
      }
      return
    }
    // ── end credit-exhausted handler ───────────────────────────────────────

    const validImages = sceneImages.filter(Boolean)
    const totalSec = ((Date.now() - t0Request) / 1000).toFixed(1)
    console.log(`[image-job:${jobId}] SUMMARY: engine=${engine} created=${successCount} failed=${failCount} total_sec=${totalSec}s`)

    await updateImageJob(jobId, {
      status: 'completed',
      progress: 100,
      scene_images: validImages,
      completed_at: new Date().toISOString(),
    })

    if (Date.now() - t0Request > 90_000) {
      notifyUserJobDone(user_id, 'images', { count: validImages.length }).catch(() => {})
    }

    if (project_id) {
      await sbPatch('projects', `id=eq.${project_id}&user_id=eq.${user_id}`, {
        scene_images: validImages,
        image_interval: interval,
        image_style: image_style ?? null,
        status: 'draft',
      }).catch(e => console.warn(`[image-job:${jobId}] project final write failed:`, e.message))
      console.log(`[image-job:${jobId}] project updated with ${validImages.length} images`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[image-job:${jobId}] failed:`, msg)
    Sentry.captureException(err, { extra: { jobId, project_id, user_id, engine } })
    await updateImageJob(jobId, { status: 'failed', error_message: msg })
    const imageRefund = await refundImageJobCredits(jobId, user_id, project_id)
    if (!imageRefund.ok && imageRefund.amount > 0) {
      await recordRefundIncident(jobId, user_id, imageRefund.amount, 'image', imageRefund.error)
    }
    if (project_id) {
      await sbPatch('projects', `id=eq.${project_id}&status=eq.generating_images`, { status: 'failed' })
        .catch(e => console.warn(`[image-job:${jobId}] project failure mark failed:`, e.message))
    }
    if (OWNER_ID) {
      tgApi('sendMessage', { chat_id: OWNER_ID, text: `⚠️ image_job ${jobId.slice(0, 8)} failed: ${msg.slice(0, 200)}` })
        .catch(() => {})
    }
    if (Date.now() - t0Request > 90_000) {
      notifyUserJobDone(user_id, 'images_failed').catch(() => {})
    }
  }
}

// TTS: SecretVoicer + Voicer synthesis helpers ──────────────────────────────

const SV_BASE       = 'https://secret-voicer.ru/api/v1'
const VOICER_DOMAIN = 'https://voicer.mat3u.com'
const VOICER_BASE   = `${VOICER_DOMAIN}/api/v1`

// Per-engine text chunk limits (chars). Voicer splits internally via split_type:'smart'.
const TTS_CHUNK_LIMITS = {
  secretvoicer: { maxChars: 3000,   measureBytes: false },
  voicer:       { maxChars: 195000, measureBytes: false },
}

const SV_CHUNK_TIMEOUT_MS     = parseInt(env('SV_CHUNK_TIMEOUT_MS')     || '600000',  10) // 10 min default
const VOICER_CHUNK_TIMEOUT_MS = parseInt(env('VOICER_CHUNK_TIMEOUT_MS') || '1800000', 10) // 30 min default

// Strip ID3v2 tag from start of MP3 buffer.
// Applied to all non-first chunks before Buffer.concat to prevent PTS-reset drift
// that causes audio-video sync loss in the final video.
function stripId3Tag(buf) {
  if (buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const tagSize = ((buf[6] & 0x7f) << 21)
                 | ((buf[7] & 0x7f) << 14)
                 | ((buf[8] & 0x7f) <<  7)
                 |  (buf[9] & 0x7f)
    const end = 10 + tagSize
    if (end < buf.length) return buf.subarray(end)
  }
  return buf
}

// Re-encode a concatenated MP3 buffer through local ffmpeg so the output has a
// correct Xing/Info header covering the full file. Without this, the stale TOC
// from chunk 1 causes browser seeks past the first chunk to land at wrong offsets.
// Pipes buffer via stdin → stdout to avoid temp files.
function repairMp3Buffer(buf) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-v', 'error',
      '-i', 'pipe:0',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      '-ar', '44100',
      '-f', 'mp3',
      'pipe:1',
    ])
    const out = []
    ff.stdout.on('data', d => out.push(d))
    ff.on('error', reject)
    ff.on('close', code => {
      if (code !== 0) { reject(new Error(`ffmpeg exited ${code}`)); return }
      resolve(Buffer.concat(out))
    })
    ff.stdin.end(buf)
  })
}

// Split text into chunks fitting within per-engine char/byte limit.
// Splits at paragraph → sentence boundaries; word-split as last resort.
function splitTextIntoChunks(text, maxChars, measureBytes) {
  const measure = (s) => measureBytes ? Buffer.byteLength(s, 'utf8') : s.length
  if (measure(text) <= maxChars) return [text]

  const sentences = text
    .split(/\n{2,}/)
    .flatMap(para => para.split(/(?<=[.!?…])\s+/))
    .map(s => s.trim())
    .filter(Boolean)

  const chunks = []
  let current = ''

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence
    if (measure(candidate) <= maxChars) {
      current = candidate
    } else {
      if (current) chunks.push(current)
      if (measure(sentence) > maxChars) {
        const words = sentence.split(/\s+/)
        let wordBuf = ''
        for (const word of words) {
          const wCand = wordBuf ? `${wordBuf} ${word}` : word
          if (measure(wCand) <= maxChars) {
            wordBuf = wCand
          } else {
            if (wordBuf) chunks.push(wordBuf)
            wordBuf = word
          }
        }
        current = wordBuf
      } else {
        current = sentence
      }
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.filter(Boolean)
}

// Run up to `limit` async tasks concurrently, preserving result order by index.
async function runLimited(fns, limit) {
  const results = new Array(fns.length)
  let next = 0
  async function worker() {
    while (next < fns.length) {
      const i = next++
      results[i] = await fns[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, worker))
  return results
}

// Submit one text chunk to SecretVoicer; poll until COMPLETED.
// Returns Buffer (MP3). Throws on failure or timeout.
async function synthesizeSecretVoicerChunk(text, voiceId, settings, jobId) {
  const apiKey = env('SECRETVOICER_API_KEY')
  const chunkStart = Date.now()
  const res = await fetch(`${SV_BASE}/synthesize`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice_id:         voiceId,
      mode:             'standard',
      stability:        settings.stability,
      similarity_boost: settings.similarity,
      style:            settings.style,
      rate:             settings.speechRate,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`SecretVoicer HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  const j = await res.json()
  const taskId = j.task_id
  if (!taskId) throw new Error('SecretVoicer: no task_id in response')

  const POLL_MS = 2500
  const deadline = Date.now() + SV_CHUNK_TIMEOUT_MS
  let ticks = 0

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    ticks++
    if (ticks % 12 === 0) await heartbeatAudioJob(jobId)
    let status
    try {
      const pollRes = await fetch(`${SV_BASE}/task/${taskId}`, {
        headers: { 'X-API-Key': apiKey },
      })
      if (!pollRes.ok) continue
      status = await pollRes.json()
    } catch {
      continue
    }
    if (status.status === 'COMPLETED') {
      if (!status.audio_url) throw new Error('SecretVoicer: COMPLETED but no audio_url')
      const dlRes = await fetch(status.audio_url)
      if (!dlRes.ok) throw new Error(`SecretVoicer download HTTP ${dlRes.status}`)
      const buf = Buffer.from(await dlRes.arrayBuffer())
      console.log(`[audio-job:${jobId}] SV chunk done in ${((Date.now() - chunkStart) / 1000).toFixed(1)}s`)
      return buf
    }
    if (status.status === 'FAILED') {
      throw new Error(`SecretVoicer FAILED: ${status.error_message ?? 'unknown'}`)
    }
    // PENDING / LOCAL_PROCESSING → continue polling
  }
  throw new Error(`SecretVoicer: timeout after ${SV_CHUNK_TIMEOUT_MS / 1000}s`)
}

// Submit one text chunk to Voicer; poll until completed.
// Returns Buffer (MP3). Throws on failure, timeout, or content-block.
async function synthesizeVoicerChunk(text, voiceId, settings, jobId) {
  const apiKey     = env('VOICER_API_KEY')
  const authHeader = `Bearer ${apiKey}`
  const chunkStart = Date.now()

  const res = await fetch(`${VOICER_BASE}/voice/synthesize`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice_id:         voiceId,
      model_id:         'eleven_turbo_v2_5',
      split_type:       'smart',
      max_chunk_length: 2500,
      voice_settings: {
        stability:        settings.stability,
        similarity_boost: settings.similarity,
        style:            settings.style,
        speed:            Math.min(1.2, Math.max(0.7, settings.speechRate ?? 1.0)),
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Voicer HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  const j = await res.json()
  const taskId = j.task_id
  if (!taskId) throw new Error('Voicer: no task_id in response')

  const POLL_MS = 2500
  const deadline = Date.now() + VOICER_CHUNK_TIMEOUT_MS
  let ticks = 0

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    ticks++
    if (ticks % 12 === 0) await heartbeatAudioJob(jobId)
    let status
    try {
      const pollRes = await fetch(`${VOICER_BASE}/voice/status/${taskId}`, {
        headers: { Authorization: authHeader },
      })
      if (!pollRes.ok) continue
      status = await pollRes.json()
    } catch {
      continue
    }
    if (status.status === 'completed') {
      if (!status.download_url) throw new Error('Voicer: completed but no download_url')
      const dlRes = await fetch(`${VOICER_DOMAIN}${status.download_url}`, {
        headers: { Authorization: authHeader },
      })
      if (!dlRes.ok) throw new Error(`Voicer download HTTP ${dlRes.status}`)
      const buf = Buffer.from(await dlRes.arrayBuffer())
      console.log(`[audio-job:${jobId}] Voicer chunk done in ${((Date.now() - chunkStart) / 1000).toFixed(1)}s`)
      return buf
    }
    if (status.status === 'failed') {
      throw new Error(`Voicer FAILED: ${status.error_message ?? 'unknown'}`)
    }
    if (status.status === 'censored') {
      throw new Error(`Voicer CENSORED: ${status.error_message ?? 'content blocked by ElevenLabs filter'}`)
    }
    // pending / processing → continue polling
  }
  throw new Error(`Voicer: timeout after ${VOICER_CHUNK_TIMEOUT_MS / 1000}s`)
}

// ── Async audio worker ────────────────────────────────────────────────────────

// Map voice_style string labels to numeric style exaggeration (ElevenLabs scale 0–1).
const STYLE_EXAGGERATION_MAP = {
  neutral: 0, conversational: 0.2, documentary: 0.3, emotional: 0.8,
}

// Process one audio_jobs record: download text → split → synthesize → concat → upload → update DB.
// Mirrors synchronous audio/route.ts, but runs as a long-lived background task on Railway.
// Writes ONLY the result to projects (audio_url + status).
// Inputs (voice_id, script, status:'generating_audio') are written by the Vercel dispatch Lambda.
async function processAudioJob(job) {
  const jobId = job.id
  const t0Job = Date.now()
  console.log(`[audio-job:${jobId}] start engine=${job.engine} project=${job.project_id}`)

  try {
    // 1. Mark job as in-progress
    await updateAudioJob(jobId, { status: 'processing' })

    // 2. Download text from URL stored by the Vercel dispatch endpoint
    const textRes = await fetch(job.text_url, { signal: AbortSignal.timeout(30_000) })
    if (!textRes.ok) throw new Error(`text download HTTP ${textRes.status}`)
    const text = await textRes.text()
    if (!text.trim()) throw new Error('downloaded text is empty')
    console.log(`[audio-job:${jobId}] text: ${text.length} chars`)

    // 3. Strip scene/section markers so TTS doesn't pronounce them literally.
    //    own_script normalization (Haiku) skipped on first iteration — text used as-is.
    const ttsText = text
      .replace(/\[(?:Сцена|Scene|Секция|Section)\s+\d+[^\]]*\]\s*/gi, '')
      .replace(/\[\s*(?:\.{2,}|…+)\s*\]\s*/g, '')
      // Bare heading lines: «Сцена 1:», «Глава 3.», «Part 2 — Title», «СЦЕНА 4», etc.
      // Short tail (≤60 chars) → delete whole line; long tail → strip prefix, keep content.
      // [ \t]* (not \s*) prevents consuming the newline into the captured tail.
      .replace(
        /^(?:Сцена|Секция|Глава|Часть|Scene|Section|Chapter|Part)[ \t]+\d+[ \t]*[:.\-–—]?[ \t]*(.*)$/gim,
        (_, tail) => (tail.trim().length <= 60 ? '' : tail.trim()),
      )
      .replace(/^#{1,6}\s+.+$/gm, '')
      .replace(/^(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    // 4. Split into per-engine chunks
    const { maxChars, measureBytes } = TTS_CHUNK_LIMITS[job.engine] ?? TTS_CHUNK_LIMITS.secretvoicer
    const chunks = splitTextIntoChunks(ttsText, maxChars, measureBytes)
    console.log(`[audio-job:${jobId}] ${chunks.length} chunk(s) for ${ttsText.length} chars`)

    // 5. Resolve voice settings (job fields mirror audio/route.ts request body)
    const voiceStyle = typeof job.voice_style === 'number'
      ? job.voice_style
      : (STYLE_EXAGGERATION_MAP[job.voice_style] ?? 0)
    const settings = {
      stability:  job.stability        ?? 0.5,
      similarity: job.similarity_boost ?? 0.75,
      style:      voiceStyle,
      speechRate: job.speech_rate      ?? 1.0,
    }

    // 6. Select synthesizer.
    //    SecretVoicer: 1 retry per chunk (mirrors Vercel caller pattern).
    //    Voicer: no retry — Voicer queues are stable; timeout is the safety net.
    //    Sync-only engines (ElevenLabs/OpenAI/Google/APIHOST) must not reach here.
    let synthesizeFn
    if (job.engine === 'secretvoicer') {
      synthesizeFn = async (chunk, idx) => {
        for (let attempt = 0; attempt <= 1; attempt++) {
          try {
            return await synthesizeSecretVoicerChunk(chunk, job.voice_id, settings, jobId)
          } catch (e) {
            if (attempt === 1) throw e
            console.warn(`[audio-job:${jobId}] SV chunk ${idx + 1}/${chunks.length} retry:`, e.message)
          }
        }
      }
    } else if (job.engine === 'voicer') {
      synthesizeFn = (chunk) => synthesizeVoicerChunk(chunk, job.voice_id, settings, jobId)
    } else {
      throw new Error(`engine '${job.engine}' is sync-only and must run on Vercel Lambda, not the async worker`)
    }

    // 7. Synthesize all chunks in parallel (max 4 concurrent), order preserved by runLimited
    let doneChunks = 0
    const tasks = chunks.map((chunk, idx) => async () => {
      console.log(`[audio-job:${jobId}] chunk ${idx + 1}/${chunks.length} start`)
      const t0 = Date.now()
      const buf = await synthesizeFn(chunk, idx)
      doneChunks++
      console.log(`[audio-job:${jobId}] chunk ${idx + 1}/${chunks.length} done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${buf.byteLength} B)`)
      if (chunks.length > 1) {
        const pct = Math.round(doneChunks / chunks.length * 100)
        await updateAudioJob(jobId, { progress: pct })
      }
      return buf
    })
    const buffers = await runLimited(tasks, 4)

    // 8. Concat in memory — first chunk keeps ID3 header, rest stripped to prevent PTS drift
    let finalBuffer = Buffer.concat(buffers.map((b, i) => i === 0 ? b : stripId3Tag(b)))
    console.log(`[audio-job:${jobId}] concat: ${(finalBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`)
    if (finalBuffer.byteLength === 0) throw new Error('empty audio buffer after synthesis')

    // 8a. Re-encode multi-chunk MP3 so the Xing/Info header covers the full file.
    //     Without this, chunk 1's stale TOC causes browser seeks to land at wrong
    //     byte offsets for any position past the first chunk boundary.
    //     Single-chunk synthesis skips this (no concat = no stale TOC).
    if (buffers.length > 1) {
      try {
        const repaired = await repairMp3Buffer(finalBuffer)
        console.log(`[audio-job:${jobId}] xing-repair: ${(repaired.byteLength / 1024 / 1024).toFixed(2)} MB`)
        finalBuffer = repaired
      } catch (repairErr) {
        console.error(`[audio-job:${jobId}] xing-repair failed, uploading raw concat:`, repairErr.message)
        Sentry.captureException(repairErr, { extra: { jobId, engine: job.engine } })
      }
    }

    // 9. Upload to B2 (no per-file size limit; Supabase Free capped at 50 MB → 413 for >53 min)
    let publicUrl
    try {
      publicUrl = await uploadBytesToB2(
        finalBuffer,
        `audio/${job.user_id}/${job.project_id}/audio.mp3`,
        'audio/mpeg',
        'public, max-age=31536000',
      )
    } catch (uploadErr) {
      console.error(`[audio-job:${jobId}] upload failed (${(finalBuffer.byteLength / 1024 / 1024).toFixed(2)} MB):`, uploadErr.message)
      throw new Error('Не удалось сохранить озвучку. Попробуйте ещё раз.')
    }
    console.log(`[audio-job:${jobId}] uploaded: ${publicUrl.slice(0, 100)}`)

    // 10. Mark audio_jobs completed (client polls this for real-time status)
    await updateAudioJob(jobId, {
      status:       'completed',
      result_url:   publicUrl,
      completed_at: new Date().toISOString(),
    })

    if (Date.now() - t0Job > 90_000) {
      notifyUserJobDone(job.user_id, 'audio').catch(() => {})
    }

    // 11. Update projects with RESULT ONLY — mirrors synchronous audio/route.ts status transition.
    //     voice_id and script are written by the Vercel dispatch Lambda (inputs, not results).
    //     Non-fatal: audio_jobs.result_url is the source of truth; projects drives the UI chain.
    try {
      // tool_run projects (TTS tool) stop at 'completed'; studio projects continue to subtitles
      let completionStatus = 'generating_subtitles'
      try {
        const rows = await sbGet('projects', `id=eq.${job.project_id}&select=type`)
        if (Array.isArray(rows) && rows[0]?.type === 'tool_run') completionStatus = 'completed'
      } catch (typeErr) {
        console.warn(`[audio-job:${jobId}] project type fetch failed (using default):`, typeErr.message)
      }
      await sbPatch(
        'projects',
        `id=eq.${job.project_id}&user_id=eq.${job.user_id}`,
        {
          audio_url: publicUrl,
          status:    completionStatus,
        }
      )
      console.log(`[audio-job:${jobId}] projects.audio_url written, status=${completionStatus}`)
    } catch (projErr) {
      console.warn(`[audio-job:${jobId}] projects update non-fatal:`, projErr.message)
      Sentry.captureException(projErr, { extra: { jobId, project_id: job.project_id, stage: 'projects_audio_url' } })
    }

    console.log(`[audio-job:${jobId}] DONE`)

  } catch (err) {
    const msg = err.message ?? String(err)
    console.error(`[audio-job:${jobId}] FAILED:`, msg)
    Sentry.captureException(err, { extra: { jobId, engine: job.engine, project_id: job.project_id } })
    await updateAudioJob(jobId, { status: 'failed', error: msg })
    const audioRefund = await refundAudioJobCredits(jobId, job.user_id, job.project_id)
    if (!audioRefund.ok && audioRefund.amount > 0) {
      await recordRefundIncident(jobId, job.user_id, audioRefund.amount, 'audio', audioRefund.error)
    }
    // Mark project as failed so client polling can detect it (otherwise status stays 'generating_audio' forever)
    if (job.project_id) {
      await sbPatch('projects', `id=eq.${job.project_id}&user_id=eq.${job.user_id}`, { status: 'failed' })
        .catch((projErr) => console.warn(`[audio-job:${jobId}] project failed-update error:`, projErr.message))
    }
    // Detect billing exhaustion for ElevenLabs-based resellers (SecretVoicer / Voicer).
    // SecretVoicer: HTTP 402 → "SecretVoicer HTTP 402: ..." | FAILED status.error_message may include "quota"/"balance".
    // Voicer: same patterns. Unknown reseller strings will miss here; Sentry captures full err above.
    if (job.engine === 'secretvoicer' || job.engine === 'voicer') {
      if (/HTTP 402|quota|balance|credit|insufficient|payment required/i.test(msg)) {
        const svcName = job.engine === 'secretvoicer' ? 'SecretVoicer' : 'Voicer'
        await notifyBillingErrorRailway(svcName, `/audio-job:${jobId}`).catch(() => {})
      }
    }
    if (Date.now() - t0Job > 90_000) {
      notifyUserJobDone(job.user_id, 'audio_failed').catch(() => {})
    }
  }
}

// ── SIGTERM: annotate active render jobs before process exit ──────────────────
// Writes error_message only — status stays 'processing'; startup-recovery on the
// next container boot will mark the job failed and refund credits.
process.on('SIGTERM', () => {
  console.log(`[SIGTERM] received — annotating ${renderActiveJobs.size} active render job(s)`)
  const updates = []
  for (const [jId, info] of renderActiveJobs) {
    const detail = info.clipsDone != null
      ? `, clips: ${info.clipsDone}/${info.totalClips}`
      : ''
    const msg = `SIGTERM mid-render, phase: ${info.phase}${detail}`
    console.log(`[SIGTERM] job ${jId.slice(0, 8)}: ${msg}`)
    updates.push(updateJob(jId, { error_message: msg }).catch(() => {}))
  }
  Promise.allSettled(updates).finally(() => {
    console.log('[SIGTERM] annotation done, exiting')
    process.exit(0)
  })
})

// ── Startup recovery: mark jobs orphaned by previous container crash as failed ─
// Safe because at startup time this process owns zero running renders — any job
// still in 'processing' must have been abandoned by the previous container.
async function recoverOrphanedJobs() {
  try {
    const orphans = await sbGet('video_jobs',
      'status=eq.processing&select=id,user_id,project_id,phase,credits_charged,credits_refunded_at')
    if (!orphans.length) { console.log('[startup/recovery] no orphaned jobs'); return }
    console.log(`[startup/recovery] found ${orphans.length} orphaned job(s)`)
    for (const job of (Array.isArray(orphans) ? orphans : [])) {
      const phaseStr = job.phase ? ` (phase: ${job.phase})` : ''
      console.log(`[startup/recovery] orphan ${job.id.slice(0, 8)} project:${(job.project_id ?? '?').slice(0, 8)}${phaseStr}`)
      await updateJob(job.id, {
        status: 'failed',
        error_message: `orphaned by container restart${phaseStr}`,
      })
      if (job.project_id) {
        await sbPatch('projects', `id=eq.${job.project_id}&status=eq.generating_video`, { status: 'failed' })
          .catch(e => console.warn('[startup/recovery] project patch:', e.message))
      }
      const startupVideoRefund = await refundVideoJobCredits(job.id, job.user_id, job.project_id)
      if (!startupVideoRefund.ok && startupVideoRefund.amount > 0) {
        await recordRefundIncident(job.id, job.user_id, startupVideoRefund.amount, 'video', startupVideoRefund.error)
      }
      if (OWNER_ID) {
        const refundNote = startupVideoRefund.amount > 0
          ? (startupVideoRefund.ok ? `, ${startupVideoRefund.amount} кр. возвращены` : `, возврат ${startupVideoRefund.amount} кр. — СБОЙ`)
          : ''
        await tgApi('sendMessage', {
          chat_id: OWNER_ID,
          text: `🔴 Startup recovery\njob ${job.id.slice(0, 8)}${phaseStr} → failed${refundNote}\nproject: ${(job.project_id ?? '?').slice(0, 8)}`,
        }).catch(e => console.warn('[startup/recovery] tg:', e.message))
      }
    }
  } catch (e) {
    console.error('[startup/recovery] failed:', e.message)
    Sentry.captureException(e, { extra: { fn: 'recoverOrphanedJobs' } })
  }
}

// ── Startup recovery: audio_jobs stuck in pending/processing (> 15 min) ────────
// audio_jobs have no SIGTERM handler. Any job still running at boot must have been
// abandoned. Mark failed, refund credits, update project status.
async function recoverOrphanedAudioJobs() {
  try {
    const staleIso = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const orphans = await sbGet('audio_jobs',
      `or=(status.eq.pending,status.eq.processing)&created_at=lt.${staleIso}&select=id,user_id,project_id,credits_charged,credits_refunded_at`)
    if (!Array.isArray(orphans) || !orphans.length) {
      console.log('[startup/audio-recovery] no stale audio jobs')
      return
    }
    console.log(`[startup/audio-recovery] found ${orphans.length} stale audio job(s)`)
    for (const job of orphans) {
      console.log(`[startup/audio-recovery] stale audio_job ${job.id.slice(0, 8)} project:${(job.project_id ?? '?').slice(0, 8)}`)
      await updateAudioJob(job.id, { status: 'failed', error: 'Container restart — job abandoned' })
      if (job.project_id) {
        await sbPatch('projects', `id=eq.${job.project_id}&user_id=eq.${job.user_id}`, { status: 'failed' })
          .catch(e => console.warn(`[startup/audio-recovery] project patch:`, e.message))
      }
      const startupAudioRefund = await refundAudioJobCredits(job.id, job.user_id, job.project_id)
      if (!startupAudioRefund.ok && startupAudioRefund.amount > 0) {
        await recordRefundIncident(job.id, job.user_id, startupAudioRefund.amount, 'audio', startupAudioRefund.error)
      }
    }
  } catch (e) {
    console.error('[startup/audio-recovery] failed:', e.message)
    Sentry.captureException(e, { extra: { fn: 'recoverOrphanedAudioJobs' } })
  }
}

async function recoverOrphanedImageJobs() {
  try {
    const staleIso = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const orphans = await sbGet('image_jobs',
      `or=(status.eq.pending,status.eq.processing)&created_at=lt.${staleIso}&select=id,user_id,project_id,credits_charged,credits_refunded_at`)
    if (!Array.isArray(orphans) || !orphans.length) {
      console.log('[startup/image-recovery] no stale image jobs')
      return
    }
    console.log(`[startup/image-recovery] found ${orphans.length} stale image job(s)`)
    for (const job of orphans) {
      console.log(`[startup/image-recovery] stale image_job ${job.id.slice(0, 8)} project:${(job.project_id ?? '?').slice(0, 8)}`)
      await updateImageJob(job.id, { status: 'failed', error_message: 'Container restart — job abandoned' })
      if (job.project_id) {
        await sbPatch('projects', `id=eq.${job.project_id}&status=eq.generating_images`, { status: 'failed' })
          .catch(e => console.warn(`[startup/image-recovery] project patch:`, e.message))
      }
      const startupImageRefund = await refundImageJobCredits(job.id, job.user_id, job.project_id)
      if (!startupImageRefund.ok && startupImageRefund.amount > 0) {
        await recordRefundIncident(job.id, job.user_id, startupImageRefund.amount, 'image', startupImageRefund.error)
      }
    }
  } catch (e) {
    console.error('[startup/image-recovery] failed:', e.message)
    Sentry.captureException(e, { extra: { fn: 'recoverOrphanedImageJobs' } })
  }
}

// Must be added AFTER all routes
Sentry.setupExpressErrorHandler(app)

const PORT = parseInt(env('PORT') || '3001', 10)
app.listen(PORT, async () => {
  console.log(`ytgen-video-server on :${PORT}`)
  await loadSettingsFromDB().catch(err => console.warn('[bot] settings load failed:', err.message))
  // Sync plan credit counts from Vercel /api/plans (single source of truth = src/lib/types.ts).
  // Fallback values in PAY_PLANS above are used if Vercel is unreachable.
  // First attempt is silent (alertOnFail=false): Vercel may still be deploying the same push.
  // One-time 5-min retry fires with alertOnFail=true → Sentry only if Vercel is genuinely down.
  await refreshPlansFromVercel(false).catch(console.warn)
  setTimeout(() => refreshPlansFromVercel(true).catch(console.warn), 5 * 60 * 1000)
  setInterval(() => refreshPlansFromVercel(true).catch(console.warn), 60 * 60 * 1000)
  await recoverOrphanedJobs()
  await recoverOrphanedAudioJobs()
  await recoverOrphanedImageJobs()
  // Write thresholds to bot_settings so the Vercel admin panel can read them
  await Promise.all([
    setSetting('fal_balance_threshold',        String(FAL_BALANCE_THRESHOLD)),
    setSetting('elevenlabs_chars_threshold',   String(ELEVENLABS_CHARS_ALERT_THRESHOLD)),
    setSetting('apihost_balance_threshold',    String(APIHOST_BALANCE_ALERT_THRESHOLD)),
  ]).catch(err => console.warn('[startup] threshold write failed:', err.message))
  console.log('[bot] starting cron jobs...')

  console.log('[boot] OWNER_ID:', OWNER_ID || '(not set)')
  console.log(`[boot] build: source=${BUILD_COMMIT ? 'github' : 'manual-upload'} commit=${BUILD_COMMIT ?? 'n/a'} deployed_at=${BUILD_TS ?? 'n/a'} started_at=${STARTED_AT}`)
  if (OWNER_ID) {
    tgApi('sendMessage', { chat_id: OWNER_ID, text: '🟢 Бот перезапущен' })
      .then(r => console.log('[boot] owner notified ok, tg response ok:', r?.ok))
      .catch(e => console.log('[boot] owner notify FAILED:', e.message))
  }

  registerWebhook().catch(console.error)
})
// rebuild trigger
