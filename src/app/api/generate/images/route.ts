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

// Robust JSON array extractor — handles trailing text/explanation after the array
function parseJsonArray(text: string): unknown[] {
  const cleaned = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
  try {
    const v = JSON.parse(cleaned)
    return Array.isArray(v) ? v : []
  } catch {
    // Claude sometimes appends explanatory text after the JSON — extract the array only
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) return []
    try {
      const v = JSON.parse(match[0])
      return Array.isArray(v) ? v : []
    } catch { return [] }
  }
}

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
• LIGHTING — be specific: "soft diffused overcast light", "dramatic rim lighting from behind", "warm amber lamplight from lower-left", "cold blue moonlight with hard shadows" — never just "good lighting"
• COMPOSITION — specify the shot type: "extreme close-up filling the frame", "wide establishing shot", "low-angle looking up at subject", "bird's-eye overhead view", "Dutch tilt medium shot"
• MOOD — convey the emotional tone of the scene: "tense and claustrophobic", "serene and meditative", "chaotic and energetic", "eerie and mysterious"
• Prompts must be in English — AI image generators perform better with English prompts
• Target 40–60 words per prompt — enough detail for precise generation

═══ FEW-SHOT QUALITY EXAMPLES ═══

Scene — octopus hunting in the dark:
❌ Weak:   "An octopus in the ocean catching prey"
✓ Strong: "A reddish-brown octopus with textured mottled skin and large glowing amber eyes stretching a tentacle toward a fleeing silver fish, extreme close-up from below, dramatic deep-sea bioluminescent blue-green lighting with darkness at edges, tense and predatory atmosphere"

Scene — person researching in a library:
❌ Weak:   "A person reading old books"
✓ Strong: "Weathered hands turning pages of an aged leather-bound open book on a worn oak desk covered in scattered papers, warm incandescent amber lamplight casting soft left-side shadows, shallow depth of field with book spines blurred in background, contemplative and scholarly atmosphere"

Scene — vast ocean abyss:
❌ Weak:   "The deep ocean"
✓ Strong: "Vast dark ocean abyss stretching downward into blackness, wide establishing shot from above looking straight down, isolated beam of cold blue light piercing the darkness with tiny silhouettes of fish at different depths, awe-inspiring and vertiginous atmosphere"

═══ CHARACTER CONSISTENCY RULES ═══
If CHARACTER PROFILES are provided in the user message:
• Determine which characters are PHYSICALLY PRESENT (visible, actively participating) in each scene — not just mentioned in narration
• Copy character profile descriptions VERBATIM into the prompt for every scene they appear in
• Never paraphrase or vary the character description — exact repetition ensures visual consistency
• If two characters are both present in one scene — include BOTH descriptions in that prompt
• If a scene contains no characters from the profiles — write the prompt normally without any character description

═══ STYLE CONSISTENCY RULES ═══
• Every prompt MUST follow the style instruction provided in the user message
• Apply the style consistently across all scenes — do not switch between styles
• If the style requires photorealism — write photographic descriptions
• If the style requires illustration — describe as an artist would
• If the style requires a specific era or atmosphere — convey it in every prompt

═══ QUALITY AND VARIETY ═══
• Each scene must have a UNIQUE visual image — do not repeat the same objects or compositions
• Vary scale across scenes: extreme close-up detail → medium character shot → wide establishing shot
• Vary camera angle: eye level → low angle → bird's-eye → Dutch tilt

═══ RESPONSE FORMAT ═══
Respond ONLY with a valid JSON array without markdown wrappers.
The number of elements must exactly match the number of scenes in the request.
Format of each element: {"scene": "Description in content language", "prompt": "English prompt"}`

interface CharacterProfile {
  name: string
  description: string
}

async function extractCharacters(
  fullText: string,
  topic: string,
  anthropic: Anthropic,
): Promise<CharacterProfile[]> {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Analyze this video script about "${topic}". Identify all visual characters (animals, creatures, people, beings) that will be DEPICTED or SHOWN in at least 2 different scene illustrations.

IMPORTANT: If the video is about a specific animal, creature, or person — even in an educational or factual format — that subject IS a recurring visual character. Include it.

For each recurring character, write a concise 15–25 word ENGLISH visual description: species/type, distinctive color, key physical features, size/scale.

Rules:
- Include ANY creature/animal/person that appears visually in 2+ scenes, even as the sole subject of narration
- Return [] ONLY if each scene depicts COMPLETELY DIFFERENT subjects with no visual repeats (e.g. a nature documentary showing a different unrelated species every scene)
- Maximum 4 characters
- Descriptions must be purely visual — no personality, behavior, or story context

Respond ONLY with valid JSON, no markdown:
[{"name": "name or species as used in script", "description": "english visual description"}]

Script (first 3000 chars):
${fullText.slice(0, 3000)}`,
      }],
    })
    const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '[]'
    return (parseJsonArray(raw) as CharacterProfile[]).slice(0, 4)
  } catch (e) {
    console.error('[images] extractCharacters failed:', e instanceof Error ? e.message : e)
    return []
  }
}

type ImageEngine = 'flux' | 'flux_schnell' | 'gpt_mini'

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

// Max scenes per Claude call to stay within 8192-token output limit.
// 75 scenes × ~80 tokens ≈ 6000 tokens — safe headroom.
const CLAUDE_CHUNK = 75

async function generateScenesFromSubtitles(
  topic: string,
  imageCount: number,
  durationSec: number,
  subtitleBlocks: SubtitleBlock[],
  styleConfig: StyleConfig,
): Promise<SceneInfo[]> {
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

  const groups = splitSubtitlesIntoGroups(subtitleBlocks, imageCount)
  const scenesWithText = groups.map((group, i) => {
    const start = group.length > 0 ? group[0].start : (durationSec / imageCount) * i
    const end = group.length > 0 ? group[group.length - 1].end : (durationSec / imageCount) * (i + 1)
    const text = group.map((b) => b.text).join(' ').trim() || `Сцена ${i + 1}`
    return { start, end, text }
  })

  const fullText = subtitleBlocks.map((b) => b.text).join(' ')
  const characters = await extractCharacters(fullText, topic, anthropic)
  const charSection = characters.length > 0
    ? `\nПЕРСОНАЖИ — включать точные описания в промпты для сцен где они присутствуют:\n${characters.map((c) => `• ${c.name}: ${c.description}`).join('\n')}\n`
    : ''

  console.log(`[images/subtitles] claude style instruction: "${styleConfig.claudeInstruction}"`)
  console.log(`[images/subtitles] characters found: ${characters.length}${characters.length > 0 ? ` (${characters.map(c => c.name).join(', ')})` : ''}`)
  console.log(`[images/subtitles] scenes: ${scenesWithText.length}, chunks: ${Math.ceil(scenesWithText.length / CLAUDE_CHUNK)}`)

  const allPromptResults: Array<{ scene: string; prompt: string }> = []
  for (let chunkStart = 0; chunkStart < scenesWithText.length; chunkStart += CLAUDE_CHUNK) {
    const chunk = scenesWithText.slice(chunkStart, chunkStart + CLAUDE_CHUNK)
    const chunkSize = chunk.length
    const maxTokens = Math.max(2500, chunkSize * 100)
    const chunkNum = Math.floor(chunkStart / CLAUDE_CHUNK) + 1

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: [{ type: 'text', text: SCENES_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Видео на тему: "${topic}". Ниже — ${chunkSize} сцен из реальной расшифровки аудио (Whisper).

СТИЛЬ ИЛЛЮСТРАЦИЙ (соблюдать в каждом промте):
${styleConfig.claudeInstruction}
${charSection}
СЦЕНЫ:
${chunk.map((s, i) => `Сцена ${chunkStart + i + 1} [${fmtSec(s.start)}–${fmtSec(s.end)}]: "${s.text}"`).join('\n')}

Ответь JSON массивом ровно ${chunkSize} элементов.`,
      }],
    })
    console.log(`[images/subtitles] chunk ${chunkNum} tokens — input:${message.usage.input_tokens} cache_read:${message.usage.cache_read_input_tokens ?? 0}`)

    const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
    const chunkResults = parseJsonArray(rawText) as Array<{ scene: string; prompt: string }>
    allPromptResults.push(...chunkResults)
  }

  let promptResults = allPromptResults
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

  const blocks = splitScriptByWords(script, imageCount)
  const blocksWithTimecodes = calculateTimecodes(blocks, durationSec)

  const characters = await extractCharacters(script, topic, anthropic)
  const charSection = characters.length > 0
    ? `\nПЕРСОНАЖИ — включать точные описания в промпты для сцен где они присутствуют:\n${characters.map((c) => `• ${c.name}: ${c.description}`).join('\n')}\n`
    : ''

  console.log(`[images/script] claude style instruction: "${styleConfig.claudeInstruction}"`)
  console.log(`[images/script] characters found: ${characters.length}${characters.length > 0 ? ` (${characters.map(c => c.name).join(', ')})` : ''}`)
  console.log(`[images/script] scenes: ${blocksWithTimecodes.length}, chunks: ${Math.ceil(blocksWithTimecodes.length / CLAUDE_CHUNK)}`)

  const allPromptResults: Array<{ scene: string; prompt: string }> = []
  for (let chunkStart = 0; chunkStart < blocksWithTimecodes.length; chunkStart += CLAUDE_CHUNK) {
    const chunk = blocksWithTimecodes.slice(chunkStart, chunkStart + CLAUDE_CHUNK)
    const chunkSize = chunk.length
    const maxTokens = Math.max(2500, chunkSize * 100)
    const chunkNum = Math.floor(chunkStart / CLAUDE_CHUNK) + 1

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: [{ type: 'text', text: SCENES_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Видео на тему: "${topic}". Ниже — ${chunkSize} отрывков сценария с тайм-кодами.

СТИЛЬ ИЛЛЮСТРАЦИЙ (соблюдать в каждом промте):
${styleConfig.claudeInstruction}
${charSection}
ОТРЫВКИ:
${chunk.map((b, i) => `Сцена ${chunkStart + i + 1} [${fmtSec(b.start)}–${fmtSec(b.end)}]:\n"${b.text.slice(0, 400)}"`).join('\n\n')}

Ответь JSON массивом ровно ${chunkSize} элементов.`,
      }],
    })
    console.log(`[images/script] chunk ${chunkNum} tokens — input:${message.usage.input_tokens} cache_read:${message.usage.cache_read_input_tokens ?? 0}`)

    const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
    const chunkResults = parseJsonArray(rawText) as Array<{ scene: string; prompt: string }>
    allPromptResults.push(...chunkResults)
  }

  let promptResults = allPromptResults
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

async function generateImageFluxSchnell(
  prompt: string,
  userId: string,
  projectId: string | undefined,
  sceneIndex: number,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<string | null> {
  fal.config({ credentials: env('FAL_KEY') })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (fal.subscribe as any)('fal-ai/flux/schnell', {
    input: {
      prompt: `${prompt}, NO TEXT, NO WATERMARKS`,
      image_size: { width: 1280, height: 720 },
      num_images: 1,
    },
  }) as { data: FalImageResult }

  const falUrl = result.data?.images?.[0]?.url ?? null
  if (!falUrl) throw new Error('Flux Schnell: no image returned')
  if (!projectId) return falUrl

  const storagePath = `${userId}/${projectId}/scene_schnell_${sceneIndex}.jpg`
  const imgResponse = await fetch(falUrl)
  if (imgResponse.ok) {
    const { error: uploadError } = await serviceClient.storage
      .from('images')
      .upload(storagePath, await imgResponse.arrayBuffer(), { contentType: 'image/jpeg', upsert: true })
    if (!uploadError) {
      const { data: { publicUrl } } = serviceClient.storage.from('images').getPublicUrl(storagePath)
      return publicUrl
    }
  }
  return falUrl
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

// Parse "Please try again in Xs" from OpenAI 429 error message
function parseRetryAfterMs(msg: string): number {
  const match = msg.match(/try again in (\d+(?:\.\d+)?)s/i)
  return match ? Math.ceil(parseFloat(match[1])) * 1000 + 3000 : 0
}

async function generateImageGptMini(
  prompt: string,
  userId: string,
  projectId: string | undefined,
  sceneIndex: number,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<string | null> {
  const MAX_RETRIES = 6
  let lastError = ''

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const retryAfterMs = parseRetryAfterMs(lastError)
      const expDelay = Math.min(2000 * 2 ** (attempt - 1), 60000)
      const delay = Math.max(retryAfterMs, expDelay)
      console.log(`[gpt_mini] scene ${sceneIndex} retry ${attempt}/${MAX_RETRIES} after ${delay}ms (${lastError.slice(0, 80)})`)
      await new Promise(r => setTimeout(r, delay))
    }

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
      lastError = msg
      if (msg.toLowerCase().includes('verif')) {
        throw new Error('GPT Image: требуется верификация организации OpenAI (platform.openai.com/settings/organization/general → Verify Organization)')
      }
      // Retry on rate limit (429) or server errors (5xx)
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) continue
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

  throw new Error(`GPT Image: max retries exceeded (${lastError})`)
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
  const costPerImage =
    engine === 'gpt_mini'     ? CREDIT_COSTS.image_gpt_mini :
    engine === 'flux_schnell' ? CREDIT_COSTS.image_flux_schnell :
    CREDIT_COSTS.image_flux
  const totalCost = costPerImage * count

  if (engine === 'gpt_mini' && count > 20) {
    return NextResponse.json({
      ok: false,
      code: 'TOO_MANY_FOR_GPT_MINI',
      error: 'GPT Image поддерживает максимум 20 иллюстраций за запуск',
      maxAllowed: 20,
      requested: count,
    }, { status: 400 })
  }

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

        const GPT_BATCH_SIZE = parseInt(process.env.GPT_BATCH_SIZE ?? '3')
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
                  : engine === 'flux_schnell'
                  ? await generateImageFluxSchnell(styledPrompt, user.id, project_id, i, serviceClient)
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
            .update({ scene_images: validImages, image_interval: interval, image_style: image_style ?? null, status: 'generating_video' })
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
