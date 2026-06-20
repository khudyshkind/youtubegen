import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { fal } from '@fal-ai/client'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { hasCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { CREDIT_COSTS } from '@/lib/types'
import type { SceneImage, SubtitleBlock } from '@/lib/types'

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

  const groups = splitSubtitlesIntoGroups(subtitleBlocks, imageCount)

  const scenesWithText = groups.map((group, i) => {
    const start = group.length > 0 ? group[0].start : (durationSec / imageCount) * i
    const end = group.length > 0 ? group[group.length - 1].end : (durationSec / imageCount) * (i + 1)
    const text = group.map((b) => b.text).join(' ').trim() || `Сцена ${i + 1}`
    return { start, end, text }
  })

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2500,
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

async function generateScenesFromScript(
  script: string,
  topic: string,
  durationSec: number,
  imageCount: number,
): Promise<SceneInfo[]> {
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2500,
    messages: [{
      role: 'user',
      content: `Ты режиссёр-постановщик YouTube видео на тему "${topic}". Видео длится ${durationSec} секунд.

Раздели сценарий ниже ровно на ${imageCount} визуальных сцен по СМЫСЛУ (не механически, не по символам).
Для каждой сцены напиши конкретный английский промпт для генерации иллюстрации через AI.

ТРЕБОВАНИЯ К ПРОМПТАМ:
- Только конкретные визуальные образы: предметы, люди, места, действия
- Никаких абстракций («концепция», «идея», «символ»)
- Cinematic lighting, photorealistic, 25–35 слов
- Без текста, надписей, логотипов на картинке
- Описывай что ИМЕННО изображено, как будто объясняешь художнику

СЦЕНАРИЙ:
${script.slice(0, 6000)}

Ответь ТОЛЬКО валидным JSON массивом без markdown-обёрток:
[
  {
    "scene": "Краткое описание по-русски что происходит в этой части",
    "timecode_start": "00:00",
    "timecode_end": "00:30",
    "prompt": "Precise English visual prompt for image generation"
  }
]`,
    }],
  })

  const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
  const cleaned = rawText.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()

  let scenes: SceneInfo[] = JSON.parse(cleaned)

  if (scenes.length > imageCount) scenes = scenes.slice(0, imageCount)
  while (scenes.length < imageCount) {
    scenes.push({
      scene: `Сцена ${scenes.length + 1}`,
      timecode_start: '00:00',
      timecode_end: '00:00',
      prompt: `Cinematic scene related to ${topic}, dramatic lighting, photorealistic, wide shot`,
    })
  }

  return scenes
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

    const { script, topic, duration_sec, image_count, project_id, image_interval, subtitle_blocks, engine = 'flux' }: ImagesRequest =
      await request.json()

    if (!script?.trim() || !topic?.trim()) {
      return NextResponse.json({ ok: false, error: 'script и topic обязательны' }, { status: 400 })
    }

    const count = Math.max(1, Math.min(20, image_count ?? 1))
    const interval = Math.max(3, Math.min(30, image_interval ?? 10))
    const costPerImage = engine === 'gpt_mini' ? CREDIT_COSTS.image_gpt_mini : CREDIT_COSTS.image_flux
    const totalCost = costPerImage * count

    const enough = await hasCredits(user.id, totalCost, supabase)
    if (!enough) {
      return NextResponse.json({ ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }, { status: 402 })
    }

    const hasSubtitles = Array.isArray(subtitle_blocks) && subtitle_blocks.length > 0
    console.log(`[generate/images] engine=${engine} mode=${hasSubtitles ? 'whisper-timecodes' : 'script-fallback'} count=${count}`)

    const scenes = hasSubtitles
      ? await generateScenesFromSubtitles(topic, count, duration_sec, subtitle_blocks!)
      : await generateScenesFromScript(script, topic, duration_sec, count)

    console.log('[generate/images] timecodes:', scenes.map((s) => `${s.timecode_start}–${s.timecode_end}`))

    const serviceClient = createServiceClient()
    const sceneImages: SceneImage[] = []

    for (let i = 0; i < scenes.length; i++) {
      const { scene, timecode_start, timecode_end, prompt } = scenes[i]

      const url = engine === 'gpt_mini'
        ? await generateImageGptMini(prompt, user.id, project_id, i, serviceClient)
        : await generateImageFlux(prompt, user.id, project_id, i, serviceClient)

      sceneImages.push({ scene_index: i, prompt, url, scene, timecode_start, timecode_end })
      await spendCredits(user.id, costPerImage, `image_${engine}`, project_id)
    }

    if (project_id) {
      await supabase
        .from('projects')
        .update({ scene_images: sceneImages, image_interval: interval, status: 'generating_video' })
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ ok: true, data: { scene_images: sceneImages } })
  } catch (error) {
    console.error('[generate/images]', error)
    return NextResponse.json({ ok: false, error: 'Ошибка генерации иллюстраций' }, { status: 500 })
  }
}
