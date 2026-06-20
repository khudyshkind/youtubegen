'use strict'
const express = require('express')
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const AnthropicPkg = require('@anthropic-ai/sdk')
const Anthropic = AnthropicPkg.default ?? AnthropicPkg
const cron = require('node-cron')
const RssParser = require('rss-parser')

const app = express()
app.use(express.json({ limit: '2mb' }))

const API_SECRET            = process.env.RAILWAY_API_SECRET
const SUPABASE_URL          = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
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

// ── Weekly stats cron — Monday 10:00 UTC ─────────────────────────────────────
cron.schedule('0 10 * * 1', async () => {
  console.log('[cron] weekly stats')
  try { await publishStats() } catch (err) { console.error('[cron]', err.message) }
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
  try { await runMonitor() } catch (err) { console.error('[cron/monitor]', err.message) }
}, { timezone: 'UTC' })

// ── Content plan cron — every hour, fires at hours from POST_SCHEDULES ────────
cron.schedule('0 * * * *', async () => {
  const h = new Date().getUTCHours()
  const schedule = POST_SCHEDULES[planConfig.postsPerDay] ?? [planConfig.postHour]
  if (!schedule.includes(h)) return
  console.log(`[cron] plan post at ${h}:00 UTC (postsPerDay=${planConfig.postsPerDay})`)
  try { await postFromQueue() } catch (err) { console.error('[cron/plan]', err.message) }
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
  try { await checkVercelDeploy() } catch (err) { console.error('[cron/vercel]', err.message) }
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

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} downloading ${url}`))
        return
      }
      response.pipe(file)
      file.on('finish', () => file.close(resolve))
      file.on('error', reject)
    })
    req.on('error', (err) => {
      fs.unlink(destPath, () => {})
      reject(err)
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

// FFmpeg -vf filter string for each named effect
const EFFECT_FILTERS = {
  film_grain: 'noise=alls=15:allf=t+u',
  ken_burns: "zoompan=z='min(1.3,1+0.0004*in)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=25",
  vignette: 'vignette=PI/4',
  haze: 'colorbalance=rs=0.05:gs=0.05:bs=0.15',
  grayscale: 'hue=s=0',
  cinematic: "curves=r='0/0 1/0.88':b='0/0.05 1/0.95',colorbalance=ss=0.08",
  lens_flare: "curves=r='0/0.02 0.5/0.55 1/1':g='0/0 0.5/0.5 1/0.97':b='0/0.05 0.5/0.45 1/0.9'",
  vhs: "noise=alls=20:allf=t,hue=s=0.65,colorbalance=rs=0.08:gs=-0.03:bs=-0.05",
}

const VF_BASE =
  'scale=1280:720:force_original_aspect_ratio=decrease,' +
  'pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1'

app.get('/health', (_req, res) => res.json({ ok: true }))

app.post('/render', verifySecret, async (req, res) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytgen-'))

  try {
    const {
      audio_url,
      images,
      subtitle_blocks,
      subtitle_style,
      project_id,
      image_interval,
      transition = 'cut',
      transition_duration = 0.5,
      effects = [],
    } = req.body

    if (!audio_url || !Array.isArray(images) || !images.length || !project_id) {
      return res.status(400).json({ ok: false, error: 'Missing audio_url, images, or project_id' })
    }

    console.log('[render] project:', project_id,
      '| images:', images.length,
      '| transition:', transition,
      '| effects:', effects,
      '| burnIn:', subtitle_style?.burnIn ?? false)

    const defaultDuration = Math.max(1, Number(image_interval) || 10)

    // Download audio
    const audioPath = path.join(tmpDir, 'audio.mp3')
    await downloadFile(audio_url, audioPath)

    // Normalize loudness to -14 LUFS (YouTube standard)
    const audioNormPath = path.join(tmpDir, 'audio_norm.mp3')
    let finalAudioPath = audioPath
    try {
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', [
          '-i', audioPath,
          '-filter:a', 'loudnorm=I=-14:LRA=7:TP=-1',
          '-ar', '44100',
          '-y', audioNormPath,
        ], { maxBuffer: 10 * 1024 * 1024 }, (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr.slice(-300)))
          else resolve()
        })
      })
      finalAudioPath = audioNormPath
      console.log('[audio] loudnorm applied')
    } catch (normErr) {
      console.warn('[audio] loudnorm failed, using original:', normErr.message)
    }

    // Download all scene images
    const imagePaths = []
    for (let i = 0; i < images.length; i++) {
      const imgPath = path.join(tmpDir, `img_${String(i).padStart(3, '0')}.jpg`)
      await downloadFile(images[i].url, imgPath)
      imagePaths.push(imgPath)
    }

    // Get exact audio duration via ffprobe
    const audioDuration = await new Promise((resolve, reject) => {
      execFile('ffprobe', [
        '-v', 'quiet',
        '-show_entries', 'format=duration',
        '-of', 'csv=p=0',
        finalAudioPath,
      ], (err, stdout) => {
        if (err) reject(new Error(`ffprobe: ${err.message}`))
        else resolve(parseFloat(stdout.trim()))
      })
    })

    // Compute per-image durations from timecodes when available and meaningful
    const durations = images.map((img) => {
      if (img.timecode_start && img.timecode_end) {
        const tc = parseSecs(img.timecode_end) - parseSecs(img.timecode_start)
        if (tc > 0.5) return tc  // valid proportional timecode
      }
      return defaultDuration  // fallback: old projects or no timecodes
    })
    const totalImagesDuration = durations.reduce((a, b) => a + b, 0)
    if (totalImagesDuration < audioDuration) {
      durations[durations.length - 1] += audioDuration - totalImagesDuration
    }

    const tempBasePath = path.join(tmpDir, 'temp_1.mp4')
    const tempEffectsPath = path.join(tmpDir, 'temp_2.mp4')
    const outputPath = path.join(tmpDir, 'output.mp4')

    // ── Pass 1: Assemble images into video ──────────────────────────────────
    const useXfade = transition && transition !== 'cut' && imagePaths.length > 1
    const td = Math.max(0.1, Math.min(1.5, Number(transition_duration) || 0.5))

    if (useXfade) {
      // Each image as a looped video input; extend duration by td so xfade has overlap material
      const ffArgs = []
      for (let i = 0; i < imagePaths.length; i++) {
        ffArgs.push('-loop', '1', '-t', String(durations[i] + td), '-i', imagePaths[i])
      }
      ffArgs.push('-i', finalAudioPath)
      const audioIdx = imagePaths.length

      // Build filter_complex: scale each input, then chain xfade filters
      const filterParts = []
      for (let i = 0; i < imagePaths.length; i++) {
        filterParts.push(`[${i}:v]${VF_BASE}[v${i}]`)
      }

      // xfade chain: [v0][v1]xfade@offset0 → [x0]; [x0][v2]xfade@offset1 → [x1]; ...
      let cumOffset = 0
      let prevLabel = '[v0]'
      for (let i = 0; i < imagePaths.length - 1; i++) {
        cumOffset += durations[i]
        const offset = Math.max(0, cumOffset - (i + 1) * td)
        const outLabel = i === imagePaths.length - 2 ? '[vout]' : `[x${i}]`
        filterParts.push(
          `${prevLabel}[v${i + 1}]xfade=transition=${transition}:duration=${td.toFixed(2)}:offset=${offset.toFixed(3)}${outLabel}`
        )
        prevLabel = outLabel
      }

      ffArgs.push(
        '-filter_complex', filterParts.join(';'),
        '-map', '[vout]',
        '-map', `${audioIdx}:a`,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        '-t', String(audioDuration),
        '-y', tempBasePath,
      )

      await new Promise((resolve, reject) => {
        execFile('ffmpeg', ffArgs, { maxBuffer: 20 * 1024 * 1024 }, (err, _stdout, stderr) => {
          if (err) reject(new Error(`FFmpeg xfade (${transition}): ${stderr.slice(-400)}`))
          else resolve()
        })
      })
      console.log('[ffmpeg] xfade done:', transition, td + 's')
    } else {
      // Concat demuxer — simple cut between scenes
      const concatLines = []
      for (let i = 0; i < imagePaths.length; i++) {
        concatLines.push(`file '${imagePaths[i]}'`)
        concatLines.push(`duration ${durations[i]}`)
      }
      concatLines.push(`file '${imagePaths[imagePaths.length - 1]}'`)
      const concatPath = path.join(tmpDir, 'concat.txt')
      fs.writeFileSync(concatPath, concatLines.join('\n'))

      await new Promise((resolve, reject) => {
        execFile('ffmpeg', [
          '-f', 'concat', '-safe', '0', '-i', concatPath,
          '-i', finalAudioPath,
          '-vf', VF_BASE,
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-c:a', 'aac', '-b:a', '128k',
          '-movflags', '+faststart',
          '-t', String(audioDuration),
          '-y', tempBasePath,
        ], { maxBuffer: 20 * 1024 * 1024 }, (err, _stdout, stderr) => {
          if (err) reject(new Error(`FFmpeg concat: ${stderr.slice(-400)}`))
          else resolve()
        })
      })
      console.log('[ffmpeg] concat done')
    }

    // ── Pass 2: Apply visual effects ─────────────────────────────────────────
    const effectFilters = (Array.isArray(effects) ? effects : [])
      .map((e) => EFFECT_FILTERS[e])
      .filter(Boolean)

    let currentPath = tempBasePath

    if (effectFilters.length > 0) {
      const vfEffects = effectFilters.join(',')
      await new Promise((resolve, reject) => {
        execFile('ffmpeg', [
          '-i', tempBasePath,
          '-vf', vfEffects,
          '-c:a', 'copy',
          '-y', tempEffectsPath,
        ], { maxBuffer: 20 * 1024 * 1024 }, (err, _stdout, stderr) => {
          if (err) reject(new Error(`FFmpeg effects: ${stderr.slice(-400)}`))
          else resolve()
        })
      })
      currentPath = tempEffectsPath
      console.log('[ffmpeg] effects applied:', effects.join(', '))
    }

    // ── Pass 3: Burn subtitles ────────────────────────────────────────────────
    if (subtitle_blocks?.length && subtitle_style?.burnIn) {
      const srtPath = path.join(tmpDir, 'subs.srt')
      fs.writeFileSync(srtPath, blocksToSrt(subtitle_blocks))

      const sizeMap = { small: 18, medium: 22, large: 28 }
      const alignMap = { top: 8, center: 5, bottom: 2 }
      const fontSize = sizeMap[subtitle_style.size] ?? 22
      const alignment = alignMap[subtitle_style.position] ?? 2
      const colour = hexToAss(subtitle_style.color)
      const bg = subtitle_style.background

      const escaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:')
      let forceStyle = `FontName=Liberation Sans,FontSize=${fontSize},PrimaryColour=${colour},OutlineColour=&H000000,Outline=2,Bold=1,Alignment=${alignment}`
      if (bg) forceStyle += ',BorderStyle=3,BackColour=&H80000000'

      try {
        await new Promise((resolve, reject) => {
          execFile('ffmpeg', [
            '-i', currentPath,
            '-vf', `subtitles='${escaped}':force_style='${forceStyle}'`,
            '-c:a', 'copy',
            '-y', outputPath,
          ], { maxBuffer: 20 * 1024 * 1024 }, (err, _stdout, stderr) => {
            if (err) reject(new Error(`FFmpeg subtitles: ${stderr.slice(-400)}`))
            else resolve()
          })
        })
        console.log('[ffmpeg] subtitle burn-in done')
      } catch (subsErr) {
        console.warn('[ffmpeg] subtitle burn-in failed, skipping subs:', subsErr.message)
        fs.renameSync(currentPath, outputPath)
      }
    } else {
      fs.renameSync(currentPath, outputPath)
    }

    // Upload MP4 to Supabase Storage via REST API
    const fileBuffer = fs.readFileSync(outputPath)
    const storagePath = `${project_id}/output.mp4`
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/videos/${storagePath}`

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'video/mp4',
        'x-upsert': 'true',
      },
      body: fileBuffer,
    })

    if (!uploadRes.ok) {
      const errText = await uploadRes.text()
      throw new Error(`Supabase upload failed ${uploadRes.status}: ${errText}`)
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/videos/${storagePath}`
    return res.json({ ok: true, video_url: publicUrl })
  } catch (err) {
    console.error('[/render]', err)
    return res.status(500).json({ ok: false, error: err.message })
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

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
