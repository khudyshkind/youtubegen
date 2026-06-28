import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { trackEvent } from '@/lib/analytics'
import { audioCost } from '@/lib/types'
import type { AudioEngine, ApihostVoiceType } from '@/lib/types'
import { env } from '@/lib/env'

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
  secretvoicer: { maxChars: 295000, measureBytes: false }, // server handles large text natively; single chunk
  elevenlabs:   { maxChars: 4800, measureBytes: false }, // API limit 5000 chars
  openai:       { maxChars: 4000, measureBytes: false }, // API limit 4096 chars
  google:       { maxChars: 2300, measureBytes: true  }, // API limit 5000 bytes; Cyrillic 2 bytes/char
  apihost:      { maxChars: 4000, measureBytes: false }, // no hard limit; keeps each job < 60s synthesis
}

const SV_BASE = 'https://secret-voicer.ru/api/v1'

interface AudioRequest {
  engine?: AudioEngine
  text: string
  voice_id: string
  project_id?: string
  // ElevenLabs-specific
  stability?: number
  similarity_boost?: number
  speech_rate?: number
  voice_style?: string | number
  clarity_boost?: boolean
  paragraph_pauses?: boolean
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
  const TIMEOUT_MS = 240_000
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
      engine = 'elevenlabs',
      text,
      voice_id,
      project_id,
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

    const validEngines: AudioEngine[] = ['secretvoicer', 'elevenlabs', 'openai', 'google', 'apihost']
    if (!validEngines.includes(engine)) {
      return NextResponse.json({ ok: false, error: 'Неверный движок TTS' }, { status: 400 })
    }

    const chars = text.length
    const cost = Math.max(1, audioCost(chars, engine, apihost_voice_type))

    const check = await requireCreditsAmount(user.id, cost, supabase)
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    // Strip structural markers before TTS — they must not be spoken aloud.
    // Cost was already calculated from the original text length (correct behaviour:
    // user pays for the script they wrote, not the stripped version).
    const ttsText = stripSectionMarkers(text)

    let audioBuffer: Buffer
    const { maxChars, measureBytes } = CHUNK_LIMITS[engine]
    const chunks = splitTextIntoChunks(ttsText, maxChars, measureBytes)

    if (chunks.length > 1) {
      console.log(`[generate/audio] ${engine}: ${chunks.length} chunks for ${chars} chars`)
    }

    if (engine === 'openai') {
      const openaiKey = env('OPENAI_API_KEY')
      if (!openaiKey) {
        return NextResponse.json({ ok: false, error: 'OpenAI API key не настроен' }, { status: 503 })
      }

      const buffers: Buffer[] = []
      for (let i = 0; i < chunks.length; i++) {
        try {
          buffers.push(await synthesizeOpenAIChunk(chunks[i], voice_id, openaiKey))
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`[generate/audio] OpenAI chunk ${i + 1}/${chunks.length} failed:`, msg)
          return NextResponse.json({ ok: false, error: `Ошибка синтеза речи OpenAI (фрагмент ${i + 1}/${chunks.length})` }, { status: 502 })
        }
      }
      audioBuffer = Buffer.concat(buffers.map((b, i) => i === 0 ? b : stripId3Tag(b)))

    } else if (engine === 'google') {
      const googleKey = env('GOOGLE_TTS_API_KEY')
      if (!googleKey) {
        return NextResponse.json({ ok: false, error: 'Google TTS API key не настроен' }, { status: 503 })
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
          return NextResponse.json({ ok: false, error: `Ошибка синтеза речи Google (фрагмент ${i + 1}/${chunks.length})` }, { status: 502 })
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
        return NextResponse.json({ ok: false, error: `Ошибка отправки задачи APIHOST (${msg})` }, { status: 502 })
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
        return NextResponse.json({ ok: false, error: `APIHOST синтез не завершился вовремя (${msg})` }, { status: 504 })
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
        return NextResponse.json({ ok: false, error: `Ошибка загрузки аудио с APIHOST (${msg})` }, { status: 502 })
      }

      audioBuffer = Buffer.concat(buffers.map((b, i) => i === 0 ? b : stripId3Tag(b)))

    } else if (engine === 'secretvoicer') {
      const svKey = env('SECRETVOICER_API_KEY')
      if (!svKey) {
        return NextResponse.json({ ok: false, error: 'SecretVoicer API key не настроен' }, { status: 503 })
      }
      const styleExaggeration = typeof voice_style === 'number'
        ? voice_style
        : STYLE_EXAGGERATION[voice_style] ?? 0
      try {
        audioBuffer = await synthesizeSecretVoicerChunk(ttsText, voice_id, {
          stability,
          similarity: similarity_boost,
          style: styleExaggeration,
          speechRate: speech_rate,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[generate/audio] SecretVoicer failed:', msg)
        return NextResponse.json({ ok: false, error: `Ошибка синтеза речи SecretVoicer: ${msg.slice(0, 200)}` }, { status: 502 })
      }

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
          return NextResponse.json({ ok: false, error: `Ошибка синтеза речи ElevenLabs (фрагмент ${i + 1}/${chunks.length})` }, { status: 502 })
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
        .update({ audio_url: publicUrl, voice_id, status: 'generating_subtitles' })
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
    return NextResponse.json({ ok: false, error: 'Ошибка генерации аудио' }, { status: 500 })
  }
}
