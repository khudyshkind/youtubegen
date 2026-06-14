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

const app = express()
app.use(express.json({ limit: '2mb' }))

const API_SECRET = process.env.RAILWAY_API_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// ── Telegram bot config ───────────────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID
const OWNER_ID = String(process.env.TELEGRAM_OWNER_ID || '')
const SERVER_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'https://ytgen-video-server-production.up.railway.app'

let pendingPost = null // { text } — last preview awaiting /yes or /no

// ── Telegram helpers ──────────────────────────────────────────────────────────
async function tgApi(method, params) {
  if (!BOT_TOKEN) return null
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    return res.json()
  } catch (err) {
    console.error(`[tg] ${method} error:`, err.message)
    return null
  }
}

async function sendTo(chatId, text) {
  return tgApi('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' })
}

async function sendToChannel(text) {
  return tgApi('sendMessage', { chat_id: CHANNEL_ID, text, parse_mode: 'Markdown' })
}

// ── Claude post generation ────────────────────────────────────────────────────
async function generatePost(topic) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
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
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
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

// ── Supabase stats ────────────────────────────────────────────────────────────
async function fetchStats() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null
  const headers = {
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'apikey': SUPABASE_SERVICE_KEY,
  }
  const [usersRes, projectsRes, videosRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/profiles?select=count`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/projects?select=count`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/projects?select=count&status=eq.completed`, { headers }),
  ])
  const [users, projects, videos] = await Promise.all([
    usersRes.json(), projectsRes.json(), videosRes.json(),
  ])
  return {
    users: users[0]?.count ?? '?',
    projects: projects[0]?.count ?? '?',
    videos: videos[0]?.count ?? '?',
  }
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
  await sendToChannel(text)
  if (toOwner) await sendTo(toOwner, '✅ Статистика опубликована в канал')
}

// ── Webhook handler ───────────────────────────────────────────────────────────
app.post('/telegram/webhook', async (req, res) => {
  res.json({ ok: true }) // ack Telegram immediately
  if (!BOT_TOKEN) return

  const message = req.body?.message
  if (!message) return

  const userId = String(message.from?.id ?? '')
  const chatId = message.chat?.id
  const text = (message.text ?? '').trim()

  if (userId !== OWNER_ID) {
    await sendTo(chatId, '🚫 Доступ запрещён')
    return
  }

  console.log('[tg] cmd from owner:', text.slice(0, 60))

  try {
    if (text === '/start' || text === '/help') {
      await sendTo(chatId,
        '🤖 *YouTubeGen Bot*\n\n' +
        'Команды:\n' +
        '`/post [тема]` — сгенерировать и опубликовать\n' +
        '`/preview [тема]` — посмотреть перед публикацией\n' +
        '`/yes` — опубликовать последний preview\n' +
        '`/no` — отклонить последний preview\n' +
        '`/stats` — статистика в канал\n' +
        '`/idea` — Claude сам придумает тему'
      )
    } else if (text.startsWith('/post ')) {
      const topic = text.slice(6).trim()
      if (!topic) { await sendTo(chatId, 'Укажи тему: `/post тема поста`'); return }
      await sendTo(chatId, '⏳ Генерирую пост...')
      const post = await generatePost(topic)
      await sendToChannel(post)
      await sendTo(chatId, '✅ Опубликовано в канал')
    } else if (text.startsWith('/preview ')) {
      const topic = text.slice(9).trim()
      if (!topic) { await sendTo(chatId, 'Укажи тему: `/preview тема поста`'); return }
      await sendTo(chatId, '⏳ Генерирую пост...')
      const post = await generatePost(topic)
      pendingPost = { text: post }
      await sendTo(chatId, `📝 *Превью:*\n\n${post}\n\n---\nОтветь /yes чтобы опубликовать или /no чтобы отклонить`)
    } else if (text === '/yes') {
      if (!pendingPost) { await sendTo(chatId, 'Нет поста на одобрении'); return }
      await sendToChannel(pendingPost.text)
      pendingPost = null
      await sendTo(chatId, '✅ Опубликовано в канал')
    } else if (text === '/no') {
      if (!pendingPost) { await sendTo(chatId, 'Нет поста на одобрении'); return }
      pendingPost = null
      await sendTo(chatId, '❌ Пост отклонён')
    } else if (text === '/stats') {
      await sendTo(chatId, '⏳ Получаю статистику...')
      await publishStats(chatId)
    } else if (text === '/idea') {
      await sendTo(chatId, '⏳ Придумываю тему...')
      const idea = await generateIdea()
      await sendTo(chatId, `💡 *Идея:* ${idea}\n\nГенерирую пост...`)
      const post = await generatePost(idea)
      pendingPost = { text: post }
      await sendTo(chatId, `📝 *Пост:*\n\n${post}\n\n---\nОтветь /yes чтобы опубликовать или /no чтобы отклонить`)
    } else {
      await sendTo(chatId, 'Неизвестная команда. Напиши /help')
    }
  } catch (err) {
    console.error('[tg/webhook] error:', err.message)
    await sendTo(chatId, `❌ Ошибка: ${err.message.slice(0, 120)}`)
  }
})

// ── Weekly stats cron — Monday 10:00 UTC ─────────────────────────────────────
cron.schedule('0 10 * * 1', async () => {
  console.log('[cron] weekly stats posting')
  try { await publishStats() } catch (err) { console.error('[cron]', err.message) }
}, { timezone: 'UTC' })

// ── Register Telegram webhook at startup ──────────────────────────────────────
async function registerWebhook() {
  if (!BOT_TOKEN) { console.warn('[tg] TELEGRAM_BOT_TOKEN not set'); return }
  const webhookUrl = `${SERVER_URL}/telegram/webhook`
  const result = await tgApi('setWebhook', { url: webhookUrl, drop_pending_updates: true })
  if (result?.ok) console.log('[tg] webhook registered:', webhookUrl)
  else console.warn('[tg] webhook registration failed:', JSON.stringify(result))
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
