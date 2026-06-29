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
const APP_URL     = process.env.APP_URL     || 'https://youtubegen.vercel.app'

// ── Telegram config ───────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID
const OWNER_ID = String(process.env.TELEGRAM_OWNER_ID || '')
const SERVER_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'https://ytgen-video-server-production.up.railway.app'

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
    `2. Свой email в YouTubeGen\n\n` +
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
    `2. Свой email в YouTubeGen\n\n` +
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
        'Ты SMM менеджер YouTube automation сервиса YouTubeGen.\n' +
        'Напиши engaging пост для Telegram канала на русском языке.\n' +
        `Тема: ${topic}\n\n` +
        'Правила:\n' +
        '- Максимум 500 символов\n' +
        '- Используй эмодзи\n' +
        '- Короткие абзацы\n' +
        '- В конце призыв: попробовать сервис со ссылкой https://youtubegen.vercel.app\n' +
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
        'Придумай одну конкретную и интересную тему поста для Telegram канала сервиса YouTubeGen ' +
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
        'Напиши пост для Telegram канала YouTubeGen об этом обновлении сервиса.\n\n' +
        `Описание изменений из git коммита: ${commitMessage}\n\n` +
        'Правила:\n' +
        '- Объясни обновление простым языком для блогеров\n' +
        '- Покажи пользу для пользователя\n' +
        '- Добавь эмодзи и ссылку https://youtubegen.vercel.app\n' +
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
    `📊 *Статистика YouTubeGen — ${date}*\n\n` +
    `👥 Пользователей: *${stats.users}*\n` +
    `📁 Проектов: *${stats.projects}*\n` +
    `🎬 Видео готово: *${stats.videos}*\n\n` +
    `Создай своё видео → https://youtubegen.vercel.app`
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
  headers: { 'User-Agent': 'YouTubeGen-Bot/1.0' },
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
          'Оцени эту статью/пост для Telegram канала YouTubeGen (сервис автоматизации YouTube через ИИ).\n\n' +
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
        'На основе этой статьи напиши оригинальный пост для Telegram канала YouTubeGen.\n' +
        'Не копируй текст — перескажи своими словами, добавь свою точку зрения, ' +
        'упомяни YouTubeGen как инструмент для YouTube авторов. ' +
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
          'Напиши другой вариант поста для Telegram канала YouTubeGen на эту тему. ' +
          'Стиль: живой, с эмодзи, максимум 500 символов. ' +
          'Упомяни YouTubeGen как инструмент для YouTube авторов.\n\n' +
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
      `Введи email пользователя в YouTubeGen:`)

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
        text: '👋 Привет! Для оплаты YouTubeGen из России\nвыбери удобный способ:',
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
        `📩 *Ответ от поддержки YouTubeGen:*\n\n` +
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
          `Войдите в YouTubeGen: ${APP_URL}`,
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
          '🤖 *YouTubeGen Bot*\n\n' +
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
  let sql = `-- YouTubeGen DB backup ${now.toISOString()}\n-- Source: Supabase REST API (service role)\n\n`

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
}

// ── Daily DB backup cron — 03:00 UTC ─────────────────────────────────────────
cron.schedule('0 3 * * *', async () => {
  console.log('[cron] daily db backup')
  try {
    await backupDatabase()
  } catch (err) {
    console.error('[cron/backup]', err.message)
    Sentry.captureException(err, { extra: { cron: 'backupDatabase' } })
  }
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
          text: `🚀 *Новый деплой YouTubeGen!*\n\n${text}\n\n_Опубликовать в канал?_`,
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

// FFmpeg -vf filter string for each named effect.
// Single quotes are avoided — VGF shell interprets them inside double-quoted -vf args.
// Spaces in curve points use backslash-escape (\\ in JS → \ at runtime → FFmpeg unescapes).
const EFFECT_FILTERS = {
  film_grain: 'noise=alls=25:allf=t+u',
  ken_burns: 'zoompan=z=min(1.3\\\\,zoom+0.0004):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=1:s=1280x720:fps=25',
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

function getVfFilter(_img) {
  return VF_SCALE
}

app.get('/health', (_req, res) => res.json({ ok: true }))

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
        body: JSON.stringify({ input_files: inputFiles, output_files: outNames, ffmpeg_commands: [cmd] }),
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
async function concatBatchVGF(clipUrls, batchId) {
  if (clipUrls.length === 1) return clipUrls[0]
  const inputFiles = {}
  for (let i = 0; i < clipUrls.length; i++) inputFiles[`in_${i + 1}`] = clipUrls[i]
  const filterStr = clipUrls.map((_, i) => `[${i}:v]`).join('') + `concat=n=${clipUrls.length}:v=1[vout]`
  const inputArgs = clipUrls.map((_, i) => `-i {{in_${i + 1}}}`).join(' ')
  const result = await runFFmpegOnVGF(
    inputFiles,
    { out_1: `${batchId}.mp4` },
    `${inputArgs} -filter_complex "${filterStr}" -map [vout] -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p -an {{out_1}}`
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

    const defaultDuration = Math.max(1, Number(image_interval) || 10)
    const effectFilters = (Array.isArray(effects) ? effects : []).map(e => EFFECT_FILTERS[e]).filter(Boolean)
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
          console.log(`[render] clip_${i} engine=${img.engine ?? 'undefined'} url=${img.url?.slice(0, 80)} vf=${getVfFilter(img)}`)
          try {
            const result = await runFFmpegOnVGF(
              { in_1: img.url },
              { out_1: `clip_${i}.mp4` },
              `-loop 1 -r 25 -t ${clipDur} -i {{in_1}} -vf "${getVfFilter(img)}" -c:v libx264 -preset ultrafast -tune stillimage -crf 28 -pix_fmt yuv420p -an {{out_1}}`
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
          console.log(`[render] clip_${i} engine=${img.engine ?? 'undefined'} url=${img.url?.slice(0, 80)} vf=${getVfFilter(img)}`)
          try {
            const result = await runFFmpegOnVGF(
              { in_1: img.url },
              { out_1: `clip_${i}.mp4` },
              `-loop 1 -r 25 -t ${durations[i].toFixed(3)} -i {{in_1}} -vf "${getVfFilter(img)}" -c:v libx264 -preset ultrafast -tune stillimage -crf 28 -pix_fmt yuv420p -an {{out_1}}`
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
      const CUT_CONCAT_BATCH = 25
      console.log(`[vgf] concat ${clipUrls.length} clips in batches of ${CUT_CONCAT_BATCH}...`)

      // Phase A: concat clips in batches
      const concatBatches = []
      for (let b = 0; b < clipUrls.length; b += CUT_CONCAT_BATCH) {
        const bClips = clipUrls.slice(b, b + CUT_CONCAT_BATCH)
        const bNum   = Math.floor(b / CUT_CONCAT_BATCH)
        console.log(`[vgf] concat batch ${bNum}: ${bClips.length} clips`)
        concatBatches.push(await concatBatchVGF(bClips, `cutbatch_${bNum}`))
      }

      // Phase B: merge batches (single concat if ≤1 batch)
      let mergedVideoUrl
      if (concatBatches.length === 1) {
        mergedVideoUrl = concatBatches[0]
      } else {
        console.log(`[vgf] merging ${concatBatches.length} batches...`)
        mergedVideoUrl = await concatBatchVGF(concatBatches, 'cutmerge')
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
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      console.warn('[cleanup] rmSync failed:', e.message)
    }
    if (typeof tempImageB2Keys !== 'undefined' && tempImageB2Keys.length) {
      await deleteTempImagesFromB2(tempImageB2Keys).catch(e => console.warn('[b2-cleanup] images:', e.message))
    }
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
