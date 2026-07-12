'use strict'

// Sentry must be initialized before all other requires
let Sentry
try {
  const SentryPkg = require('@sentry/node')
  SentryPkg.init({
    dsn: process.env.SENTRY_DSN || '',
    tracesSampleRate: 0,
    defaultIntegrations: false,
    integrations: [],
    debug: false,
  })
  console.log('[sentry] initialized, DSN present:', !!process.env.SENTRY_DSN)
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

const API_SECRET            = process.env.RAILWAY_API_SECRET
const SUPABASE_URL          = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

const VGF_API_KEY = process.env.VGF_API_KEY

// Max parallel clip-encode submissions to VGF. Too high causes 504s on VGF's edge proxy.
const VGF_CLIP_CONCURRENCY = 12
// Retry count for transient HTTP 5xx errors on VGF submit (not job execution).
const VGF_SUBMIT_RETRIES = 3

const VERCEL_TOKEN = process.env.VERCEL_TOKEN

// ── Russia payment config ─────────────────────────────────────────────────────
const CARD_NUMBER = process.env.CARD_NUMBER || '0000 0000 0000 0000'
const CARD_HOLDER = process.env.CARD_HOLDER || 'IVAN IVANOV'
const USDT_TRC20  = process.env.USDT_TRC20  || 'TW6Z6iZECebHe764YCKAsv5MfVFG6G947L'
const USDT_ERC20  = process.env.USDT_ERC20  || '0x0f8d57d74367c4379b809399b1205f587f46104a'
const APP_URL     = process.env.APP_URL     || 'https://lefiro.co'

// ── Telegram config ───────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID
const OWNER_ID = String(process.env.TELEGRAM_OWNER_ID || '')
const SERVER_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'https://ytgen-video-server-production.up.railway.app'

// ── Media retention policy ────────────────────────────────────────────────────
// Edit thresholds here; logic reads from this object only.
const RETENTION_DAYS = {
  free: { abandoned: 1, completed: 2 },
  paid: { abandoned: 3, completed: 5 },
}
function retentionTier(plan) { return plan === 'free' ? 'free' : 'paid' }

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
    await sbPatch('video_jobs', `id=eq.${jobId}`, data)
  } catch (e) {
    console.error(`[job:${jobId}] updateJob failed:`, e.message)
    Sentry.captureException(e, { extra: { jobId, data } })
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

const PAY_PLANS = {
  basic:        { name: 'Basic',       price: '$9',  usd: 9,   credits: 800  },
  starter:      { name: 'Starter',     price: '$19', usd: 19,  credits: 2000 },
  pro:          { name: 'Pro',         price: '$39', usd: 39,  credits: 5000 },
  agency:       { name: 'Agency',      price: '$99', usd: 99,  credits: 15000 },
  topup_500:    { name: '500 кредитов',  price: '$7',  usd: 7,   credits: 500  },
  topup_2000:   { name: '2000 кредитов', price: '$26', usd: 26,  credits: 2000 },
  topup_5000:   { name: '5000 кредитов', price: '$60', usd: 60,  credits: 5000 },
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

function previewInline() {
  return {
    inline_keyboard: [[
      { text: '✅ Опубликовать',   callback_data: 'publish' },
      { text: '❌ Отклонить',      callback_data: 'decline' },
      { text: '🔄 Перегенерировать', callback_data: 'regen' },
    ]],
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
        { text: '✅ Опубликовать',    callback_data: 'mon_pub' },
        { text: '❌ Пропустить',      callback_data: 'mon_skip' },
      ],
      [
        { text: '✏️ Редактировать',   callback_data: 'mon_edit' },
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
        { text: 'Basic $9',    callback_data: 'pay_plan_basic' },
        { text: 'Starter $19', callback_data: 'pay_plan_starter' },
      ],
      [
        { text: 'Pro $39',     callback_data: 'pay_plan_pro' },
        { text: 'Agency $99',  callback_data: 'pay_plan_agency' },
      ],
      [
        { text: 'Топап 500 кр $7',   callback_data: 'pay_plan_topup_500' },
        { text: 'Топап 2000 кр $26', callback_data: 'pay_plan_topup_2000' },
        { text: 'Топап 5000 кр $60', callback_data: 'pay_plan_topup_5000' },
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

// Send to owner with main keyboard always attached
async function sendTo(chatId, text, extra = {}) {
  return tgApi('sendMessage', {
    chat_id: chatId, text, parse_mode: 'Markdown',
    reply_markup: MAIN_KB,
    ...extra,
  })
}

async function publishToChannel(text, imageUrl = null) {
  if (imageUrl) {
    console.log('[tg] downloading image buffer...')
    const buf = await fetchImageBuffer(imageUrl)
    if (buf) {
      console.log('[tg] sending photo to channel, size:', buf.length)
      return tgSendPhoto(CHANNEL_ID, buf, text)
    }
    console.warn('[tg] image download failed, sending text only')
  }
  return tgApi('sendMessage', { chat_id: CHANNEL_ID, text, parse_mode: 'Markdown' })
}

// ── Russia payment helpers ────────────────────────────────────────────────────
function cardPaymentText(planInfo, rubAmount) {
  const rubLine = rubAmount ? `Переведи: *${rubAmount} ₽*\n` : `Переведи сумму на карту:\n`
  return (
    `💳 *Оплата картой МИР*\n\n` +
    `Тариф: *${planInfo.name}* — ${planInfo.price}${rubAmount ? ` (~${rubAmount} ₽)` : ''}\n` +
    rubLine +
    `🏦 Номер карты: \`${CARD_NUMBER}\`\n` +
    `👤 Получатель: ${CARD_HOLDER}\n\n` +
    `После оплаты отправь сюда:\n` +
    `1. Скриншот перевода\n` +
    `2. Свой email в Lefiro\n\n` +
    `Активируем в течение 1 часа ✅`
  )
}

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
          { text: '✅ Активировать тариф', callback_data: `activate_${pst.plan}_${userChatId}` },
        ]],
      },
    })
  }
  await tgApi('sendMessage', { chat_id: userChatId, text: '✅ Получено! Мы активируем тариф в течение 1 часа.' })
}

async function activateUserPlan(email, plan) {
  const res = await fetch(`${APP_URL}/api/admin/users/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-secret': process.env.RAILWAY_API_SECRET || '' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), plan }),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error || 'Ошибка активации')
  return json
}

// ── Claude helpers ────────────────────────────────────────────────────────────
function claude() { return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) }

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
        '- Можно использовать Markdown для форматирования',
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
  const FAL_KEY = process.env.FAL_KEY
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
    inline_keyboard: [[
      { text: '✅ Опубликовать', callback_data: 'dep_pub' },
      { text: '❌ Отклонить',   callback_data: 'dep_skip' },
    ]],
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
  await publishToChannel(text)
  if (toOwner) await sendTo(toOwner, '✅ Статистика опубликована в канал')
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
    await publishToChannel(post, imageUrl)
    await sendTo(chatId, '✅ Опубликовано в канал (автопубликация)')
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

  if (data === 'pay_card' || data === 'pay_crypto') {
    const method = data === 'pay_card' ? 'card' : 'crypto'
    const pst    = payStates.get(String(chatId)) || {}

    // Deep-link flow: plan already known — show details immediately
    if (pst.step === 'method_for_plan' && pst.plan) {
      const planInfo = PAY_PLANS[pst.plan]
      if (planInfo) {
        payStates.set(String(chatId), { ...pst, step: 'awaiting_proof', method })
        await tgApi('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
        const rate      = await getUsdToRub()
        const rubAmount = planInfo.usd ? Math.ceil(planInfo.usd * rate) : null
        const detailsText = method === 'card' ? cardPaymentText(planInfo, rubAmount) : cryptoPaymentText(planInfo)
        await tgApi('sendMessage', { chat_id: chatId, text: detailsText, parse_mode: 'Markdown', reply_markup: payBackInline() })
        await notifyOwnerNewPayment(chatId, username || pst.username, firstName || pst.firstName, method, planInfo, rubAmount)
        return
      }
    }

    // Regular flow: ask for plan
    payStates.set(String(chatId), { step: 'plan', method, username, firstName })
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

    const pst    = payStates.get(String(chatId)) || {}
    const method = pst.method || 'card'
    payStates.set(String(chatId), { ...pst, step: 'awaiting_proof', plan, method })

    await tgApi('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })

    const rate      = await getUsdToRub()
    const rubAmount = planInfo.usd ? Math.ceil(planInfo.usd * rate) : null
    const detailsText = method === 'card' ? cardPaymentText(planInfo, rubAmount) : cryptoPaymentText(planInfo)
    await tgApi('sendMessage', { chat_id: chatId, text: detailsText, parse_mode: 'Markdown', reply_markup: payBackInline() })

    await notifyOwnerNewPayment(chatId, username || pst.username, firstName || pst.firstName, method, planInfo, rubAmount)
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

  if (data === 'publish') {
    const post = await ensurePendingPost()
    if (!post) { await sendTo(chatId, 'Нет поста на одобрении'); return }
    await publishToChannel(post.text, post.imageUrl)
    await clearPendingPost()
    await clearButtons()
    await sendTo(chatId, '✅ Опубликовано в канал')

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

  } else if (data === 'dep_pub') {
    if (!pendingDeployPost) { await sendTo(chatId, 'Нет поста на одобрении'); return }
    await publishToChannel(pendingDeployPost.text)
    pendingDeployPost = null
    await clearButtons()
    await sendTo(chatId, '✅ Пост об обновлении опубликован')

  } else if (data === 'dep_skip') {
    pendingDeployPost = null
    await clearButtons()
    await sendTo(chatId, '⏭ Пост об обновлении пропущен')

  } else if (data === 'mon_pub') {
    if (!pendingMonitorPost) { await sendTo(chatId, 'Нет поста на одобрении'); return }
    await publishToChannel(pendingMonitorPost.post)
    pendingMonitorPost = null
    await clearButtons()
    await sendTo(chatId, '✅ Опубликовано в канал')

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

  } else if (data.startsWith('activate_')) {
    const parts      = data.split('_')
    const plan       = parts[1]
    const userChatId = parts[2]
    const planInfo   = PAY_PLANS[plan]
    if (!planInfo) return
    awaitingActivate = { userChatId, plan, planInfo }
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

  const userId = String(message.from?.id ?? '')
  const chatId = message.chat?.id
  const text   = (message.text ?? '').trim()

  // ── Public users ──────────────────────────────────────────────────────────
  if (userId !== OWNER_ID) {
    const isCommand = text.startsWith('/')

    // ── Support: waiting for description ────────────────────────────────────
    const sst = supportStates.get(String(chatId))
    console.log('[support] state lookup for chatId:', chatId, '→', sst ? `step=${sst.step}` : 'no state')
    if (sst?.step === 'waiting_description' && !isCommand && text) {
      console.log('[support] description received from userId:', userId, 'chatId:', chatId)
      console.log('[support] category:', sst.category)
      console.log('[support] sending to owner:', process.env.TELEGRAM_OWNER_ID)

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
    if (pst?.step === 'awaiting_proof' && !isCommand && (message.photo || message.document || message.text)) {
      await forwardProofToOwner(chatId, message, pst).catch(err => {
        console.error('[pay] forwardProof error:', err.message)
        tgApi('sendMessage', { chat_id: chatId, text: '✅ Получено! Ожидай активации в течение 1 часа.' })
      })
      return
    }

    // ── /start router ───────────────────────────────────────────────────────
    if (text === '/start' || text.startsWith('/start ') || text === '/pay') {
      payStates.delete(String(chatId))
      supportStates.delete(String(chatId))
      const startArg  = text.startsWith('/start ') ? text.slice(7).trim() : ''
      const username  = message.from?.username
      const firstName = message.from?.first_name

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
              `📦 Тариф: *${planInfo.name}* — ${planInfo.credits} кредитов\n` +
              `💰 Стоимость: *${planInfo.price}*${rubNote}\n\n` +
              `Выбери способ оплаты:`,
            parse_mode: 'Markdown',
            reply_markup: payMethodInline(),
          })
          return
        }
      }

      // Default /start — payment menu
      payStates.set(String(chatId), { step: 'method', username, firstName })
      await tgApi('sendMessage', {
        chat_id: chatId,
        text: '👋 Привет! Для оплаты Lefiro из России\nвыбери удобный способ:',
        parse_mode: 'Markdown',
        reply_markup: payMethodInline(),
      })
      return
    }

    await tgApi('sendMessage', { chat_id: chatId, text: 'Используй /start для оплаты или обращения в поддержку.' })
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
    const { userChatId, plan, planInfo } = awaitingActivate
    awaitingActivate = null
    const email = text.trim()
    await sendTo(chatId, `⏳ Активирую тариф *${planInfo.name}* для \`${email}\`...`)
    try {
      await activateUserPlan(email, plan)
      await sendTo(chatId, `✅ Тариф *${planInfo.name}* активирован для *${email}*`)
      await tgApi('sendMessage', {
        chat_id: userChatId,
        text:
          `🎉 *Тариф активирован!*\n\n` +
          `Тариф *${planInfo.name}* успешно активирован на вашем аккаунте.\n\n` +
          `Войдите в Lefiro: ${APP_URL}`,
        parse_mode: 'Markdown',
      })
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
          inline_keyboard: [[
            { text: '✅ Опубликовать', callback_data: 'mon_pub' },
            { text: '❌ Отмена',       callback_data: 'mon_skip' },
          ]],
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
        if (!awaitingTopic && !awaitingPlan && !awaitingTime && !awaitingEdit)
          await sendTo(chatId, 'Используй кнопки внизу или /help')
    }
  } catch (err) {
    console.error('[tg/webhook]', err.message)
    await sendTo(chatId, `❌ Ошибка: ${err.message.slice(0, 120)}`)
  }
})

// ── Database backup to B2 ────────────────────────────────────────────────────
// SigV4 helper for backup bucket operations (GET list / PUT upload / DELETE)
function b2BackupSign(method, key, queryString, contentType, bodyHash) {
  const endpoint = (process.env.B2_ENDPOINT || '').trim().replace(/\/$/, '')
  const region   = (process.env.B2_REGION   || 'us-east-005').trim()
  const bucket   = (process.env.B2_BACKUP_BUCKET || 'youtubegen-db-backups').trim()

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
  const backupKeyId  = process.env.B2_BACKUP_KEY_ID  || process.env.B2_KEY_ID
  const backupAppKey = process.env.B2_BACKUP_APPLICATION_KEY || process.env.B2_APPLICATION_KEY
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
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
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
  const endpoint = (process.env.B2_ENDPOINT || '').trim().replace(/\/$/, '')
  const region   = (process.env.B2_REGION   || 'us-east-005').trim()
  const bucket   = (process.env.B2_BUCKET   || '').trim()
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
  const sigKey   = hmac(hmac(hmac(hmac(`AWS4${process.env.B2_APPLICATION_KEY}`, dateStamp), region), service), 'aws4_request')
  const sig      = crypto.createHmac('sha256', sigKey).update(sts).digest('hex')
  return {
    fullUrl,
    headers: {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      'x-amz-content-sha256': bodyHash,
      'x-amz-date': amzDate,
      'Authorization': `AWS4-HMAC-SHA256 Credential=${process.env.B2_KEY_ID}/${credScope}, SignedHeaders=${signedHdrs}, Signature=${sig}`,
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
  return keys.map((key, i) => ({ key, size: sizes[i] || 0 }))
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
async function cleanupExpiredMedia() {
  const DRY_RUN = process.env.RETENTION_DRY_RUN !== 'false'
  const tag = DRY_RUN ? '[retention/dry]' : '[retention]'
  console.log(`${tag} pass start, dry=${DRY_RUN}`)

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
  const iso = (d) => new Date(now - d * 86400_000).toISOString()

  // 2A. Abandoned candidates: video_url IS NULL, not generating, older than free threshold
  let abandoned = []
  try {
    abandoned = await sbGet('projects',
      `select=id,user_id,created_at,status,profiles!inner(plan)` +
      `&video_url=is.null` +
      `&status=not.like.generating_*` +
      `&created_at=lt.${iso(RETENTION_DAYS.free.abandoned)}` +
      `&limit=500`
    )
  } catch (e) { console.error(`${tag} abandoned query:`, e.message) }

  // 2B. Completed candidates: video_url IS NOT NULL, older than free threshold
  //     Anchor: completed_at if set, otherwise updated_at (legacy rows)
  let completed = []
  try {
    const ageFilter = `or=(completed_at.lt.${iso(RETENTION_DAYS.free.completed)},and(completed_at.is.null,updated_at.lt.${iso(RETENTION_DAYS.free.completed)}))`
    completed = await sbGet('projects',
      `select=id,user_id,completed_at,updated_at,status,profiles!inner(plan)` +
      `&video_url=not.is.null` +
      `&${ageFilter}` +
      `&limit=500`
    )
  } catch (e) { console.error(`${tag} completed query:`, e.message) }

  // 3. Apply plan-specific thresholds and exclude active-job projects
  const candidates = []
  for (const p of abandoned) {
    if (activeProjectIds.has(p.id)) continue
    const plan = p.profiles?.plan ?? 'free'
    const tier = retentionTier(plan)
    const ageDays = (now - new Date(p.created_at).getTime()) / 86400_000
    if (ageDays >= RETENTION_DAYS[tier].abandoned) {
      candidates.push({ ...p, _category: 'abandoned', _ageDays: ageDays.toFixed(1), _tier: tier })
    }
  }
  for (const p of completed) {
    if (activeProjectIds.has(p.id)) continue
    const plan = p.profiles?.plan ?? 'free'
    const tier = retentionTier(plan)
    const anchor = p.completed_at ?? p.updated_at
    const ageDays = (now - new Date(anchor).getTime()) / 86400_000
    if (ageDays >= RETENTION_DAYS[tier].completed) {
      candidates.push({ ...p, _category: 'completed', _ageDays: ageDays.toFixed(1), _tier: tier })
    }
  }
  console.log(`${tag} ${candidates.length} candidate(s)`)

  // 4. Process each candidate
  let totalBytes = 0
  const counts = { abandoned: { free: 0, paid: 0 }, completed: { free: 0, paid: 0 } }

  for (const project of candidates) {
    const { id: pid, user_id: uid, _category: cat, _ageDays: age, _tier: tier } = project
    console.log(`${tag} project=${pid} cat=${cat} tier=${tier} age=${age}d`)
    let projectBytes = 0

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
    } catch (e) { console.error(`${tag} audio error ${pid}:`, e.message) }

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
    } catch (e) { console.error(`${tag} images error ${pid}:`, e.message) }

    // 4C. B2 main bucket (video + any per-project temp files)
    try {
      const b2Objects = await b2MediaListObjects(`users/${uid}/${pid}/`)
      if (b2Objects.length) {
        const b2Bytes = b2Objects.reduce((s, o) => s + o.size, 0)
        projectBytes += b2Bytes
        if (DRY_RUN) {
          console.log(`${tag} would delete B2: ${b2Objects.length} object(s), ${(b2Bytes / 1024 / 1024).toFixed(2)} MB`)
        } else {
          const keys = b2Objects.map(o => o.key)
          for (let i = 0; i < keys.length; i += 1000) {
            await b2MediaDeleteObjects(keys.slice(i, i + 1000))
          }
          console.log(`${tag} deleted B2: ${b2Objects.length} object(s)`)
        }
      }
    } catch (e) { console.error(`${tag} B2 error ${pid}:`, e.message) }

    // 4D. DB cleanup — delete project row + its video_jobs
    if (!DRY_RUN) {
      try {
        const hdrs = sbHeaders()
        await fetch(`${SUPABASE_URL}/rest/v1/video_jobs?project_id=eq.${pid}`, { method: 'DELETE', headers: hdrs })
        await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${pid}`, { method: 'DELETE', headers: hdrs })
        console.log(`${tag} deleted project row ${pid}`)
      } catch (e) { console.error(`${tag} DB delete ${pid}:`, e.message) }
    }

    totalBytes += projectBytes
    counts[cat][tier === 'free' ? 'free' : 'paid']++
  }

  // 5. Summary + Telegram alert
  const mbStr = (totalBytes / 1024 / 1024).toFixed(2)
  const actionPrefix = DRY_RUN ? '🔍 [DRY RUN] БЫЛО БЫ удалено' : '🗑 Удалено'
  const summary =
    `${actionPrefix}:\n` +
    `├ Брошенных: ${counts.abandoned.free} free + ${counts.abandoned.paid} paid\n` +
    `├ Завершённых: ${counts.completed.free} free + ${counts.completed.paid} paid\n` +
    `└ Итого: ${candidates.length} проектов, ~${mbStr} МБ`

  console.log(`${tag}`, summary.replace(/[├└─🔍🗑]/g, '').trim())

  if (OWNER_ID) {
    await tgApi('sendMessage', {
      chat_id: OWNER_ID,
      text: `📦 *Retention cleanup*\n\n\`\`\`\n${summary}\n\`\`\``,
      parse_mode: 'Markdown',
    }).catch(e => console.error(`${tag} tg alert failed:`, e.message))
  }
}

// ── fal.ai balance monitoring ─────────────────────────────────────────────────
const FAL_ADMIN_KEY = process.env.FAL_ADMIN_KEY || process.env.FAL_KEY || ''
const FAL_BALANCE_THRESHOLD = parseFloat(process.env.FAL_BALANCE_ALERT_THRESHOLD ?? '10')

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

// ── fal.ai balance check — every 30 minutes ───────────────────────────────────
cron.schedule('*/30 * * * *', async () => {
  console.log('[cron] fal.ai balance check')
  try { await checkFalBalance() } catch (err) { console.error('[cron/fal-balance]', err.message); Sentry.captureException(err, { extra: { cron: 'checkFalBalance' } }) }
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

// ── Watchdog: stuck projects / audio_jobs ─────────────────────────────────────
const WATCHDOG_DRY_RUN            = process.env.WATCHDOG_DRY_RUN !== 'false'
const WATCHDOG_IMAGES_TIMEOUT_MIN = parseInt(process.env.WATCHDOG_IMAGES_TIMEOUT_MIN || '15', 10)
const WATCHDOG_VIDEO_TIMEOUT_MIN  = parseInt(process.env.WATCHDOG_VIDEO_TIMEOUT_MIN  || '40', 10)
const WATCHDOG_AUDIO_TIMEOUT_MIN  = parseInt(process.env.WATCHDOG_AUDIO_TIMEOUT_MIN  || '20', 10)

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
      let needsVideoRefund = false
      if (!WATCHDOG_DRY_RUN) {
        await sbPatch('projects', `id=eq.${row.id}`, { status: 'failed' })
        try {
          const vJobs = await sbGet('video_jobs',
            `project_id=eq.${row.id}&status=in.(pending,processing)&select=id,user_id,credits_charged,credits_refunded_at`)
          for (const vj of (Array.isArray(vJobs) ? vJobs : [])) {
            needsVideoRefund = !!(vj.credits_charged > 0 && !vj.credits_refunded_at)
            creditsCharged = vj.credits_charged ?? 0
            await updateJob(vj.id, { status: 'failed', error_message: `watchdog: stuck in generating_video for ${ageMin} min` })
            await refundVideoJobCredits(vj.id, vj.user_id, row.id)
          }
        } catch (e) {
          console.warn(`${tag} video_jobs cleanup for project ${row.id}:`, e.message)
        }
      }
      resets.push({ type: 'video', id: row.id, ageMin, creditsCharged, needsVideoRefund })
    }
  } catch (e) { console.warn(`${tag} video query failed:`, e.message) }

  try {
    const rows = await sbGet('audio_jobs',
      `status=in.(pending,processing)&updated_at=lt.${cutoffAudio}&select=id,project_id,user_id,status,updated_at,credits_charged,credits_refunded_at`)
    for (const row of rows) {
      const ageMin = Math.round((now - new Date(row.updated_at).getTime()) / 60_000)
      console.log(`${tag} audio_job ${row.id} stuck in ${row.status} ${ageMin} min (project ${row.project_id})`)
      const needsRefund = !!(row.credits_charged > 0 && !row.credits_refunded_at)
      if (!WATCHDOG_DRY_RUN) {
        await updateAudioJob(row.id, { status: 'failed', error: `watchdog: stuck in '${row.status}' for ${ageMin} min` })
        if (row.project_id) await sbPatch('projects', `id=eq.${row.project_id}`, { status: 'failed' })
        try {
          await refundAudioJobCredits(row.id, row.user_id, row.project_id)
        } catch (e) {
          console.warn(`${tag} refund failed for ${row.id}: ${e.message}`)
        }
      }
      resets.push({ type: 'audio', id: row.id, project_id: row.project_id, jobStatus: row.status, ageMin, creditsCharged: row.credits_charged ?? 0, needsRefund })
    }
  } catch (e) { console.warn(`${tag} audio query failed:`, e.message) }

  if (resets.length === 0) { console.log(`${tag} clean`); return }

  if (!OWNER_ID) return
  const dryLabel = WATCHDOG_DRY_RUN ? ' [DRY RUN]' : ''
  if (resets.length <= 5) {
    for (const r of resets) {
      const emoji   = r.type === 'audio' ? '🔊' : r.type === 'video' ? '🎬' : '🖼'
      const subject = r.type === 'audio'
        ? `audio_job ${r.id.slice(0, 8)} (${r.jobStatus}, project ${(r.project_id ?? '?').slice(0, 8)})`
        : `project ${r.id.slice(0, 8)} (generating_${r.type})`
      const refundNote = r.type === 'audio'
        ? (r.needsRefund ? `, ${r.creditsCharged} кр. возвращены` : ', refund не потребовался')
        : r.type === 'video' && r.creditsCharged > 0
        ? (r.needsVideoRefund ? `, ${r.creditsCharged} кр. возвращены` : ', refund не потребовался')
        : ''
      const msg = `${emoji} Watchdog${dryLabel}\n${subject} stuck ${r.ageMin} min → reset to failed${refundNote}`
      await tgApi('sendMessage', { chat_id: OWNER_ID, text: msg })
        .catch(e => console.warn(`${tag} tg notify failed:`, e.message))
    }
  } else {
    const imgs   = resets.filter(r => r.type === 'images').length
    const vids   = resets.filter(r => r.type === 'video').length
    const audios = resets.filter(r => r.type === 'audio').length
    const lines  = [
      imgs   ? `🖼 generating_images: ${imgs}`  : '',
      vids   ? `🎬 generating_video: ${vids}`   : '',
      audios ? `🔊 audio_jobs: ${audios}`        : '',
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
      await publishToChannel(text)
      console.log('[vercel] deploy post auto-published')
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
// Three-attempt strategy to isolate TLS stack issues:
//   1. fetch / undici (Node built-in, different TLS negotiation from https.request)
//   2. curl (system libssl — completely independent of Node's bundled OpenSSL)
// SigV4 signing is shared; only the HTTP transport differs.
async function uploadVideoToR2(filePath, projectId, userId) {
  const stat = fs.statSync(filePath)
  const key = `users/${userId}/${projectId}/output.mp4`
  const fileSize = stat.size
  const bucket = (process.env.R2_BUCKET || '').trim()
  const endpoint = (process.env.R2_ENDPOINT || '').trim().replace(/\/$/, '')
  const publicBase = (process.env.R2_PUBLIC_URL || '').trim().replace(/\/$/, '')

  console.log(`[r2] node:${process.version} openssl:${process.versions.openssl}`)
  console.log(`[r2] endpoint: ${endpoint}  bucket: ${bucket}`)
  console.log(`[r2] uploading ${key} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`)

  const uploadUrl = `${endpoint}/${bucket}/${key}`
  const parsed = new URL(uploadUrl)
  const host = parsed.hostname
  const urlPath = parsed.pathname

  // AWS SigV4 — UNSIGNED-PAYLOAD allows streaming without body hash
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
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${process.env.R2_SECRET_ACCESS_KEY}`, dateStamp), region), service), 'aws4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${process.env.R2_ACCESS_KEY_ID}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const publicUrl = `${publicBase}/${key}`

  // ── Attempt 1: fetch / undici ──────────────────────────────────────────────
  console.log('[r2] attempt 1: fetch (undici)...')
  let fetchErr = null
  try {
    const buf = fs.readFileSync(filePath)
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
        'x-amz-date': amzDate,
        'Authorization': authorization,
      },
      body: buf,
    })
    if (res.ok) {
      console.log('[r2] uploaded via fetch:', publicUrl)
      return publicUrl
    }
    const errBody = await res.text().catch(() => '')
    fetchErr = new Error(`HTTP ${res.status}: ${errBody.slice(0, 300)}`)
    console.warn('[r2] fetch HTTP error:', fetchErr.message)
  } catch (err) {
    fetchErr = err
    console.warn('[r2] fetch failed:', err.message)
  }

  // ── Attempt 2: curl (system libssl, independent of Node's OpenSSL) ─────────
  console.log('[r2] attempt 2: curl...')
  const curlOut = await new Promise((resolve, reject) => {
    execFile('curl', [
      '-sS', '-o', '/dev/null', '-w', '%{http_code}',
      '--upload-file', filePath,
      '-H', `Content-Type: video/mp4`,
      '-H', `x-amz-content-sha256: UNSIGNED-PAYLOAD`,
      '-H', `x-amz-date: ${amzDate}`,
      '-H', `Authorization: ${authorization}`,
      uploadUrl,
    ], { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        return reject(new Error(`[r2-curl] ${err.message}: ${(stderr || '').slice(0, 200)}`))
      }
      resolve(stdout || '')
    })
  })

  const curlStatus = parseInt(curlOut.trim(), 10)
  if (curlStatus >= 200 && curlStatus < 300) {
    console.log('[r2] uploaded via curl:', publicUrl)
    return publicUrl
  }
  throw new Error(
    `[r2] all upload attempts failed. curl=${curlStatus}; fetch: ${fetchErr?.message ?? 'n/a'}`
  )
}

// Upload final video to Backblaze B2 (S3-compatible).
// R2 was replaced because Cloudflare R2 rejects TLS handshakes from Railway IPs at WAF level.
// Streams file to avoid loading large videos into RAM (OOM risk on Railway).
async function uploadVideoToB2(filePath, projectId, userId) {
  const key = `users/${userId}/${projectId}/output_${Date.now()}.mp4`
  const bucket = (process.env.B2_BUCKET || '').trim()
  const endpoint = (process.env.B2_ENDPOINT || '').trim().replace(/\/$/, '')
  const region = (process.env.B2_REGION || 'us-east-005').trim()
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

  // AWS SigV4 with actual body hash (B2 requires this, unlike R2 which accepted UNSIGNED-PAYLOAD)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp = amzDate.slice(0, 8)
  const service = 's3'
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`

  const canonicalHeaders =
    `content-type:video/mp4\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${bodyHash}\n` +
    `x-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = ['PUT', urlPath, '', canonicalHeaders, signedHeaders, bodyHash].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${process.env.B2_APPLICATION_KEY}`, dateStamp), region), service), 'aws4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${process.env.B2_KEY_ID}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
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

  const publicUrl = `${endpoint}/${bucket}/${key}`
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
function getVfFilter(_img, dur, sceneIdx, hasKenBurns) {
  if (!hasKenBurns) return VF_SCALE
  const d = Math.max(1, Math.round(dur * 25))
  if (sceneIdx % 2 === 0) {
    // Pattern A: zoom-in to center. z 1.0→1.5; at 4000px canvas: x varies by ~4.7px/frame→0.75 out-px/frame.
    return `scale=4000:2250:flags=lanczos,zoompan=z=1+0.5*on/duration:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=${d}:s=1280x720:fps=25,setsar=1`
  } else {
    // Pattern B: pan left→right + zoom. z 1.1→1.3; x 0→400px at 4000 canvas (=128 out-px).
    return `scale=4000:2250:flags=lanczos,zoompan=z=1.1+0.2*on/duration:x=iw*0.1*on/duration:y=ih/2-(ih/zoom/2):d=${d}:s=1280x720:fps=25,setsar=1`
  }
}

app.get('/health', (_req, res) => res.json({ ok: true }))

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
async function runFFmpegOnVGF(inputFiles, outputFiles, ffmpegCommand, timeoutMs = 600000) {
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
    if (status.status === 'succeeded') {
      const result = {}
      for (const [key, filename] of Object.entries(outputFiles)) {
        result[key] = status.output_files?.[filename]
      }
      console.log('[vgf] ✓ outputs:', Object.keys(result).join(', '))
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

// Upload raw bytes to B2 (SRT subtitle temp files, etc.)
async function uploadBytesToB2(buffer, key, contentType = 'application/octet-stream') {
  const bucket   = (process.env.B2_BUCKET || '').trim()
  const endpoint = (process.env.B2_ENDPOINT || '').trim().replace(/\/$/, '')
  const region   = (process.env.B2_REGION || 'us-east-005').trim()
  const uploadUrl = `${endpoint}/${bucket}/${key}`
  const parsed = new URL(uploadUrl)
  const now = new Date()
  const amzDate    = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp  = amzDate.slice(0, 8)
  const service    = 's3'
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const bodyHash = crypto.createHash('sha256').update(buffer).digest('hex')
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${parsed.hostname}\n` +
    `x-amz-content-sha256:${bodyHash}\n` +
    `x-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = ['PUT', parsed.pathname, '', canonicalHeaders, signedHeaders, bodyHash].join('\n')
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${process.env.B2_APPLICATION_KEY}`, dateStamp), region), service), 'aws4_request')
  const signature  = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${process.env.B2_KEY_ID}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'x-amz-content-sha256': bodyHash, 'x-amz-date': amzDate, 'Authorization': authorization },
    body: buffer,
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`[b2-bytes] HTTP ${res.status}: ${errBody.slice(0, 300)}`)
  }
  return uploadUrl
}

// Delete temp files from B2 by key list
async function deleteTempImagesFromB2(keys) {
  if (!keys.length) return
  const bucket   = (process.env.B2_BUCKET || '').trim()
  const endpoint = (process.env.B2_ENDPOINT || '').trim().replace(/\/$/, '')
  const region   = (process.env.B2_REGION || 'us-east-005').trim()
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
      const signingKey = hmac(hmac(hmac(hmac(`AWS4${process.env.B2_APPLICATION_KEY}`, dateStamp), region), service), 'aws4_request')
      const signature  = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
      const authorization =
        `AWS4-HMAC-SHA256 Credential=${process.env.B2_KEY_ID}/${credentialScope}, ` +
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
function vgfLongTimeout(audioDurationSeconds) {
  const contentMinutes = Math.ceil(audioDurationSeconds / 60)
  return Math.min(1_800_000, 600_000 + contentMinutes * 30_000)
}

async function burnSubtitlesVGF(videoUrl, subtitle_blocks, subtitle_style, jobId, timeoutMs = 600_000) {
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

  try {
    const result = await runFFmpegOnVGF(
      { in_1: videoUrl, in_2: assUrl },
      { out_1: 'output_subs.mp4' },
      `-i {{in_1}} -vf subtitles={{in_2}}:force_style=${forceStyle} -c:v libx264 -preset fast -crf 26 -maxrate 4M -bufsize 8M -pix_fmt yuv420p -c:a copy {{out_1}}`,
      timeoutMs
    )
    console.log('[vgf] subtitle burn-in done')
    return result.out_1
  } catch (subsErr) {
    console.warn('[vgf] subtitle burn-in failed, using video without subs:', subsErr.message)
    Sentry.captureException(subsErr, { extra: { jobId, stage: 'subtitle_burn' } })
    return videoUrl
  }
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
  for (let i = 0; i < clipUrls.length; i++) inputFiles[`in_${i + 1}`] = clipUrls[i]
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
  await updateJob(jobId, { status: 'processing', progress: 5 })
  const T = (label) => `[${jobId.slice(0,8)}] ${label}`
  console.time(T('TOTAL'))

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

    // ── INJECTED TEST FAILURE — remove after live refund gate test ──────────
    console.log(`[job:${jobId}] 🔴 INJECTED: sleeping 5s then throwing to test refund path`)
    await new Promise(r => setTimeout(r, 5000))
    throw new Error('INJECTED FAILURE: video credit refund gate test')
    // ── END INJECTION ────────────────────────────────────────────────────────

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
    const tempImageB2Keys = []
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

    if (useXfade) {
      // ── Stage 2: Encode all clips via VGF (parallel, max 20 concurrent) ─────
      console.time(T('2_clips_encode'))
      console.log(`[vgf] encoding ${resolvedImages.length} clips in parallel (pool=${VGF_CLIP_CONCURRENCY})...`)
      const clipUrls = await Promise.all(resolvedImages.map((img, i) =>
        clipPool(async () => {
          const clipDur = (durations[i] + td).toFixed(3)
          const vfFilter = getVfFilter(img, durations[i] + td, i, hasKenBurns)
          console.log(`[render] clip_${i} engine=${img.engine ?? 'undefined'} url=${img.url?.slice(0, 80)} vf=${vfFilter}`)
          // Ken Burns: -t on OUTPUT side; INPUT-side -t creates N×25 frames each expanded
          // by zoompan d=N×25 → N²×25 total frames (2500s for a 10s clip). No -tune stillimage
          // because the video has motion. For plain clips, keep the original INPUT-side -t.
          const clipCmd = hasKenBurns
            ? `-loop 1 -i {{in_1}} -vf "${vfFilter}" -t ${clipDur} -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -an {{out_1}}`
            : `-loop 1 -r 25 -t ${clipDur} -i {{in_1}} -vf "${vfFilter}" -c:v libx264 -preset ultrafast -tune stillimage -crf 28 -pix_fmt yuv420p -an {{out_1}}`
          try {
            const result = await runFFmpegOnVGF(
              { in_1: img.url },
              { out_1: `clip_${i}.mp4` },
              clipCmd
            )
            console.log(`[vgf] clip_${i} done (engine=${img.engine ?? 'flux'})`)
            return result.out_1
          } catch (err) {
            throw new Error(`clip_${i}(engine=${img.engine ?? 'flux'},url=${img.url?.slice(-50) ?? 'null'}): ${err.message}`)
          }
        })
      ))
      console.log(`[vgf] all ${clipUrls.length} clips encoded`)
      console.timeEnd(T('2_clips_encode'))
      await updateJob(jobId, { progress: 20 })

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
      await updateJob(jobId, { progress: 60 })

      // ── Stage 4: effects merged into Stage 3 mux pass ──────────────────────
      console.log(`[perf] 4_effects: ${effectFilters.length > 0 ? `merged into mux (${effects.join(', ')})` : 'skipped (no effects)'}`)

      // ── Stage 5: Burn subtitles ─────────────────────────────────────────────
      if (subtitle_blocks?.length && subtitle_style?.burnIn) {
        console.time(T('5_subtitles'))
        currentUrl = await burnSubtitlesVGF(currentUrl, subtitle_blocks, subtitle_style, jobId, longTimeout)
        console.timeEnd(T('5_subtitles'))
        await updateJob(jobId, { progress: 80 })
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
          console.log(`[render] clip_${i} engine=${img.engine ?? 'undefined'} url=${img.url?.slice(0, 80)} vf=${vfFilter}`)
          const clipCmd = hasKenBurns
            ? `-loop 1 -i {{in_1}} -vf "${vfFilter}" -t ${durations[i].toFixed(3)} -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -an {{out_1}}`
            : `-loop 1 -r 25 -t ${durations[i].toFixed(3)} -i {{in_1}} -vf "${vfFilter}" -c:v libx264 -preset ultrafast -tune stillimage -crf 28 -pix_fmt yuv420p -an {{out_1}}`
          try {
            const result = await runFFmpegOnVGF(
              { in_1: img.url },
              { out_1: `clip_${i}.mp4` },
              clipCmd
            )
            console.log(`[vgf] clip_${i} done (engine=${img.engine ?? 'flux'})`)
            return result.out_1
          } catch (err) {
            throw new Error(`clip_${i}(engine=${img.engine ?? 'flux'},url=${img.url?.slice(-50) ?? 'null'}): ${err.message}`)
          }
        })
      ))
      console.timeEnd(T('2_clips_encode'))
      await updateJob(jobId, { progress: 20 })

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
      }

      // Phase B: merge batches (skipped for ≤50 scenes; longTimeout for rare >50-scene videos)
      let mergedVideoUrl
      if (concatBatches.length === 1) {
        mergedVideoUrl = concatBatches[0]
      } else {
        console.log(`[vgf] merging ${concatBatches.length} batches...`)
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
      await updateJob(jobId, { progress: 60 })

      // ── Stage 4: effects merged into concat pass ────────────────────────────
      console.log(`[perf] 4_effects: ${effectFilters.length > 0 ? `merged into concat (${effects.join(', ')})` : 'skipped (no effects)'}`)

      // ── Stage 5: Burn subtitles ─────────────────────────────────────────────
      if (subtitle_blocks?.length && subtitle_style?.burnIn) {
        console.time(T('5_subtitles'))
        currentUrl = await burnSubtitlesVGF(currentUrl, subtitle_blocks, subtitle_style, jobId, longTimeout)
        console.timeEnd(T('5_subtitles'))
        await updateJob(jobId, { progress: 80 })
      } else {
        console.log('[perf] 5_subtitles: skipped (no burn-in)')
      }

      // Download final output from VGF for B2 upload
      await downloadFile(currentUrl, outputPath)
    }

    await updateJob(jobId, { progress: 95 })

    // ── Stage 6: Upload to Backblaze B2 ────────────────────────────────────
    const fileSizeBytes = fs.statSync(outputPath).size
    console.log(`[upload] file size: ${fileSizeBytes} bytes = ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB`)
    console.time(T('6_b2_upload'))
    const publicUrl = await uploadVideoToB2(outputPath, project_id, user_id ?? 'anon')
    console.timeEnd(T('6_b2_upload'))
    console.timeEnd(T('TOTAL'))

    await updateJob(jobId, {
      status: 'completed',
      progress: 100,
      video_url: publicUrl,
      completed_at: new Date().toISOString(),
    })
    console.log(`[job:${jobId}] done →`, publicUrl)

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
    await refundVideoJobCredits(jobId, body.user_id, body.project_id)
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      console.warn('[cleanup] rmSync failed:', e.message)
    }
    if (typeof tempImageB2Keys !== 'undefined' && tempImageB2Keys.length) {
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

  const openaiKey = process.env.OPENAI_API_KEY
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
    processVideoJob(jobId, req.body).catch((err) => {
      console.error(`[job:${jobId}] unhandled:`, err.message)
      Sentry.captureException(err, { extra: { jobId, stage: 'processVideoJob_unhandled' } })
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
  try {
    const rows = await sbGet('audio_jobs', `id=eq.${jobId}&select=credits_charged,credits_refunded_at`)
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row || !(row.credits_charged > 0) || row.credits_refunded_at) return

    const updated = await sbPatch(
      'audio_jobs',
      `id=eq.${jobId}&credits_refunded_at=is.null`,
      { credits_refunded_at: new Date().toISOString() }
    )
    if (!Array.isArray(updated) || updated.length === 0) return

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/add_credits`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({
        p_user_id:    userId,
        p_amount:     row.credits_charged,
        p_operation:  'audio_refund',
        p_project_id: projectId ?? null,
      }),
    })
    if (!rpcRes.ok) throw new Error(`add_credits RPC: ${rpcRes.status} ${await rpcRes.text().catch(() => '')}`)
    console.log(`[audio-job:${jobId}] refunded ${row.credits_charged} credits to ${userId}`)
  } catch (e) {
    console.error(`[audio-job:${jobId}] refundAudioJobCredits failed:`, e.message)
    Sentry.captureException(e, { extra: { jobId, userId, projectId } })
  }
}

// Mirror of refundAudioJobCredits for video jobs. Called from processVideoJob catch
// and the watchdog video branch. The Vercel status route has a secondary fallback.
async function refundVideoJobCredits(jobId, userId, projectId) {
  try {
    const rows = await sbGet('video_jobs', `id=eq.${jobId}&select=credits_charged,credits_refunded_at`)
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row || !(row.credits_charged > 0) || row.credits_refunded_at) return

    const updated = await sbPatch(
      'video_jobs',
      `id=eq.${jobId}&credits_refunded_at=is.null`,
      { credits_refunded_at: new Date().toISOString() }
    )
    if (!Array.isArray(updated) || updated.length === 0) return

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/add_credits`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({
        p_user_id:    userId,
        p_amount:     row.credits_charged,
        p_operation:  'video_refund',
        p_project_id: projectId ?? null,
      }),
    })
    if (!rpcRes.ok) throw new Error(`add_credits RPC: ${rpcRes.status} ${await rpcRes.text().catch(() => '')}`)
    console.log(`[video-job:${jobId}] refunded ${row.credits_charged} credits to ${userId}`)
  } catch (e) {
    console.error(`[video-job:${jobId}] refundVideoJobCredits failed:`, e.message)
    Sentry.captureException(e, { extra: { jobId, userId, projectId } })
  }
}

// ── TTS: SecretVoicer + Voicer synthesis helpers ──────────────────────────────

const SV_BASE       = 'https://secret-voicer.ru/api/v1'
const VOICER_DOMAIN = 'https://voicer.mat3u.com'
const VOICER_BASE   = `${VOICER_DOMAIN}/api/v1`

// Per-engine text chunk limits (chars). Voicer splits internally via split_type:'smart'.
const TTS_CHUNK_LIMITS = {
  secretvoicer: { maxChars: 3000,   measureBytes: false },
  voicer:       { maxChars: 195000, measureBytes: false },
}

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
async function synthesizeSecretVoicerChunk(text, voiceId, settings) {
  const apiKey = process.env.SECRETVOICER_API_KEY
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

  const POLL_MS    = 2500
  const TIMEOUT_MS = 275_000 // retained from Vercel; Railway has no Lambda limit — raise if needed
  const deadline   = Date.now() + TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
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
      return Buffer.from(await dlRes.arrayBuffer())
    }
    if (status.status === 'FAILED') {
      throw new Error(`SecretVoicer FAILED: ${status.error_message ?? 'unknown'}`)
    }
    // PENDING / LOCAL_PROCESSING → continue polling
  }
  throw new Error(`SecretVoicer: timeout after ${TIMEOUT_MS / 1000}s`)
}

// Submit one text chunk to Voicer; poll until completed.
// Returns Buffer (MP3). Throws on failure, timeout, or content-block.
async function synthesizeVoicerChunk(text, voiceId, settings) {
  const apiKey     = process.env.VOICER_API_KEY
  const authHeader = `Bearer ${apiKey}`

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

  const POLL_MS    = 2500
  const TIMEOUT_MS = 280_000 // retained from Vercel; Railway has no Lambda limit — raise if needed
  const deadline   = Date.now() + TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
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
      return Buffer.from(await dlRes.arrayBuffer())
    }
    if (status.status === 'failed') {
      throw new Error(`Voicer FAILED: ${status.error_message ?? 'unknown'}`)
    }
    if (status.status === 'censored') {
      throw new Error(`Voicer CENSORED: ${status.error_message ?? 'content blocked by ElevenLabs filter'}`)
    }
    // pending / processing → continue polling
  }
  throw new Error(`Voicer: timeout after ${TIMEOUT_MS / 1000}s`)
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
            return await synthesizeSecretVoicerChunk(chunk, job.voice_id, settings)
          } catch (e) {
            if (attempt === 1) throw e
            console.warn(`[audio-job:${jobId}] SV chunk ${idx + 1}/${chunks.length} retry:`, e.message)
          }
        }
      }
    } else if (job.engine === 'voicer') {
      synthesizeFn = (chunk) => synthesizeVoicerChunk(chunk, job.voice_id, settings)
    } else {
      throw new Error(`engine '${job.engine}' is sync-only and must run on Vercel Lambda, not the async worker`)
    }

    // 7. Synthesize all chunks in parallel (max 4 concurrent), order preserved by runLimited
    let doneChunks = 0
    const tasks = chunks.map((chunk, idx) => async () => {
      console.log(`[audio-job:${jobId}] chunk ${idx + 1}/${chunks.length} start`)
      const buf = await synthesizeFn(chunk, idx)
      doneChunks++
      console.log(`[audio-job:${jobId}] chunk ${idx + 1}/${chunks.length} done (${buf.byteLength} B)`)
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

    // 9. Upload to Supabase Storage → deterministic public URL
    const publicUrl = await uploadToSupabaseStorage(finalBuffer, job.user_id, job.project_id)
    console.log(`[audio-job:${jobId}] uploaded: ${publicUrl.slice(0, 100)}`)

    // 10. Mark audio_jobs completed (client polls this for real-time status)
    await updateAudioJob(jobId, {
      status:       'completed',
      result_url:   publicUrl,
      completed_at: new Date().toISOString(),
    })

    // 11. Update projects with RESULT ONLY — mirrors synchronous audio/route.ts status transition.
    //     voice_id and script are written by the Vercel dispatch Lambda (inputs, not results).
    //     Non-fatal: audio_jobs.result_url is the source of truth; projects drives the UI chain.
    try {
      await sbPatch(
        'projects',
        `id=eq.${job.project_id}&user_id=eq.${job.user_id}`,
        {
          audio_url: publicUrl,
          status:    'generating_subtitles',
        }
      )
      console.log(`[audio-job:${jobId}] projects.audio_url written`)
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
    await refundAudioJobCredits(jobId, job.user_id, job.project_id)
  }
}

// Must be added AFTER all routes
Sentry.setupExpressErrorHandler(app)

const PORT = parseInt(process.env.PORT || '3001', 10)
app.listen(PORT, async () => {
  console.log(`ytgen-video-server on :${PORT}`)
  await loadSettingsFromDB().catch(err => console.warn('[bot] settings load failed:', err.message))
  console.log('[bot] starting cron jobs...')

  const ownerId = process.env.TELEGRAM_OWNER_ID
  console.log('[boot] OWNER_ID:', ownerId || '(not set)')
  if (ownerId) {
    tgApi('sendMessage', { chat_id: ownerId, text: '🟢 Бот перезапущен' })
      .then(r => console.log('[boot] owner notified ok, tg response ok:', r?.ok))
      .catch(e => console.log('[boot] owner notify FAILED:', e.message))
  }

  registerWebhook().catch(console.error)
})
