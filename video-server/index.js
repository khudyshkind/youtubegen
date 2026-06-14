'use strict'
const express = require('express')
const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')
const http = require('http')
const AnthropicPkg = require('@anthropic-ai/sdk')
const Anthropic = AnthropicPkg.default ?? AnthropicPkg
const cron = require('node-cron')
const RssParser = require('rss-parser')

const app = express()
app.use(express.json({ limit: '2mb' }))

const API_SECRET = process.env.RAILWAY_API_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

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
  { url: 'https://www.reddit.com/r/youtubers/.rss',                            name: 'r/youtubers', delayMs: 2000 },
  { url: 'https://www.reddit.com/r/artificial/.rss',                           name: 'r/artificial', delayMs: 2000 },
  { url: 'https://www.reddit.com/r/ChatGPT/.rss',                              name: 'r/ChatGPT',   delayMs: 2000 },
]

const KEYWORDS = [
  'youtube', 'автоматизация', 'нейросеть', 'ии', 'ai',
  'блогер', 'контент', 'видео', 'монетизация',
  'искусственный интеллект', 'chatgpt', 'midjourney',
]

const SEEN_URLS_PATH = path.join(__dirname, 'seen_urls.json')

// In-memory state (resets on restart)
let pendingPost = null            // { text, imageUrl, topic }
let pendingMonitorPost = null     // { post, source, url, score, topic }
let awaitingTopic = false         // true after "✍️ Написать пост"
let awaitingEdit  = false         // true after "✏️ Редактировать" on monitor post
const config        = { autoPublish: false }
const monitorConfig = { enabled: true }

// ── Keyboards ─────────────────────────────────────────────────────────────────
const MAIN_KB = {
  keyboard: [
    [{ text: '💡 Идея' },         { text: '📊 Статистика' }],
    [{ text: '✍️ Написать пост' }, { text: '📡 Мониторинг' }],
    [{ text: '⚙️ Настройки' }],
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

function settingsInline() {
  return {
    inline_keyboard: [
      [{ text: config.autoPublish ? '🟢 Автопубликация: ВКЛ' : '🔴 Автопубликация: ВЫКЛ', callback_data: 'toggle_auto' }],
      [{ text: monitorConfig.enabled ? '🟢 Мониторинг: ВКЛ' : '🔴 Мониторинг: ВЫКЛ', callback_data: 'toggle_monitor' }],
      [{ text: '⏰ Расписание: Пн 10:00 UTC', callback_data: 'noop' }],
      [{ text: '🌐 Часовой пояс: UTC', callback_data: 'noop' }],
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
  try {
    console.log('[fal] generating image for:', topic.slice(0, 40))
    const prompt = await withTimeout(generateImagePrompt(topic), 15000, 'image-prompt')
    console.log('[fal] prompt:', prompt.slice(0, 80))

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
      console.error('[fal] HTTP', res.status, await res.text().catch(() => ''))
      return null
    }
    const json = await res.json()
    const url = json.images?.[0]?.url ?? null
    console.log('[fal] image result:', url ? `ok (${url.slice(0, 50)})` : `failed — ${JSON.stringify(json).slice(0, 120)}`)
    return url
  } catch (err) {
    console.error('[fal] error:', err.message)
    return null
  }
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
function loadSeenUrls() {
  try { return new Set(JSON.parse(fs.readFileSync(SEEN_URLS_PATH, 'utf8'))) } catch { return new Set() }
}

function saveSeenUrls(set) {
  const arr = [...set].slice(-2000)
  try { fs.writeFileSync(SEEN_URLS_PATH, JSON.stringify(arr)) } catch (e) { console.warn('[monitor] saveSeenUrls:', e.message) }
}

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
  if (!monitorConfig.enabled) { console.log('[monitor] disabled, skipping'); return }
  console.log('[monitor] scanning', RSS_SOURCES.length, 'sources...')
  const seen = loadSeenUrls()
  const newItems = []

  for (const source of RSS_SOURCES) {
    if (source.delayMs) await new Promise(r => setTimeout(r, source.delayMs))
    const items = await fetchRss(source)
    for (const item of items) {
      if (!item.link || seen.has(item.link)) continue
      seen.add(item.link)
      if (hasKeyword(item.title + ' ' + item.snippet)) {
        newItems.push(item)
      }
    }
  }

  saveSeenUrls(seen)
  console.log('[monitor] new relevant items:', newItems.length)

  // Process up to 3 items per run to avoid Claude rate limits
  for (const item of newItems.slice(0, 3)) {
    await processMonitorItem(item)
  }
  console.log('[monitor] scan done')
}

// ── Core flow: show preview with inline buttons ───────────────────────────────
async function showPreview(chatId, post, imageUrl, topic) {
  pendingPost = { text: post, imageUrl, topic }
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
  const imageUrl = await withTimeout(generateImage(topic), 35000, 'image').catch(err => {
    console.warn('[tg] image generation failed:', err.message)
    return null
  })
  console.log('[tg] imageUrl:', imageUrl ? 'ok' : 'null')
  if (config.autoPublish && !forcePreview) {
    await publishToChannel(post, imageUrl)
    await sendTo(chatId, '✅ Опубликовано в канал (автопубликация)')
  } else {
    await showPreview(chatId, post, imageUrl, topic)
  }
}

// ── Inline button callback handler ────────────────────────────────────────────
async function handleCallback(cq) {
  const chatId = cq.message?.chat?.id
  const msgId  = cq.message?.message_id
  const data   = cq.data ?? ''
  const userId = String(cq.from?.id ?? '')

  await tgApi('answerCallbackQuery', { callback_query_id: cq.id })
  if (userId !== OWNER_ID) return

  const clearButtons = () =>
    tgApi('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })

  if (data === 'publish') {
    if (!pendingPost) { await sendTo(chatId, 'Нет поста на одобрении'); return }
    await publishToChannel(pendingPost.text, pendingPost.imageUrl)
    pendingPost = null
    await clearButtons()
    await sendTo(chatId, '✅ Опубликовано в канал')

  } else if (data === 'decline') {
    pendingPost = null
    await clearButtons()
    await sendTo(chatId, '❌ Пост отклонён')

  } else if (data === 'regen') {
    if (!pendingPost) { await sendTo(chatId, 'Нет поста для регенерации'); return }
    const topic = pendingPost.topic
    await clearButtons()
    await sendTo(chatId, '⏳ Перегенерирую...')
    await generateAndHandle(chatId, topic, true) // always preview on regen

  } else if (data === 'toggle_auto') {
    config.autoPublish = !config.autoPublish
    await tgApi('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: settingsInline() })
    await sendTo(chatId, config.autoPublish
      ? '🟢 Автопубликация *включена* — посты публикуются сразу'
      : '🔴 Автопубликация *выключена* — посты идут на подтверждение')

  } else if (data === 'toggle_monitor') {
    monitorConfig.enabled = !monitorConfig.enabled
    await tgApi('editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: settingsInline() })
    await sendTo(chatId, monitorConfig.enabled
      ? '🟢 Мониторинг *включён* — сканирую источники каждые 4 часа'
      : '🔴 Мониторинг *выключён*')

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

  if (userId !== OWNER_ID) {
    await tgApi('sendMessage', { chat_id: chatId, text: '🚫 Доступ запрещён' })
    return
  }

  console.log('[tg] msg:', text.slice(0, 60))

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
        const status = monitorConfig.enabled ? '🟢 ВКЛ' : '🔴 ВЫКЛ'
        const nextRun = 'каждые 4 часа'
        await tgApi('sendMessage', {
          chat_id: chatId,
          text:
            `📡 *Мониторинг контента*\n\n` +
            `Статус: ${status}\n` +
            `Интервал: ${nextRun}\n` +
            `Источников: ${RSS_SOURCES.length} RSS лент\n` +
            `Ключевых слов: ${KEYWORDS.length}\n\n` +
            `Найденные материалы автоматически оцениваются Claude (score ≥ 7) и предлагаются для публикации.`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🔍 Проверить сейчас', callback_data: 'mon_scan' },
              { text: monitorConfig.enabled ? '🔴 Выключить' : '🟢 Включить', callback_data: 'toggle_monitor' },
            ]],
          },
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
        if (!awaitingTopic) await sendTo(chatId, 'Используй кнопки внизу или /help')
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

// ── Monitor cron — every 4 hours ─────────────────────────────────────────────
cron.schedule('0 */4 * * *', async () => {
  console.log('[cron] monitor scan')
  try { await runMonitor() } catch (err) { console.error('[cron/monitor]', err.message) }
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

    // Compute per-image durations
    const durations = images.map((img) => {
      const hasTc = img.timecode_start && img.timecode_end
      return hasTc
        ? Math.max(1, parseSecs(img.timecode_end) - parseSecs(img.timecode_start))
        : defaultDuration
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
app.listen(PORT, () => {
  console.log(`ytgen-video-server on :${PORT}`)
  registerWebhook().catch(console.error)
})
