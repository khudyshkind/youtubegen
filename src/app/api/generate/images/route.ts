import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { fal } from '@fal-ai/client'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { hasCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { CREDIT_COSTS } from '@/lib/types'
import type { SceneImage, SubtitleBlock } from '@/lib/types'
import { getStyleConfig } from '@/lib/image-style-configs'
import type { StyleConfig } from '@/lib/image-style-configs'

export const maxDuration = 300

const SCENES_SYSTEM_PROMPT = `You are a film director and art director for YouTube videos with extensive experience creating visual sequences for educational and entertainment content.

Your task: for each video scene, write a brief description of what is happening and a specific English prompt for generating an illustration via AI.

═══ SCENE DESCRIPTION REQUIREMENTS (field "scene") ═══
• Brief description (1-2 sentences) of what is happening at this moment in the video
• Describe the action, object, or concept that illustrates the scene
• Avoid abstractions — be specific and concrete
• Write the scene description in the same language as the video content

═══ PROMPT REQUIREMENTS (field "prompt") ═══
• Only concrete visual imagery: objects, people, places, actions, atmosphere
• No abstractions: do not write "concept", "idea", "symbol", "metaphor"
• No text, inscriptions, logos, or watermarks
• Prompt must fully match the specified style (passed separately in the user message)
• Use concrete nouns: "aged leather-bound book on wooden desk" not "knowledge"
• Specify lighting and atmosphere: "soft morning light", "dramatic shadows", "golden hour"
• Specify viewpoint when important: "close-up", "wide shot", "aerial view", "eye level"
• Prompts must be in English — AI image generators perform better with English prompts

═══ STYLE CONSISTENCY RULES ═══
• Every prompt MUST follow the style instruction provided in the user message
• Apply the style consistently across all scenes — do not switch between styles
• If the style requires photorealism — write photographic descriptions
• If the style requires illustration — describe as an artist would
• If the style requires a specific era or atmosphere — convey it in every prompt

═══ QUALITY AND VARIETY ═══
• Each scene must have a UNIQUE visual image — do not repeat the same objects
• Vary scale: close-up detail → medium shot of character → wide shot of space
• Vary angle: frontal → side → top-down → bottom-up
• The prompt must be specific enough for the AI generator to create an accurate image
• Avoid overly generic prompts like "a person standing" — add details

═══ RESPONSE FORMAT ═══
Respond ONLY with a valid JSON array without markdown wrappers.
The number of elements must exactly match the number of scenes in the request.
Format of each element: {"scene": "Description in content language", "prompt": "English prompt"}`

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
  styleConfig: StyleConfig,
): Promise<SceneInfo[]> {
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
  const maxTokens = Math.min(8192, Math.max(2500, imageCount * 80))

  const groups = splitSubtitlesIntoGroups(subtitleBlocks, imageCount)

  const scenesWithText = groups.map((group, i) => {
    const start = group.length > 0 ? group[0].start : (durationSec / imageCount) * i
    const end = group.length > 0 ? group[group.length - 1].end : (durationSec / imageCount) * (i + 1)
    const text = group.map((b) => b.text).join(' ').trim() || `Сцена ${i + 1}`
    return { start, end, text }
  })

  console.log(`[images/subtitles] claude style instruction: "${styleConfig.claudeInstruction}"`)

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system: [{ type: 'text', text: SCENES_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: `Видео на тему: "${topic}". Ниже — ${imageCount} сцен из реальной расшифровки аудио (Whisper).

СТИЛЬ ИЛЛЮСТРАЦИЙ (соблюдать в каждом промте):
${styleConfig.claudeInstruction}

СЦЕНЫ:
${scenesWithText.map((s, i) => `Сцена ${i + 1} [${fmtSec(s.start)}–${fmtSec(s.end)}]: "${s.text}"`).join('\n')}

Ответь JSON массивом ровно ${imageCount} элементов.`,
    }],
  })
  console.log('[images/subtitles] cache input:', message.usage.input_tokens, 'cache_read:', message.usage.cache_read_input_tokens ?? 0, 'cache_write:', message.usage.cache_creation_input_tokens ?? 0)

  const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
  console.log(`[images/subtitles] claude raw response (first 600): ${rawText.slice(0, 600)}`)
  const cleaned = rawText.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()

  let promptResults: Array<{ scene: string; prompt: string }> = JSON.parse(cleaned)
  if (promptResults.length > imageCount) promptResults = promptResults.slice(0, imageCount)
  while (promptResults.length < imageCount) {
    promptResults.push({
      scene: `Сцена ${promptResults.length + 1}`,
      prompt: styleConfig.fallbackPrompt.replace('{topic}', topic),
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
  styleConfig: StyleConfig,
): Promise<SceneInfo[]> {
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
  const maxTokens = Math.min(8192, Math.max(2500, imageCount * 80))

  const blocks = splitScriptByWords(script, imageCount)
  const blocksWithTimecodes = calculateTimecodes(blocks, durationSec)

  console.log(`[images/script] claude style instruction: "${styleConfig.claudeInstruction}"`)

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system: [{ type: 'text', text: SCENES_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: `Видео на тему: "${topic}". Ниже — ${imageCount} отрывков сценария с тайм-кодами.

СТИЛЬ ИЛЛЮСТРАЦИЙ (соблюдать в каждом промте):
${styleConfig.claudeInstruction}

ОТРЫВКИ:
${blocksWithTimecodes.map((b, i) => `Сцена ${i + 1} [${fmtSec(b.start)}–${fmtSec(b.end)}]:\n"${b.text.slice(0, 400)}"`).join('\n\n')}

Ответь JSON массивом ровно ${imageCount} элементов.`,
    }],
  })
  console.log('[images/script] cache input:', message.usage.input_tokens, 'cache_read:', message.usage.cache_read_input_tokens ?? 0, 'cache_write:', message.usage.cache_creation_input_tokens ?? 0)

  const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
  console.log(`[images/script] claude raw response (first 600): ${rawText.slice(0, 600)}`)
  const cleaned = rawText.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()

  let promptResults: Array<{ scene: string; prompt: string }> = JSON.parse(cleaned)
  if (promptResults.length > imageCount) promptResults = promptResults.slice(0, imageCount)

  while (promptResults.length < imageCount) {
    const i = promptResults.length
    promptResults.push({
      scene: blocksWithTimecodes[i]?.text.slice(0, 80).trim() ?? `Сцена ${i + 1}`,
      prompt: styleConfig.fallbackPrompt.replace('{topic}', topic),
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
  negativePrompt: string,
  userId: string,
  projectId: string | undefined,
  sceneIndex: number,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<string | null> {
  fal.config({ credentials: env('FAL_KEY') })
  // negative_prompt is a valid Flux.dev API parameter but missing from the fal SDK type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (fal.subscribe as any)('fal-ai/flux/dev', {
    input: {
      prompt: `${prompt}, NO TEXT, NO WATERMARKS`,
      negative_prompt: negativePrompt,
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
      model: 'gpt-image-2',
      prompt: `${prompt}, NO TEXT, NO WATERMARKS`,
      size: '1536x1024',
      quality: 'medium',
      n: 1,
    }),
  })

  const data = await res.json()
  if (!res.ok) {
    const msg = data.error?.message ?? String(res.status)
    if (msg.toLowerCase().includes('verif')) {
      throw new Error('GPT Image: требуется верификация организации OpenAI (platform.openai.com/settings/organization/general → Verify Organization)')
    }
    throw new Error(`GPT Image: ${msg}`)
  }
  const base64 = data.data?.[0]?.b64_json
  if (!base64) throw new Error('GPT Image: no image data')

  const buffer = Buffer.from(base64, 'base64')

  // Log actual PNG dimensions from header (bytes 16-19 = width, 20-23 = height)
  const pngWidth  = buffer.length > 24 ? buffer.readUInt32BE(16) : 0
  const pngHeight = buffer.length > 24 ? buffer.readUInt32BE(20) : 0
  console.log(`[gpt_mini] scene ${sceneIndex} | requested size: 1536x1024 | actual: ${pngWidth}x${pngHeight} | buffer: ${buffer.byteLength} bytes`)

  if (!projectId) return null

  const storagePath = `${userId}/${projectId}/scene_gpt_${sceneIndex}.png`
  const { error: uploadError } = await serviceClient.storage
    .from('images')
    .upload(storagePath, buffer, { contentType: 'image/png', upsert: true })

  if (uploadError) throw new Error(`Storage upload error: ${uploadError.message}`)
  const { data: { publicUrl } } = serviceClient.storage.from('images').getPublicUrl(storagePath)
  return publicUrl
}

export async function POST(request: NextRequest) {
  // === Pre-stream checks — return plain JSON on failure ===
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

  const count = Math.max(1, Math.min(200, image_count ?? 1))
  const interval = Math.max(3, Math.min(300, image_interval ?? 10))
  const costPerImage = engine === 'gpt_mini' ? CREDIT_COSTS.image_gpt_mini : CREDIT_COSTS.image_flux
  const totalCost = costPerImage * count

  const enough = await hasCredits(user.id, totalCost, supabase)
  if (!enough) {
    return NextResponse.json({ ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }, { status: 402 })
  }

  const styleConfig = getStyleConfig(image_style)
  console.log(`[images] engine=${engine} style="${image_style ?? 'default'}" suffix="${styleConfig.fluxSuffix.slice(0, 60)}"`)

  // === SSE streaming — keeps the connection alive for the full generation ===
  const encoder = new TextEncoder()
  const send = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`)

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (project_id) {
          await supabase
            .from('projects')
            .update({ scene_images: [] })
            .eq('id', project_id)
            .eq('user_id', user.id)
        }

        const hasSubtitles = Array.isArray(subtitle_blocks) && subtitle_blocks.length > 0
        console.log(`[images] mode=${hasSubtitles ? 'subtitle' : 'script'} count=${count}`)

        const scenes = hasSubtitles
          ? await generateScenesFromSubtitles(topic, count, duration_sec, subtitle_blocks!, styleConfig)
          : await generateScenesFromScript(script, topic, duration_sec, count, styleConfig)

        console.log(`[images] scenes generated: ${scenes.length}`)

        // Tell the client how many images to expect so it can show a progress bar
        controller.enqueue(send({ type: 'start', total: scenes.length }))

        const serviceClient = createServiceClient()
        const sceneImages: SceneImage[] = new Array(scenes.length)
        let successCount = 0
        let failCount = 0

        const GPT_BATCH_SIZE = parseInt(process.env.GPT_BATCH_SIZE ?? '20')
        const CONCURRENCY = engine === 'gpt_mini'
          ? GPT_BATCH_SIZE
          : parseInt(process.env.FAL_CONCURRENCY_LIMIT ?? '40')
        console.log(`[images] engine: ${engine}, concurrency: ${CONCURRENCY}, total: ${scenes.length}`)
        for (let batchStart = 0; batchStart < scenes.length; batchStart += CONCURRENCY) {
          const batchEnd = Math.min(batchStart + CONCURRENCY, scenes.length)
          const batchNewImages: SceneImage[] = []
          console.log(`[images] batch ${Math.floor(batchStart / CONCURRENCY) + 1}: scenes ${batchStart + 1}–${batchEnd}`)

          await Promise.all(
            scenes.slice(batchStart, batchEnd).map(async (scn, batchIdx) => {
              const i = batchStart + batchIdx
              const styledPrompt = `${scn.prompt}, ${styleConfig.fluxSuffix}`
              console.log(`[images] scene ${i + 1} REQUESTED style: "${image_style ?? 'default'}"`)
              console.log(`[images] scene ${i + 1} claude prompt result: "${scn.prompt.slice(0, 120)}"`)
              console.log(`[images] scene ${i + 1} FINAL flux prompt: "${styledPrompt.slice(0, 180)}"`)
              console.log(`[images] scene ${i + 1} NEGATIVE prompt: "${styleConfig.negativePrompt}"`)
              try {
                const url = engine === 'gpt_mini'
                  ? await generateImageGptMini(styledPrompt, user.id, project_id, i, serviceClient)
                  : await generateImageFlux(styledPrompt, styleConfig.negativePrompt, user.id, project_id, i, serviceClient)
                const img: SceneImage = { scene_index: i, prompt: styledPrompt, url, scene: scn.scene, timecode_start: scn.timecode_start, timecode_end: scn.timecode_end, engine }
                sceneImages[i] = img
                successCount++
                if (url) batchNewImages.push(img)
                await spendCredits(user.id, costPerImage, `image_${engine}`, project_id)
                console.log(`[images] scene ${i + 1} RESULT url: ${url?.slice(0, 100) ?? 'NULL'}`)
              } catch (err) {
                failCount++
                const msg = err instanceof Error ? err.message : String(err)
                console.error(`[images] scene ${i + 1} FAILED:`, msg)
                sceneImages[i] = { scene_index: i, prompt: styledPrompt, url: null, scene: scn.scene, timecode_start: scn.timecode_start, timecode_end: scn.timecode_end, engine }
              }
            })
          )

          // Send progress after every batch so the client can update its UI immediately
          controller.enqueue(send({
            type: 'progress',
            completed: successCount + failCount,
            total: scenes.length,
            images: batchNewImages,
          }))
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

        controller.enqueue(send({
          type: 'done',
          images: validImages,
          success_count: successCount,
          fail_count: failCount,
        }))
        controller.close()
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[generate/images] stream error:', msg)
        try {
          controller.enqueue(send({ type: 'error', error: 'Ошибка генерации иллюстраций' }))
          controller.close()
        } catch { /* controller may already be closed on a second error */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
