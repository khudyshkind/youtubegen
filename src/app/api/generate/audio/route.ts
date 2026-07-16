import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import * as Sentry from '@sentry/nextjs'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { trackEvent } from '@/lib/analytics'
import { audioCost, ENGINE_DISPLAY } from '@/lib/types'
import type { AudioEngine, ApihostVoiceType } from '@/lib/types'
import { env } from '@/lib/env'
import { notifyError } from '@/lib/telegram'

export const maxDuration = 300

const ELEVENLABS_BASE = 'https://api.elevenlabs.io'

const STYLE_EXAGGERATION: Record<string, number> = {
  neutral: 0,
  conversational: 0.2,
  documentary: 0.3,
  emotional: 0.8,
}

// Per-engine chunk limits. Split long scripts before sending to TTS APIs.
// ElevenLabs/OpenAI/APIHOST: Unicode character count (JS .length)
// Google: UTF-8 byte count (Cyrillic = 2 bytes/char, limit is 5000 bytes)
const CHUNK_LIMITS: Record<AudioEngine, { maxChars: number; measureBytes: boolean }> = {
  secretvoicer: { maxChars: 3000, measureBytes: false }, // parallel chunked synthesis; each chunk ≈ 1-2 min audio
  elevenlabs:   { maxChars: 4800, measureBytes: false }, // API limit 5000 chars
  openai:       { maxChars: 4000, measureBytes: false }, // API limit 4096 chars
  google:       { maxChars: 2300, measureBytes: true  }, // API limit 5000 bytes; Cyrillic 2 bytes/char
  apihost:      { maxChars: 4000, measureBytes: false }, // no hard limit; keeps each job < 60s synthesis
  voicer:       { maxChars: 195000, measureBytes: false }, // Voicer task limit 200k; server splits via split_type:'smart'
}

const SV_BASE = 'https://secret-voicer.ru/api/v1'
const VOICER_DOMAIN = 'https://voicer.mat3u.com'
const VOICER_BASE = `${VOICER_DOMAIN}/api/v1`

interface AudioRequest {
  engine?: AudioEngine
  text: string
  voice_id: string
  project_id?: string
  // ownScript=true → text was typed by user (not AI-generated), apply TTS normalization
  own_script?: boolean
  script_lang?: string
  // ElevenLabs-specific
  stability?: number
  similarity_boost?: number
  speech_rate?: number
  voice_style?: string | number
  clarity_boost?: boolean
  // APIHOST-specific
  apihost_voice_type?: ApihostVoiceType
  apihost_lang?: string
  apihost_pitch?: number
}

// Remove structural scene/section markers and Markdown formatting inserted by
// the script generator so TTS doesn't pronounce them literally.
// The stored script is NOT modified — markers remain for UI display and
// image-generation context. Only stripped here, immediately before TTS.
function stripSectionMarkers(text: string): string {
  return text
    // Bracket-style markers: [Сцена N:], [Scene N:], [Секция N:], [Section N:]
    .replace(/\[(?:Сцена|Scene|Секция|Section)\s+\d+[^\]]*\]\s*/gi, '')
    // Pause markers inserted by scriptParams.pauses: [...], [ ... ], […]
    .replace(/\[\s*(?:\.{2,}|…+)\s*\]\s*/g, '')
    // Bare heading lines: «Сцена 1:», «Глава 3.», «Part 2 — Title», «СЦЕНА 4», etc.
    // Short tail (≤60 chars) → delete whole line; long tail → strip prefix, keep content.
    // [ \t]* (not \s*) prevents consuming the newline into the captured tail.
    .replace(
      /^(?:Сцена|Секция|Глава|Часть|Scene|Section|Chapter|Part)[ \t]+\d+[ \t]*[:.\-–—]?[ \t]*(.*)$/gim,
      (_, tail) => (tail.trim().length <= 60 ? '' : tail.trim()),
    )
    // Markdown headings on their own line: # Title, ## Title, etc.
    .replace(/^#{1,6}\s+.+$/gm, '')
    // Markdown horizontal rules: ---, ***, ___
    .replace(/^(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    // Markdown bold: **text** → text, __text__ → text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    // Collapse 3+ consecutive newlines down to 2 (paragraph break)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// --- TTS Text Normalization (ownScript path only) ---
// Applied only when own_script=true (user-typed text). AI-generated scripts are already
// TTS-friendly from the script-generation prompt — no need to run Haiku on them.
//
// Pipeline: regex (fast, lang-specific) → Haiku (contextual numbers/dates).
// Regex runs first so Haiku sees "299 рублей" not "299₽" — cleaner number context.
// Haiku is skipped when no digits remain (nothing left to expand).
// On Haiku failure the regex-only result is used — normalization never blocks synthesis.

function applyRegexNormalization(text: string, lang: string): string {
  let t = text

  if (lang === 'ru') {
    // Compound abbreviations first (longer patterns must precede shorter)
    t = t
      .replace(/\bи т\.д\.\b/g, 'и так далее')
      .replace(/\bи т\.п\.\b/g, 'и тому подобное')
      .replace(/\bт\.к\.\b/g, 'так как')
      .replace(/\bт\.е\.\b/g, 'то есть')
      .replace(/\bнапр\.\b/g, 'например')
      .replace(/\bдр\.\b/g, 'другие')
      .replace(/\bок\.\b/g, 'около')
      .replace(/\bруб\.\b/g, 'рублей')
      .replace(/\bкоп\.\b/g, 'копеек')
      // Symbols → Russian words (done before Haiku so it sees "45 процентов", not "45%")
      .replace(/№\s*(\d)/g, 'номер $1')
      .replace(/(\d)\s*%/g, '$1 процентов')
      .replace(/(\d)\s*₽/g, '$1 рублей')
      .replace(/(\d)\s*\$/g, '$1 долларов')
      .replace(/(\d)\s*€/g, '$1 евро')
      .replace(/\s+&\s+/g, ' и ')
  }
  // Non-RU: skip symbol regex; Haiku normalizes numbers AND symbols in the correct language

  // Universal: leftover Markdown italic (bold/headings already stripped by stripSectionMarkers)
  t = t
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')

  return t
}

async function normalizeTtsText(text: string, lang: string): Promise<string> {
  const intermediate = applyRegexNormalization(text, lang)

  // Skip Haiku when no digits remain — nothing left to expand
  if (!/\d/.test(intermediate)) return intermediate

  const apiKey = env('ANTHROPIC_API_KEY')
  if (!apiKey) return intermediate

  const isRu = lang === 'ru'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)

  const system = isRu
    ? [
        'Ты — нормализатор текста для синтеза речи (TTS).',
        'ЗАДАЧА: заменить числа, даты, суммы, количества и их комбинации на произносимые слова на русском языке с правильными падежами.',
        '',
        'СТРОГИЕ ПРАВИЛА:',
        '— Меняй ТОЛЬКО числа → слова (с учётом падежа и рода по контексту)',
        '— НЕ меняй смысл, структуру, стиль или порядок слов',
        '— НЕ добавляй и НЕ убирай слова, кроме числовой нормализации',
        '— НЕ переформулируй предложения',
        '— Верни ТОЛЬКО нормализованный текст, без пояснений и комментариев',
        '',
        'Примеры:',
        '"в 2026 году" → "в две тысячи двадцать шестом году"',
        '"5 млн пользователей" → "пять миллионов пользователей"',
        '"10,5 процентов" → "десять с половиной процентов"',
        '"за 3 месяца" → "за три месяца"',
        '"прирост в 2.3 раза" → "прирост в два целых три десятых раза"',
      ].join('\n')
    : [
        'You are a TTS text normalizer.',
        'TASK: Replace all numbers, dates, amounts, quantities, and currency symbols with their spoken-word equivalents in the language of the input text.',
        '',
        'STRICT RULES:',
        '— ONLY expand numbers/dates/currency → words (in the language of the text)',
        '— Do NOT change meaning, structure, style, or word order',
        '— Do NOT add or remove any content except for number expansion',
        '— Return ONLY the normalized text, no explanations',
      ].join('\n')

  try {
    const anthropic = new Anthropic({ apiKey })
    const response = await anthropic.messages.create(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: Math.min(4096, Math.ceil(intermediate.length * 1.6)),
        system,
        messages: [{ role: 'user', content: intermediate }],
      },
      { signal: controller.signal }
    )
    clearTimeout(timer)
    const block = response.content[0]
    return block.type === 'text' ? block.text.trim() : intermediate
  } catch (e) {
    clearTimeout(timer)
    console.warn('[normalize-tts] Haiku unavailable, using regex-only output:', e instanceof Error ? e.message : String(e))
    return intermediate
  }
}

// Strip the ID3v2 tag from the start of an MP3 buffer.
// TTS APIs return each synthesized chunk as a standalone MP3 file with its own
// ID3v2 header. Raw Buffer.concat produces stray ID3 headers mid-stream, which
// confuses MP3 decoders: they reset PTS at the second header, causing audio-video
// drift that progressively worsens in the final video. Only applied to non-first
// chunks — the first chunk keeps its ID3 header intact for metadata.
// Pure Node.js, no external dependencies, O(1) per chunk.
function stripId3Tag(buf: Buffer): Buffer {
  // ID3v2 identifier: bytes 0-2 = 0x49 0x44 0x33 ("ID3")
  // Tag size: bytes 6-9 as a synchsafe integer (each byte's bit 7 is always 0)
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

// Split text into chunks that fit within the per-engine character/byte limit.
// Splits at paragraph and sentence boundaries to avoid unnatural mid-speech breaks.
function splitTextIntoChunks(text: string, maxChars: number, measureBytes: boolean): string[] {
  const measure = (s: string) => measureBytes ? Buffer.byteLength(s, 'utf8') : s.length
  if (measure(text) <= maxChars) return [text]

  // Flatten paragraphs then sentence-split each paragraph
  const sentences = text
    .split(/\n{2,}/)
    .flatMap(para => para.split(/(?<=[.!?…])\s+/))
    .map(s => s.trim())
    .filter(Boolean)

  const chunks: string[] = []
  let current = ''

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence
    if (measure(candidate) <= maxChars) {
      current = candidate
    } else {
      if (current) chunks.push(current)
      // Single sentence too large → word-level split as last resort
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
// Works identically for sync synthesizers (direct HTTP) and async ones (submit+poll),
// since both expose the same interface: () => Promise<Buffer>.
async function runLimited<T>(fns: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(fns.length)
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

// ── Per-engine single-chunk synthesizers ────────────────────────────────────

async function synthesizeSecretVoicerChunk(
  text: string,
  voiceId: string,
  settings: { stability: number; similarity: number; style: number; speechRate: number },
): Promise<Buffer> {
  const apiKey = env('SECRETVOICER_API_KEY')
  const res = await fetch(`${SV_BASE}/synthesize`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice_id: voiceId,
      mode: 'standard',
      stability: settings.stability,
      similarity_boost: settings.similarity,
      style: settings.style,
      rate: settings.speechRate,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`SecretVoicer HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  const j = (await res.json()) as { task_id?: number | string }
  const taskId = j.task_id
  if (!taskId) throw new Error('SecretVoicer: no task_id in response')

  const POLL_MS = 2500
  const TIMEOUT_MS = 275_000 // 275s: fits under 300s Lambda (maxDuration=300) with 25s headroom
  const deadline = Date.now() + TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    let status: { status: string; audio_url?: string; error_message?: string }
    try {
      const pollRes = await fetch(`${SV_BASE}/task/${taskId}`, {
        headers: { 'X-API-Key': apiKey },
      })
      if (!pollRes.ok) continue
      status = (await pollRes.json()) as { status: string; audio_url?: string; error_message?: string }
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

async function synthesizeVoicerChunk(
  text: string,
  voiceId: string,
  settings: { stability: number; similarity: number; style: number; speechRate: number },
): Promise<Buffer> {
  const apiKey = env('VOICER_API_KEY')
  const authHeader = `Bearer ${apiKey}`

  const res = await fetch(`${VOICER_BASE}/voice/synthesize`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice_id: voiceId,
      model_id: 'eleven_turbo_v2_5',
      split_type: 'smart',
      max_chunk_length: 2500,
      voice_settings: {
        stability: settings.stability,
        similarity_boost: settings.similarity,
        style: settings.style,
        speed: Math.min(1.2, Math.max(0.7, settings.speechRate ?? 1.0)),
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Voicer HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  const j = (await res.json()) as { task_id?: string }
  const taskId = j.task_id
  if (!taskId) throw new Error('Voicer: no task_id in response')

  const POLL_MS = 2500
  const TIMEOUT_MS = 280_000 // 280s: Voicer queues tasks ~100s + synthesis; must fit in 300s Lambda
  const deadline = Date.now() + TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    let status: { status: string; download_url?: string | null; error_message?: string | null }
    try {
      const pollRes = await fetch(`${VOICER_BASE}/voice/status/${taskId}`, {
        headers: { Authorization: authHeader },
      })
      if (!pollRes.ok) continue
      status = (await pollRes.json()) as { status: string; download_url?: string | null; error_message?: string | null }
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

async function synthesizeElevenLabsChunk(
  text: string,
  voiceId: string,
  settings: { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean },
): Promise<Buffer> {
  const res = await fetch(
    `${ELEVENLABS_BASE}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': env('ELEVENLABS_API_KEY'),
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: settings }),
    }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ElevenLabs HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

async function synthesizeOpenAIChunk(text: string, voiceId: string, apiKey: string): Promise<Buffer> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', voice: voiceId, input: text, response_format: 'mp3' }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenAI TTS HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

async function synthesizeGoogleChunk(
  text: string,
  voiceId: string,
  langCode: string,
  apiKey: string,
): Promise<Buffer> {
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: langCode, name: voiceId },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google TTS HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  const json = (await res.json()) as { audioContent?: string }
  if (!json.audioContent) throw new Error('Google TTS returned empty audioContent')
  return Buffer.from(json.audioContent, 'base64')
}

// APIHOST: submit one synthesis job, returns processId
async function submitApihostJob(
  text: string,
  voiceId: string,
  opts: { lang: string; rate: string; pitch: string },
  headers: Record<string, string>,
): Promise<string> {
  const res = await fetch('https://apihost.ru/api/v1/synthesize', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      data: [{ lang: opts.lang, speaker: Number(voiceId), text, rate: opts.rate, pitch: opts.pitch, type: 'mp3', pause: '0' }],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`APIHOST submit HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  const json = (await res.json()) as { process?: string; id?: string }
  const pid = json.process ?? json.id
  if (!pid) throw new Error('APIHOST: no process ID in submit response')
  return pid
}

// APIHOST: poll one job until it returns status 200 (max ~4.5 min)
async function pollApihostJob(processId: string, headers: Record<string, string>): Promise<string> {
  for (let i = 0; i < 54; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const res = await fetch('https://apihost.ru/api/v1/process', {
      method: 'POST',
      headers,
      body: JSON.stringify({ process: processId }),
    })
    if (!res.ok) continue
    const json = (await res.json()) as { status?: number; message?: string; url?: string }
    if (json.status === 200) {
      const url = json.message ?? json.url
      if (!url) throw new Error(`APIHOST: job ${processId} done but no URL in response`)
      return url
    }
  }
  throw new Error(`APIHOST: timeout waiting for job ${processId}`)
}

async function uploadTextToStorage(text: string, userId: string, projectId: string): Promise<string> {
  const serviceClient = createServiceClient()
  const storagePath = `${userId}/${projectId}/tts-input.txt`

  const { error } = await serviceClient.storage
    .from('audio')
    .upload(storagePath, Buffer.from(text, 'utf-8'), {
      contentType: 'text/plain; charset=utf-8',
      upsert: true,
    })

  if (error) throw new Error(`Text upload to Storage failed: ${error.message}`)

  const { data: { publicUrl } } = serviceClient.storage
    .from('audio')
    .getPublicUrl(storagePath)

  return publicUrl
}

// ── Main route ───────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body: AudioRequest = await request.json()
    const {
      engine = 'secretvoicer',
      text,
      voice_id,
      project_id,
      own_script = false,
      script_lang = 'ru',
      stability = 0.5,
      similarity_boost = 0.75,
      speech_rate = 1.0,
      voice_style = 0,
      clarity_boost = false,
      apihost_voice_type = 'standard',
      apihost_lang = 'ru-RU',
      apihost_pitch = 1.0,
    } = body

    if (!text || !voice_id) {
      return NextResponse.json({ ok: false, error: 'Текст и голос обязательны' }, { status: 400 })
    }

    Sentry.setUser({ id: user.id })
    Sentry.setContext('generate', { project_id, engine, voice_id })

    const validEngines: AudioEngine[] = ['secretvoicer', 'elevenlabs', 'openai', 'google', 'apihost', 'voicer']
    if (!validEngines.includes(engine)) {
      return NextResponse.json({ ok: false, error: 'Неверный движок TTS' }, { status: 400 })
    }

    // Server-side plan gate: voicer is only available to paid plans
    if (engine === 'voicer') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('plan')
        .eq('id', user.id)
        .single()
      if (!profile || profile.plan === 'free') {
        return NextResponse.json(
          { ok: false, error: 'Премиум-озвучка доступна только на платных планах' },
          { status: 403 }
        )
      }
    }

    const chars = text.length
    const cost = Math.max(1, audioCost(chars, engine, apihost_voice_type))

    const check = await requireCreditsAmount(user.id, cost, supabase)
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    // ── Async path: SV/Voicer → Railway worker ───────────────────────────────
    // requireCreditsAmount already checked above; credits spent after job is confirmed
    if (engine === 'secretvoicer' || engine === 'voicer') {
      if (!project_id) {
        return NextResponse.json(
          { ok: false, error: 'project_id обязателен для async-озвучки' },
          { status: 400 }
        )
      }

      const styleExaggeration = typeof voice_style === 'number'
        ? voice_style
        : (STYLE_EXAGGERATION[voice_style] ?? 0)

      // A. Upload raw script text — worker downloads via text_url and strips markers itself
      const textUrl = await uploadTextToStorage(text, user.id, project_id)

      // B. Write dispatch inputs to projects; worker writes only result (audio_url + generating_subtitles)
      await supabase.from('projects').update({
        voice_id,
        status:  'generating_audio',
        ...(own_script && text ? { script: text } : {}),
      }).eq('id', project_id).eq('user_id', user.id)

      // C. Submit job to Railway worker
      const railwayUrl    = env('RAILWAY_VIDEO_SERVER_URL').replace(/\/$/, '')
      const railwaySecret = env('RAILWAY_API_SECRET')
      const workerRes = await fetch(`${railwayUrl}/synthesize-audio`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-secret': railwaySecret },
        body: JSON.stringify({
          user_id:          user.id,
          project_id,
          engine,
          voice_id,
          text_url:         textUrl,
          own_script,
          voice_style:      styleExaggeration,
          stability,
          similarity_boost,
          speech_rate,
        }),
      })
      if (!workerRes.ok) {
        const errBody = await workerRes.text().catch(() => '')
        console.error('[generate/audio] Railway worker error:', workerRes.status, errBody.slice(0, 200))
        return NextResponse.json(
          { ok: false, error: `Ошибка запуска синтеза (${workerRes.status})` },
          { status: 502 }
        )
      }
      const { job_id } = await workerRes.json() as { job_id: string }
      if (!job_id) throw new Error('Railway /synthesize-audio: no job_id in response')

      // D. Spend credits after job confirmed created — mirrors sync (spend after Storage upload)
      await spendCredits(user.id, cost, `audio_${engine}`, project_id)

      // E. Record credits_charged for future refund if worker reports failure (handled in Step 4-5)
      const asyncServiceClient = createServiceClient()
      await asyncServiceClient.from('audio_jobs').update({ credits_charged: cost }).eq('id', job_id)

      void trackEvent(user.id, 'step_completed', { step: 'audio', engine, project_id, async: true })
      return NextResponse.json({ ok: true, job_id, status: 'pending' })
    }
    // ── Sync path: ElevenLabs / OpenAI / Google / APIHOST ────────────────────

    // Strip structural markers before TTS — they must not be spoken aloud.
    // Cost was already calculated from the original text length (correct behaviour:
    // user pays for the script they wrote, not the stripped version).
    const stripped = stripSectionMarkers(text)
    // Normalize abbreviations, symbols, and numbers — only for user-typed text (own_script).
    // AI-generated scripts already pass through TTS-friendly rules in the script prompt.
    const ttsText = own_script
      ? await normalizeTtsText(stripped, script_lang)
      : stripped

    let audioBuffer: Buffer
    const { maxChars, measureBytes } = CHUNK_LIMITS[engine]
    const chunks = splitTextIntoChunks(ttsText, maxChars, measureBytes)

    if (chunks.length > 1) {
      console.log(`[generate/audio] ${engine}: ${chunks.length} chunks for ${chars} chars`)
    }

    if (engine === 'openai') {
      const openaiKey = env('OPENAI_API_KEY')
      if (!openaiKey) {
        return NextResponse.json({ ok: false, error: `Движок ${ENGINE_DISPLAY.openai.name} временно недоступен` }, { status: 503 })
      }

      const buffers: Buffer[] = []
      for (let i = 0; i < chunks.length; i++) {
        try {
          buffers.push(await synthesizeOpenAIChunk(chunks[i], voice_id, openaiKey))
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`[generate/audio] OpenAI chunk ${i + 1}/${chunks.length} failed:`, msg)
          return NextResponse.json({ ok: false, error: `Ошибка синтеза речи ${ENGINE_DISPLAY.openai.name} (фрагмент ${i + 1}/${chunks.length})` }, { status: 502 })
        }
      }
      audioBuffer = Buffer.concat(buffers.map((b, i) => i === 0 ? b : stripId3Tag(b)))

    } else if (engine === 'google') {
      const googleKey = env('GOOGLE_TTS_API_KEY')
      if (!googleKey) {
        return NextResponse.json({ ok: false, error: `Движок ${ENGINE_DISPLAY.google.name} временно недоступен` }, { status: 503 })
      }

      // Extract BCP-47 language code from voice name (e.g. "ru-RU-Standard-A" → "ru-RU")
      const langCode = voice_id.split('-').slice(0, 2).join('-') || 'ru-RU'

      const buffers: Buffer[] = []
      for (let i = 0; i < chunks.length; i++) {
        try {
          buffers.push(await synthesizeGoogleChunk(chunks[i], voice_id, langCode, googleKey))
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`[generate/audio] Google chunk ${i + 1}/${chunks.length} failed:`, msg)
          return NextResponse.json({ ok: false, error: `Ошибка синтеза речи ${ENGINE_DISPLAY.google.name} (фрагмент ${i + 1}/${chunks.length})` }, { status: 502 })
        }
      }
      audioBuffer = Buffer.concat(buffers.map((b, i) => i === 0 ? b : stripId3Tag(b)))

    } else if (engine === 'apihost') {
      const apihostKey = env('APIHOST_API_KEY')
      const apihostHeaders: Record<string, string> = {
        Authorization: `Bearer ${apihostKey}`,
        'Content-Type': 'application/json',
      }
      const apihostOpts = {
        lang: apihost_lang,
        rate: String(speech_rate),
        pitch: String(apihost_pitch),
      }

      // Submit all chunks in parallel (one APIHOST job per chunk)
      let processIds: string[]
      try {
        processIds = await Promise.all(
          chunks.map((chunk, i) =>
            submitApihostJob(chunk, voice_id, apihostOpts, apihostHeaders).catch(e => {
              throw new Error(`chunk ${i + 1}/${chunks.length} submit: ${e instanceof Error ? e.message : String(e)}`)
            })
          )
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[generate/audio] APIHOST submit failed:', msg)
        return NextResponse.json({ ok: false, error: `Ошибка отправки задачи ${ENGINE_DISPLAY.apihost.name} (${msg})` }, { status: 502 })
      }

      // Poll all jobs in parallel (each within 270s timeout)
      let audioUrls: string[]
      try {
        audioUrls = await Promise.all(
          processIds.map((pid, i) =>
            pollApihostJob(pid, apihostHeaders).catch(e => {
              throw new Error(`chunk ${i + 1}/${chunks.length}: ${e instanceof Error ? e.message : String(e)}`)
            })
          )
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[generate/audio] APIHOST poll failed:', msg)
        return NextResponse.json({ ok: false, error: `${ENGINE_DISPLAY.apihost.name} синтез не завершился вовремя (${msg})` }, { status: 504 })
      }

      // Download all audio files in parallel
      let buffers: Buffer[]
      try {
        buffers = await Promise.all(
          audioUrls.map(async (url, i) => {
            const dlRes = await fetch(url)
            if (!dlRes.ok) throw new Error(`chunk ${i + 1} download HTTP ${dlRes.status}`)
            return Buffer.from(await dlRes.arrayBuffer())
          })
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[generate/audio] APIHOST download failed:', msg)
        return NextResponse.json({ ok: false, error: `Ошибка загрузки аудио с ${ENGINE_DISPLAY.apihost.name} (${msg})` }, { status: 502 })
      }

      audioBuffer = Buffer.concat(buffers.map((b, i) => i === 0 ? b : stripId3Tag(b)))

    } else {
      // ElevenLabs
      const styleExaggeration = typeof voice_style === 'number'
        ? voice_style
        : STYLE_EXAGGERATION[voice_style] ?? 0

      const elevenSettings = {
        stability,
        similarity_boost,
        style: styleExaggeration,
        use_speaker_boost: clarity_boost,
      }

      const buffers: Buffer[] = []
      for (let i = 0; i < chunks.length; i++) {
        try {
          buffers.push(await synthesizeElevenLabsChunk(chunks[i], voice_id, elevenSettings))
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`[generate/audio] ElevenLabs chunk ${i + 1}/${chunks.length} failed:`, msg)
          return NextResponse.json({ ok: false, error: `Ошибка синтеза речи ${ENGINE_DISPLAY.elevenlabs.name} (фрагмент ${i + 1}/${chunks.length})` }, { status: 502 })
        }
      }
      audioBuffer = Buffer.concat(buffers.map((b, i) => i === 0 ? b : stripId3Tag(b)))
    }

    if (audioBuffer.byteLength === 0) {
      return NextResponse.json({ ok: false, error: 'Получен пустой аудио буфер' }, { status: 502 })
    }

    // Upload to Supabase Storage
    const serviceClient = createServiceClient()
    const storagePath = `${user.id}/${project_id ?? 'tmp'}/audio.mp3`

    const { error: uploadError } = await serviceClient.storage
      .from('audio')
      .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true })

    if (uploadError) {
      console.error('[generate/audio] Supabase upload error:', uploadError.message)
      return NextResponse.json({ ok: false, error: 'Ошибка загрузки аудио' }, { status: 500 })
    }

    const { data: { publicUrl } } = serviceClient.storage.from('audio').getPublicUrl(storagePath)

    await spendCredits(user.id, cost, `audio_${engine}`, project_id)

    if (project_id) {
      await supabase
        .from('projects')
        .update({
          audio_url: publicUrl,
          voice_id,
          status: 'draft',
          ...(own_script && text ? { script: text } : {}),
        })
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    void trackEvent(user.id, 'step_completed', { step: 'audio', engine, project_id, chunks: chunks.length })
    // DB stores the clean URL (publicUrl). The response adds ?v= so the browser
    // treats each generation as a distinct resource and doesn't replay cached audio.
    return NextResponse.json({ ok: true, data: { audio_url: `${publicUrl}?v=${Date.now()}` } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[generate/audio] unexpected error:', msg)
    Sentry.captureException(error)
    await notifyError('/generate/audio', msg).catch(() => {})
    return NextResponse.json({ ok: false, error: 'Ошибка генерации аудио' }, { status: 500 })
  }
}
