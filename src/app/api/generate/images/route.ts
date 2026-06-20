import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { fal } from '@fal-ai/client'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { hasCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { CREDIT_COSTS } from '@/lib/types'
import type { SceneImage, SubtitleBlock } from '@/lib/types'

export const maxDuration = 300

type ImageEngine = 'flux' | 'gpt_mini'

interface ImagesRequest {
  script: string
  topic: string
  duration_sec: number
  image_count: number
  project_id?: string
  image_interval?: number
  subtitle_blocks?: SubtitleBlock[]
  engine?: ImageEngine
  image_style?: string
}

interface FalImageResult {
  images: Array<{ url: string }>
}

interface SceneInfo {
  scene: string
  timecode_start: string
  timecode_end: string
  prompt: string
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function splitSubtitlesIntoGroups(blocks: SubtitleBlock[], n: number): SubtitleBlock[][] {
  const groups: SubtitleBlock[][] = Array.from({ length: n }, () => [])
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

async function generateScenesFromSubtitles(
  topic: string,
  imageCount: number,
  durationSec: number,
  subtitleBlocks: SubtitleBlock[],
): Promise<SceneInfo[]> {
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
  // 77 scenes × ~70 tokens/scene = ~5400 tokens; cap at Haiku max 8192
  const maxTokens = Math.min(8192, Math.max(2500, imageCount * 80))

  const groups = splitSubtitlesIntoGroups(subtitleBlocks, imageCount)

  const scenesWithText = groups.map((group, i) => {
    const start = group.length > 0 ? group[0].start : (durationSec / imageCount) * i
    const end = group.length > 0 ? group[group.length - 1].end : (durationSec / imageCount) * (i + 1)
    const text = group.map((b) => b.text).join(' ').trim() || `Сцена ${i + 1}`
    return { start, end, text }
  })

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: `Ты режиссёр-постановщик YouTube видео на тему "${topic}".
Ниже — ${imageCount} сцен видео с текстом из реального аудио (расшифровка Whisper).
Для каждой сцены напиши:
1. scene — краткое русское описание того что происходит
2. prompt — конкретный английский промпт для генерации иллюстрации через AI

ТРЕБОВАНИЯ К ПРОМПТАМ:
- Только конкретные визуальные образы: предметы, люди, места, действия
- Никаких абстракций («концепция», «идея», «символ»)
- Cinematic lighting, photorealistic, 25–35 слов
- Без текста, надписей, логотипов

СЦЕНЫ:
${scenesWithText.map((s, i) => `Сцена ${i + 1} [${fmtSec(s.start)}–${fmtSec(s.end)}]: "${s.text}"`).join('\n')}

Ответь ТОЛЬКО валидным JSON массивом (ровно ${imageCount} элементов) без markdown-обёрток:
[{"scene": "Русское описание", "prompt": "English prompt"}]`,
    }],
  })

  const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
  const cleaned = rawText.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()

  let promptResults: Array<{ scene: string; prompt: string }> = JSON.parse(cleaned)
  if (promptResults.length > imageCount) promptResults = promptResults.slice(0, imageCount)
  while (promptResults.length < imageCount) {
    promptResults.push({
      scene: `Сцена ${promptResults.length + 1}`,
      prompt: `Cinematic scene related to ${topic}, dramatic lighting, photorealistic, wide shot`,
    })
  }

  return promptResults.map((p, i) => ({
    ...p,
    timecode_start: fmtSec(scenesWithText[i].start),
    timecode_end: fmtSec(scenesWithText[i].end),
  }))
}

function splitScriptByWords(script: string, n: number): string[] {
  const sentences = script.split(/(?<=[.!?…])\s+/).filter((s) => s.trim())
  if (sentences.length === 0) return [script]

  const totalWords = script.split(/\s+/).filter(Boolean).length
  const wordsPerBlock = totalWords / n

  const blocks: string[] = []
  let currentBlock: string[] = []
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

  // Pad if too few blocks (e.g. very short script with few sentences)
  while (blocks.length < n) blocks.push(blocks[blocks.length - 1] ?? script)

  return blocks.slice(0, n)
}

interface BlockWithTimecode {
  start: number
  end: number
  text: string
}

function calculateTimecodes(blocks: string[], totalDurationSec: number): BlockWithTimecode[] {
  const counts = blocks.map((b) => b.split(/\s+/).filter(Boolean).length)
  const total = counts.reduce((a, b) => a + b, 0) || 1
  let currentTime = 0
  return blocks.map((text, i) => {
    const duration = (counts[i] / total) * totalDurationSec
    const start = currentTime
    currentTime += duration
    return { start, end: currentTime, text }
  })
}

async function generateScenesFromScript(
  script: string,
  topic: string,
  durationSec: number,
  imageCount: number,
): Promise<SceneInfo[]> {
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
  const maxTokens = Math.min(8192, Math.max(2500, imageCount * 80))

  const blocks = splitScriptByWords(script, imageCount)
  const blocksWithTimecodes = calculateTimecodes(blocks, durationSec)

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: `Ты режиссёр-постановщик YouTube видео на тему "${topic}".
Ниже — ${imageCount} отрывков сценария с уже вычисленными тайм-кодами.
Для каждого отрывка напиши:
1. scene — краткое русское описание того что происходит
2. prompt — конкретный английский промпт для генерации иллюстрации через AI

ТРЕБОВАНИЯ К ПРОМПТАМ:
- Только конкретные визуальные образы: предметы, люди, места, действия
- Никаких абстракций («концепция», «идея», «символ»)
- Cinematic lighting, photorealistic, 25–35 слов
- Без текста, надписей, логотипов

ОТРЫВКИ:
${blocksWithTimecodes.map((b, i) => `Сцена ${i + 1} [${fmtSec(b.start)}–${fmtSec(b.end)}]:\n"${b.text.slice(0, 400)}"`).join('\n\n')}

Ответь ТОЛЬКО валидным JSON массивом (ровно ${imageCount} элементов) без markdown-обёрток:
[{"scene": "Русское описание", "prompt": "English prompt"}]`,
    }],
  })

  const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
  const cleaned = rawText.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()

  let promptResults: Array<{ scene: string; prompt: string }> = JSON.parse(cleaned)
  if (promptResults.length > imageCount) promptResults = promptResults.slice(0, imageCount)

  while (promptResults.length < imageCount) {
    const i = promptResults.length
    promptResults.push({
      scene: blocksWithTimecodes[i]?.text.slice(0, 80).trim() ?? `Сцена ${i + 1}`,
      prompt: `Cinematic scene related to ${topic}, dramatic lighting, photorealistic, wide shot`,
    })
  }

  return promptResults.map((p, i) => ({
    ...p,
    timecode_start: fmtSec(blocksWithTimecodes[i].start),
    timecode_end: fmtSec(blocksWithTimecodes[i].end),
  }))
}

async function generateImageFlux(
  prompt: string,
  userId: string,
  projectId: string | undefined,
  sceneIndex: number,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<string | null> {
  fal.config({ credentials: env('FAL_KEY') })
  const result = await fal.subscribe('fal-ai/flux/dev', {
    input: {
      prompt: `${prompt}, NO TEXT, NO WATERMARKS`,
      image_size: { width: 1280, height: 720 },
      num_images: 1,
      num_inference_steps: 35,
    },
  }) as { data: FalImageResult }

  const imageUrl = result.data?.images?.[0]?.url ?? null
  if (!imageUrl) return null

  if (!projectId) return imageUrl

  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) return imageUrl

  const storagePath = `${userId}/${projectId}/scene_${sceneIndex}.jpg`
  const { error: uploadError } = await serviceClient.storage
    .from('images')
    .upload(storagePath, await imgRes.arrayBuffer(), { contentType: 'image/jpeg', upsert: true })

  if (uploadError) return imageUrl
  const { data: { publicUrl } } = serviceClient.storage.from('images').getPublicUrl(storagePath)
  return publicUrl
}

async function generateImageGptMini(
  prompt: string,
  userId: string,
  projectId: string | undefined,
  sceneIndex: number,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<string | null> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1-mini',
      prompt: `${prompt}, NO TEXT, NO WATERMARKS`,
      size: '1536x1024',
      quality: 'medium',
      n: 1,
    }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(`GPT Image: ${data.error?.message ?? res.status}`)
  const base64 = data.data?.[0]?.b64_json
  if (!base64) throw new Error('GPT Image: no image data')

  const buffer = Buffer.from(base64, 'base64')

  if (!projectId) return null

  const storagePath = `${userId}/${projectId}/scene_${sceneIndex}.jpg`
  const { error: uploadError } = await serviceClient.storage
    .from('images')
    .upload(storagePath, buffer, { contentType: 'image/png', upsert: true })

  if (uploadError) throw new Error(`Storage upload error: ${uploadError.message}`)
  const { data: { publicUrl } } = serviceClient.storage.from('images').getPublicUrl(storagePath)
  return publicUrl
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const { script, topic, duration_sec, image_count, project_id, image_interval, subtitle_blocks, engine = 'flux', image_style }: ImagesRequest =
      await request.json()

    if (!script?.trim() || !topic?.trim()) {
      return NextResponse.json({ ok: false, error: 'script и topic обязательны' }, { status: 400 })
    }

    // Raised from 20 → 200; client sends the actual count, server no longer hard-caps
    const count = Math.max(1, Math.min(200, image_count ?? 1))
    const interval = Math.max(3, Math.min(30, image_interval ?? 10))
    const costPerImage = engine === 'gpt_mini' ? CREDIT_COSTS.image_gpt_mini : CREDIT_COSTS.image_flux
    const totalCost = costPerImage * count

    const enough = await hasCredits(user.id, totalCost, supabase)
    if (!enough) {
      return NextResponse.json({ ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }, { status: 402 })
    }

    const hasSubtitles = Array.isArray(subtitle_blocks) && subtitle_blocks.length > 0
    console.log(`[images] engine=${engine} mode=${hasSubtitles ? 'subtitle' : 'script'} count=${count}`)

    const scenes = hasSubtitles
      ? await generateScenesFromSubtitles(topic, count, duration_sec, subtitle_blocks!)
      : await generateScenesFromScript(script, topic, duration_sec, count)

    console.log(`[images] scenes generated: ${scenes.length}`)

    const serviceClient = createServiceClient()
    const sceneImages: SceneImage[] = new Array(scenes.length)
    let successCount = 0
    let failCount = 0

    // Generate in parallel batches of 5 to stay within rate limits and timeouts.
    // Sequential (1 at a time) × 77 images × ~7s = ~540s >> 300s Vercel limit.
    // Parallel 5 at a time × 16 rounds × ~7s = ~110s — safely within limit.
    const CONCURRENCY = 5
    for (let batchStart = 0; batchStart < scenes.length; batchStart += CONCURRENCY) {
      const batchEnd = Math.min(batchStart + CONCURRENCY, scenes.length)
      console.log(`[images] batch ${Math.floor(batchStart / CONCURRENCY) + 1}: scenes ${batchStart + 1}–${batchEnd} (success=${successCount} failed=${failCount})`)

      await Promise.all(
        scenes.slice(batchStart, batchEnd).map(async (scn, batchIdx) => {
          const i = batchStart + batchIdx
          const styledPrompt = image_style ? `${scn.prompt}, ${image_style}` : scn.prompt
          console.log(`[images] generating ${i + 1}/${scenes.length}`)
          try {
            const url = engine === 'gpt_mini'
              ? await generateImageGptMini(styledPrompt, user.id, project_id, i, serviceClient)
              : await generateImageFlux(styledPrompt, user.id, project_id, i, serviceClient)
            sceneImages[i] = { scene_index: i, prompt: styledPrompt, url, scene: scn.scene, timecode_start: scn.timecode_start, timecode_end: scn.timecode_end }
            successCount++
            await spendCredits(user.id, costPerImage, `image_${engine}`, project_id)
            console.log(`[images] OK ${i + 1}/${scenes.length} url=${url?.slice(0, 60)}`)
          } catch (err) {
            failCount++
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`[images] FAILED scene ${i + 1}:`, msg)
            sceneImages[i] = { scene_index: i, prompt: styledPrompt, url: null, scene: scn.scene, timecode_start: scn.timecode_start, timecode_end: scn.timecode_end }
          }
        })
      )
    }

    console.log(`[images] done: success=${successCount} failed=${failCount} total=${scenes.length}`)

    const validImages = sceneImages.filter(Boolean)
    if (project_id) {
      await supabase
        .from('projects')
        .update({ scene_images: validImages, image_interval: interval, status: 'generating_video' })
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ ok: true, data: { scene_images: validImages, success_count: successCount, fail_count: failCount } })
  } catch (error) {
    console.error('[generate/images]', error)
    return NextResponse.json({ ok: false, error: 'Ошибка генерации иллюстраций' }, { status: 500 })
  }
}
