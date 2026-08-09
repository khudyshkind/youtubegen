import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { fal } from '@fal-ai/client'
import * as Sentry from '@sentry/nextjs'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { hasCredits, spendCredits } from '@/lib/credits'
import { isBillingError, notifyBillingError, notifyError, notifyUserTelegram } from '@/lib/telegram'
import { env } from '@/lib/env'
import { CREDIT_COSTS, ENGINE_DISPLAY, IMAGE_COUNT_MAX } from '@/lib/types'
import type { SceneImage, SubtitleBlock } from '@/lib/types'
import { getStyleConfig, DEFAULT_STYLE_CONFIG } from '@/lib/image-style-configs'
import type { StyleConfig } from '@/lib/image-style-configs'
import _scenePrompts from '../../../../../video-server/image-scene-prompts.json'
import { mediaExpiryFromNow } from '@/lib/media-expiry'

export const maxDuration = 300

// ─── Supabase Storage upload helper with retry ───────────────────────────────
// Downloads from falUrl and uploads to Supabase Storage.
// Retries up to 3 times on transient network/upload failures.
// Throws on final failure so callers get url:null (honest hole) instead of a
// stale FAL CDN URL that will expire and break the video pipeline.
async function sleep(ms: number) { await new Promise((r) => setTimeout(r, ms)) }

// One-shot retry for transient FAL failures. gpt_mini has its own internal
// retry loop (MAX_RETRIES=6) and is excluded from this wrapper.
async function withImageRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[images] ${label} attempt 1 failed, retrying in 2s: ${msg.slice(0, 120)}`)
    await sleep(2000)
    return fn()
  }
}

async function uploadFalToStorage(
  falUrl: string,
  storagePath: string,
  contentType: 'image/jpeg' | 'image/png',
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<string> {
  const delays = [500, 1000, 1500]
  let lastErr: Error = new Error('upload failed')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(falUrl, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error(`fetch FAL image: HTTP ${res.status}`)
      const { error: uploadErr } = await serviceClient.storage
        .from('images')
        .upload(storagePath, await res.arrayBuffer(), { contentType, upsert: true })
      if (uploadErr) throw new Error(`Storage upload: ${uploadErr.message}`)
      const { data: { publicUrl } } = serviceClient.storage.from('images').getPublicUrl(storagePath)
      return publicUrl
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (attempt < 2) await sleep(delays[attempt])
    }
  }
  throw lastErr
}
// ─────────────────────────────────────────────────────────────────────────────

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

const SCENES_SYSTEM_PROMPT_PHOTO = _scenePrompts.scenesPromptPhoto

const SCENES_SYSTEM_PROMPT_ILLUSTRATION = _scenePrompts.scenesPromptIllustration

function buildScenesSystemPrompt(illustrative: boolean): string {
  return illustrative ? SCENES_SYSTEM_PROMPT_ILLUSTRATION : SCENES_SYSTEM_PROMPT_PHOTO
}

interface CharacterProfile {
  name: string
  description: string
}

async function extractCharacters(
  fullText: string,
  topic: string,
  anthropic: Anthropic,
  styleConfig: StyleConfig,
): Promise<CharacterProfile[]> {
  const styleDirective = styleConfig.illustrative
    ? `\nSTYLE: ILLUSTRATION MODE. Describe each character as a flat drawn SHAPE, not as anatomy.
FORBIDDEN words in descriptions: hair, fur, mane, molars, teeth, jaw, gut, belly, swollen, coarse, texture, muscle, skin, nostril, pore.
Use shape-language only: "round head", "flat body", "small ears", "thin stick arms", "short curvy tail", "flat color patch".
Example: NOT "Bipedal primate with coarse body hair, massive jaw with thick molars, swollen gut" BUT "stick figure with round head, small ears and a short tail, flat brown body, slightly hunched"\n`
    : ''

  const descriptionTask = styleConfig.illustrative
    ? `For each recurring character, write a concise 15–35 word ENGLISH description of flat drawn appearance with mandatory shape anchors — self-contained, no script context needed:
• Human figures: age hint via shape (e.g. "small round-headed child figure", "tall stick adult"), flat hair-shape and color, beard shape or "no beard", flat clothing color.
• Drawn animals/creatures: species, flat body color(s), pattern shapes (e.g. "dark oval spots"), size relative to frame, two distinctive shape features (e.g. "wide flat ears", "short curvy tail").
FORBIDDEN — exclude any term that does not anchor flat-drawn appearance: "average", "ordinary", "typical", "generic".
This description will be copied verbatim into illustration prompts.`
    : `For each recurring character, write a concise 15–35 word ENGLISH visual description with mandatory visual anchors — self-contained, recognisable without reading the script:
• Humans: approximate age (e.g. "mid-30s"), hair color and length, hairstyle shape, facial hair or explicitly "no beard", skin tone, eye color, one characteristic clothing item with color.
• Animals and creatures: species, coat color and pattern (e.g. "white with black spots"), size (e.g. "large"), two or three distinctive body parts.
FORBIDDEN — exclude any term that adds no visual anchor: "average build", "casual appearance", "adult male human", "ordinary", "typical".
This description will be copied verbatim into scene prompts.`

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Analyze this video script about "${topic}". Identify visual characters (animals, creatures, people, beings) that appear visually in multiple scenes.

PURPOSE: These profiles ensure the character looks IDENTICAL every time it appears in an illustration. A profile does NOT mean the character must appear in every scene — it is only used when the scene text actually shows that character.
${styleDirective}
${descriptionTask}

Rules:
- Include a character only if it will be visually depicted (shown, seen) in 2 or more scenes
- If the video is about an animal or person as its topic, include that subject — but only to establish its appearance for scenes where it is actually in frame, not as a directive to show it everywhere
- Return [] if all scenes show completely different subjects with no visual repeats
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

function injectCharacterProfiles(
  prompts: string[],
  characters: CharacterProfile[],
): string[] {
  if (!characters.length) return prompts
  return prompts.map((p) => {
    for (const char of characters) {
      if (!char.name || !char.description) continue
      const nameEscaped = char.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const namePattern = new RegExp(`(?<![\\p{L}\\p{N}_])${nameEscaped}(?![\\p{L}\\p{N}_])`, 'iu')
      if (!namePattern.test(p)) continue
      if (p.includes(char.description)) continue
      p = p.replace(namePattern, `${char.name} (${char.description})`)
    }
    return p
  })
}

type ImageEngine = 'flux' | 'flux_schnell' | 'gpt_mini' | 'nano_banana' | 'secretslider'

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
  // Free-text style override: when set, replaces preset style suffix + claude instruction.
  // Used by the Illustrations tool for arbitrary style input bypassing STYLE_CONFIGS.
  custom_style?: string
}

interface FalImageResult {
  images: Array<{ url: string; width?: number; height?: number }>
  has_nsfw_concepts?: boolean[]  // fal replaces flagged images with black frames; must check explicitly
}

interface SceneInfo {
  scene: string
  timecode_start: string
  timecode_end: string
  prompt: string
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(2)
  return `${String(m).padStart(2, '0')}:${sec.padStart(5, '0')}`
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

// Max scenes per Claude call — 50 scenes at typical Haiku latency ≈ 60s fits two 120s
// attempts with 5s pause (245s total) comfortably within 300s maxDuration.
const CLAUDE_CHUNK = 50

function sanitizeScenePrompt(prompt: string, sceneIdx: number): string {
  const replacements: Array<[RegExp, string]> = [
    [/question marks?/gi, 'tilted-head puzzled pose'],
    [/uncertainty symbols?/gi, 'tilted-head puzzled pose'],
    [/(speech|thought) bubble/gi, ''],
    [/caption box/gi, ''],
    [/montage of/gi, 'scene showing'],
    [/split screen/gi, 'single scene showing'],
    [/comic panels?/gi, 'single scene showing'],
    [/multiple panels?/gi, 'single scene showing'],
    [/\bgrid\b/gi, 'single scene showing'],
    [/text overlay/gi, ''],
    [/\bcaption\b/gi, ''],
  ]
  let result = prompt
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, (match) => {
      console.log(`[sanitize] scene ${sceneIdx}: replaced "${match}" → "${replacement || '(removed)'}"`)
      return replacement
    })
  }
  return result.replace(/\s{2,}/g, ' ').trim()
}

async function generateScenesFromSubtitles(
  topic: string,
  imageCount: number,
  durationSec: number,
  subtitleBlocks: SubtitleBlock[],
  styleConfig: StyleConfig,
  fallbackTopic: string,
): Promise<SceneInfo[]> {
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: 120_000 })

  const groups = splitSubtitlesIntoGroups(subtitleBlocks, imageCount)
  const scenesWithText = groups.map((group, i) => {
    const start = group.length > 0 ? group[0].start : (durationSec / imageCount) * i
    const end = group.length > 0 ? group[group.length - 1].end : (durationSec / imageCount) * (i + 1)
    const text = group.map((b) => b.text).join(' ').trim() || `Сцена ${i + 1}`
    return { start, end, text }
  })

  const fullText = subtitleBlocks.map((b) => b.text).join(' ')
  const characters = await extractCharacters(fullText, topic, anthropic, styleConfig)
  const charSection = characters.length > 0
    ? `\nПЕРСОНАЖИ — включать точные описания в промпты для сцен где они присутствуют:\n${characters.map((c) => `• ${c.name}: ${c.description}`).join('\n')}\n`
    : ''

  console.log(`[images/subtitles] claude style instruction: "${styleConfig.claudeInstruction}"`)
  console.log(`[images/subtitles] characters found: ${characters.length}${characters.length > 0 ? ` (${characters.map(c => c.name).join(', ')})` : ''}`)

  // Chunks are independent (charSection computed once above, disjoint scene slices).
  // Run all in parallel — reduces wall-clock from Σ(chunk_times) to max(chunk_times).
  const totalChunks = Math.ceil(scenesWithText.length / CLAUDE_CHUNK)
  console.log(`[images/subtitles] scenes: ${scenesWithText.length}, chunks: ${totalChunks} (parallel)`)
  console.log(`[images/subtitles] fallbackTopic: "${fallbackTopic}" (context only — not injected into prompts)`)
  let sceneFallbackCount = 0
  let lastChunkFailInfo = ''

  const chunkOutputs = await Promise.all(
    Array.from({ length: totalChunks }, async (_, ci) => {
      const chunkStart = ci * CLAUDE_CHUNK
      const chunk = scenesWithText.slice(chunkStart, chunkStart + CLAUDE_CHUNK)
      const chunkSize = chunk.length
      const maxTokens = Math.min(64000, Math.max(8000, chunkSize * 250))
      const label = `subtitles chunk ${ci + 1}/${totalChunks}`
      const t0 = Date.now()

      const callChunk = () => anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system: [{ type: 'text', text: buildScenesSystemPrompt(styleConfig.illustrative ?? false), cache_control: { type: 'ephemeral' } }],
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

      // Two attempts with 5s pause — worst-case 120+5+120=245s < 300s maxDuration
      let e1Msg = '', e1Status = ''
      const ta = Date.now()
      const message = await callChunk().catch(async (e1) => {
        e1Msg = e1 instanceof Error ? e1.message.slice(0, 150) : String(e1)
        e1Status = String((e1 as { status?: number }).status ?? 'N/A')
        const dur1 = ((Date.now() - ta) / 1000).toFixed(1)
        console.warn(`[images/subtitles] ${label} attempt 1 failed (${dur1}s) status=${e1Status}: ${e1Msg} — retrying in 5s`)
        await sleep(5000)
        const tb = Date.now()
        return callChunk().catch((e2) => {
          const e2Msg = e2 instanceof Error ? e2.message.slice(0, 150) : String(e2)
          const e2Status = String((e2 as { status?: number }).status ?? 'N/A')
          const dur2 = ((Date.now() - tb) / 1000).toFixed(1)
          const failInfo = `${label}: a1=${dur1}s status=${e1Status} ${e1Msg.slice(0, 80)} | a2=${dur2}s status=${e2Status} ${e2Msg.slice(0, 80)}`
          console.error(`[images/subtitles] ${failInfo}`)
          lastChunkFailInfo = failInfo
          return null
        })
      })

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      if (!message) {
        sceneFallbackCount += chunkSize
        console.error(`[images/subtitles] ${label} failed after ${elapsed}s — filling ${chunkSize} scenes with fallbacks`)
        return Array.from({ length: chunkSize }, (_, j) => ({
          scene: `Сцена ${chunkStart + j + 1}`,
          prompt: sanitizeScenePrompt(styleConfig.fallbackPrompt, chunkStart + j),
        }))
      }

      console.log(`[images/subtitles] ${label} done in ${elapsed}s — stop_reason:${message.stop_reason} input:${message.usage.input_tokens} output:${message.usage.output_tokens} cache_read:${message.usage.cache_read_input_tokens ?? 0}`)
      const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
      const chunkResults = parseJsonArray(rawText) as Array<{ scene: string; prompt: string }>
      if (chunkResults.length !== chunkSize) {
        const defInfo = `${label}: stop_reason:${message.stop_reason} output:${message.usage.output_tokens} deficit:${chunkResults.length}/${chunkSize}`
        console.warn(`[images/subtitles] ${defInfo}`)
        lastChunkFailInfo = defInfo
      }
      while (chunkResults.length < chunkSize) {
        const absIdx = chunkStart + chunkResults.length
        sceneFallbackCount++
        chunkResults.push({ scene: `Сцена ${absIdx + 1}`, prompt: sanitizeScenePrompt(styleConfig.fallbackPrompt, absIdx) })
      }
      return chunkResults
    })
  )

  // Promise.all preserves insertion order → flat() restores scene index sequence
  const allPromptResults = chunkOutputs.flat()

  let promptResults = allPromptResults
  if (promptResults.length > imageCount) promptResults = promptResults.slice(0, imageCount)
  while (promptResults.length < imageCount) {
    const fallbackIdx = promptResults.length
    sceneFallbackCount++
    promptResults.push({
      scene: `Сцена ${fallbackIdx + 1}`,
      prompt: sanitizeScenePrompt(styleConfig.fallbackPrompt, fallbackIdx),
    })
  }

  if (sceneFallbackCount > 0 && sceneFallbackCount / imageCount > 0.1) {
    const pct = ((sceneFallbackCount / imageCount) * 100).toFixed(0)
    const alertMsg = `${sceneFallbackCount} of ${imageCount} scenes fallback (${pct}%)${lastChunkFailInfo ? ` — ${lastChunkFailInfo}` : ''}`
    console.error(`[images/subtitles] ALERT scenes_fallback: ${alertMsg}`)
    await notifyError('/generate/images/scenes', alertMsg).catch(() => {})
  }

  const rawPromptsForInject = promptResults.map(r => r.prompt)
  const injectedPrompts = injectCharacterProfiles(rawPromptsForInject, characters)
  const injectedCount = injectedPrompts.filter((p, i) => p !== rawPromptsForInject[i]).length
  console.log(`[characters] extracted=${characters.length} names=${characters.map(c => c.name).join(', ')} injected=${injectedCount} prompts_total=${promptResults.length} first_desc="${(characters[0]?.description ?? '').slice(0, 80)}"`)
  if (injectedCount > 0) {
    promptResults = promptResults.map((r, i) => ({ ...r, prompt: injectedPrompts[i] }))
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
  fallbackTopic: string,
): Promise<SceneInfo[]> {
  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: 120_000 })

  const blocks = splitScriptByWords(script, imageCount)
  const blocksWithTimecodes = calculateTimecodes(blocks, durationSec)

  const characters = await extractCharacters(script, topic, anthropic, styleConfig)
  const charSection = characters.length > 0
    ? `\nПЕРСОНАЖИ — включать точные описания в промпты для сцен где они присутствуют:\n${characters.map((c) => `• ${c.name}: ${c.description}`).join('\n')}\n`
    : ''

  console.log(`[images/script] claude style instruction: "${styleConfig.claudeInstruction}"`)
  console.log(`[images/script] characters found: ${characters.length}${characters.length > 0 ? ` (${characters.map(c => c.name).join(', ')})` : ''}`)

  const totalChunks = Math.ceil(blocksWithTimecodes.length / CLAUDE_CHUNK)
  console.log(`[images/script] scenes: ${blocksWithTimecodes.length}, chunks: ${totalChunks} (parallel)`)
  console.log(`[images/script] fallbackTopic: "${fallbackTopic}" (context only — not injected into prompts)`)
  let sceneFallbackCount = 0
  let lastChunkFailInfo = ''

  const chunkOutputs = await Promise.all(
    Array.from({ length: totalChunks }, async (_, ci) => {
      const chunkStart = ci * CLAUDE_CHUNK
      const chunk = blocksWithTimecodes.slice(chunkStart, chunkStart + CLAUDE_CHUNK)
      const chunkSize = chunk.length
      const maxTokens = Math.min(64000, Math.max(8000, chunkSize * 250))
      const label = `script chunk ${ci + 1}/${totalChunks}`
      const t0 = Date.now()

      const callChunk = () => anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system: [{ type: 'text', text: buildScenesSystemPrompt(styleConfig.illustrative ?? false), cache_control: { type: 'ephemeral' } }],
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

      // Two attempts with 5s pause — worst-case 120+5+120=245s < 300s maxDuration
      let e1Msg = '', e1Status = ''
      const ta = Date.now()
      const message = await callChunk().catch(async (e1) => {
        e1Msg = e1 instanceof Error ? e1.message.slice(0, 150) : String(e1)
        e1Status = String((e1 as { status?: number }).status ?? 'N/A')
        const dur1 = ((Date.now() - ta) / 1000).toFixed(1)
        console.warn(`[images/script] ${label} attempt 1 failed (${dur1}s) status=${e1Status}: ${e1Msg} — retrying in 5s`)
        await sleep(5000)
        const tb = Date.now()
        return callChunk().catch((e2) => {
          const e2Msg = e2 instanceof Error ? e2.message.slice(0, 150) : String(e2)
          const e2Status = String((e2 as { status?: number }).status ?? 'N/A')
          const dur2 = ((Date.now() - tb) / 1000).toFixed(1)
          const failInfo = `${label}: a1=${dur1}s status=${e1Status} ${e1Msg.slice(0, 80)} | a2=${dur2}s status=${e2Status} ${e2Msg.slice(0, 80)}`
          console.error(`[images/script] ${failInfo}`)
          lastChunkFailInfo = failInfo
          return null
        })
      })

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      if (!message) {
        sceneFallbackCount += chunkSize
        console.error(`[images/script] ${label} failed after ${elapsed}s — filling ${chunkSize} scenes with fallbacks`)
        return Array.from({ length: chunkSize }, (_, j) => {
          const absIdx = chunkStart + j
          return {
            scene: blocksWithTimecodes[absIdx]?.text.slice(0, 80).trim() ?? `Сцена ${absIdx + 1}`,
            prompt: sanitizeScenePrompt(styleConfig.fallbackPrompt, absIdx),
          }
        })
      }

      console.log(`[images/script] ${label} done in ${elapsed}s — stop_reason:${message.stop_reason} input:${message.usage.input_tokens} output:${message.usage.output_tokens} cache_read:${message.usage.cache_read_input_tokens ?? 0}`)
      const rawText = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
      const chunkResults = parseJsonArray(rawText) as Array<{ scene: string; prompt: string }>
      if (chunkResults.length !== chunkSize) {
        const defInfo = `${label}: stop_reason:${message.stop_reason} output:${message.usage.output_tokens} deficit:${chunkResults.length}/${chunkSize}`
        console.warn(`[images/script] ${defInfo}`)
        lastChunkFailInfo = defInfo
      }
      while (chunkResults.length < chunkSize) {
        const absIdx = chunkStart + chunkResults.length
        sceneFallbackCount++
        chunkResults.push({
          scene: blocksWithTimecodes[absIdx]?.text.slice(0, 80).trim() ?? `Сцена ${absIdx + 1}`,
          prompt: sanitizeScenePrompt(styleConfig.fallbackPrompt, absIdx),
        })
      }
      return chunkResults
    })
  )

  const allPromptResults = chunkOutputs.flat()

  let promptResults = allPromptResults
  if (promptResults.length > imageCount) promptResults = promptResults.slice(0, imageCount)
  while (promptResults.length < imageCount) {
    const i = promptResults.length
    sceneFallbackCount++
    promptResults.push({
      scene: blocksWithTimecodes[i]?.text.slice(0, 80).trim() ?? `Сцена ${i + 1}`,
      prompt: sanitizeScenePrompt(styleConfig.fallbackPrompt, i),
    })
  }

  if (sceneFallbackCount > 0 && sceneFallbackCount / imageCount > 0.1) {
    const pct = ((sceneFallbackCount / imageCount) * 100).toFixed(0)
    const alertMsg = `${sceneFallbackCount} of ${imageCount} scenes fallback (${pct}%)${lastChunkFailInfo ? ` — ${lastChunkFailInfo}` : ''}`
    console.error(`[images/script] ALERT scenes_fallback: ${alertMsg}`)
    await notifyError('/generate/images/scenes', alertMsg).catch(() => {})
  }

  const rawPromptsForInject = promptResults.map(r => r.prompt)
  const injectedPrompts = injectCharacterProfiles(rawPromptsForInject, characters)
  const injectedCount = injectedPrompts.filter((p, i) => p !== rawPromptsForInject[i]).length
  console.log(`[characters] extracted=${characters.length} names=${characters.map(c => c.name).join(', ')} injected=${injectedCount} prompts_total=${promptResults.length} first_desc="${(characters[0]?.description ?? '').slice(0, 80)}"`)
  if (injectedCount > 0) {
    promptResults = promptResults.map((r, i) => ({ ...r, prompt: injectedPrompts[i] }))
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
      prompt: `${prompt}, NO TEXT, NO NUMBERS, NO DIGITS, NO WATERMARKS`,
      image_size: { width: 1280, height: 720 },
      num_images: 1,
    },
  }) as { data: FalImageResult }

  const falUrl = result.data?.images?.[0]?.url ?? null
  if (!falUrl) throw new Error('Flux Schnell: no image returned')
  if (result.data?.has_nsfw_concepts?.[0] === true) {
    console.warn(`[images] NSFW_FILTERED flux/schnell scene=${sceneIndex}`)
    throw new Error('NSFW_FILTERED: safety checker blocked image (flux/schnell)')
  }
  if (!projectId) return falUrl

  const storagePath = `${userId}/${projectId}/scene_schnell_${sceneIndex}.jpg`
  return uploadFalToStorage(falUrl, storagePath, 'image/jpeg', serviceClient)
}

async function generateImageNanoBanana(
  prompt: string,
  userId: string,
  projectId: string | undefined,
  sceneIndex: number,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<string | null> {
  fal.config({ credentials: env('FAL_KEY') })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (fal.subscribe as any)('fal-ai/nano-banana', {
    input: {
      prompt: `${prompt}, NO TEXT, NO NUMBERS, NO DIGITS, NO WATERMARKS`,
      aspect_ratio: '16:9',
      num_images: 1,
      output_format: 'jpeg',
    },
  }) as { data: FalImageResult }

  const img = result.data?.images?.[0]
  const falUrl = img?.url ?? null
  if (!falUrl) throw new Error('Nano Banana: no image returned')
  if (result.data?.has_nsfw_concepts?.[0] === true) {
    console.warn(`[images] NSFW_FILTERED nano-banana scene=${sceneIndex}`)
    throw new Error('NSFW_FILTERED: safety checker blocked image (nano-banana)')
  }
  if (img?.width && img?.height) {
    console.log(`[images] nano-banana scene ${sceneIndex} returned ${img.width}x${img.height} (ratio ${(img.width / img.height).toFixed(3)})`)
  }
  if (!projectId) return falUrl

  const storagePath = `${userId}/${projectId}/scene_nano_${sceneIndex}.jpg`
  return uploadFalToStorage(falUrl, storagePath, 'image/jpeg', serviceClient)
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
      prompt: `${prompt}, NO TEXT, NO NUMBERS, NO DIGITS, NO WATERMARKS`,
      negative_prompt: negativePrompt,
      image_size: { width: 1280, height: 720 },
      num_images: 1,
      num_inference_steps: 35,
    },
  }) as { data: FalImageResult }

  const imageUrl = result.data?.images?.[0]?.url ?? null
  if (!imageUrl) throw new Error('Flux: no image returned')
  if (result.data?.has_nsfw_concepts?.[0] === true) {
    console.warn(`[images] NSFW_FILTERED flux/dev scene=${sceneIndex}`)
    throw new Error('NSFW_FILTERED: safety checker blocked image (flux/dev)')
  }
  if (!projectId) return imageUrl

  const storagePath = `${userId}/${projectId}/scene_${sceneIndex}.jpg`
  return uploadFalToStorage(imageUrl, storagePath, 'image/jpeg', serviceClient)
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
        prompt: `${prompt}, NO TEXT, NO NUMBERS, NO DIGITS, NO WATERMARKS`,
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

// ─── Secret Slider adapter ────────────────────────────────────────────────────
// Async batch API: one POST returns a task_id; poll until status=completed.
// Auth: X-API-Key header (NOT Authorization Bearer).
// All image_urls are relative paths → must be prefixed with SS_ORIGIN.
// Output resolution: 1376×768. No resize applied — sharp is not in project deps.
// One active task per key; do not call concurrently.
const SS_ORIGIN  = 'https://secretslider.com'
const SS_POLL_MS = 5_000
// SS timeout is computed dynamically per call — see ssBudgetMs inside generateImagesSecretSlider.

interface SsTaskResult {
  status:   string
  results?: { image_urls?: string[]; image_count?: number }
}

async function generateImagesSecretSlider(prompts: string[], requestStartMs: number): Promise<string[]> {
  const apiKey = env('SECRETSLIDER_API_KEY')
  if (!apiKey) throw new Error('[secretslider] SECRETSLIDER_API_KEY not configured')

  // 270000 = maxDuration 300 с минус 30 с запаса, нужного чтобы успели отработать catch и finally.
  // 3500 мс/изображение — оценка, не замер; уточнить по логу [images/secretslider] upload после накопления статистики.
  const uploadReserveMs = 3_500 * prompts.length
  const ssBudgetMs = 270_000 - (Date.now() - requestStartMs) - uploadReserveMs
  console.log(`[secretslider] budget: pre=${Math.round((Date.now() - requestStartMs) / 1000)}s reserve=${Math.round(uploadReserveMs / 1000)}s ss_budget=${Math.round(ssBudgetMs / 1000)}s prompts=${prompts.length}`)
  if (ssBudgetMs < 30_000) {
    throw new Error(
      `[secretslider] не осталось времени на генерацию: бюджет ${Math.round(ssBudgetMs / 1000)}s после накладных расходов (${prompts.length} промптов × 3.5 с заливки)`
    )
  }

  // Guard: reject early if a task for this key is already running.
  // One active task per key is a hard API limit — a second POST would 429 immediately.
  // If the guard itself fails, we proceed — it must never block a valid path.
  try {
    const activeRes = await fetch(`${SS_ORIGIN}/api/v2/tasks/active`, {
      headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (activeRes.ok) {
      const active = await activeRes.json() as { active_count?: number; active_tasks?: Array<{ estimated_wait_seconds?: number }> }
      if ((active.active_count ?? 0) > 0) {
        const waitSec = active.active_tasks?.[0]?.estimated_wait_seconds ?? 0
        throw new Error(`SS_BUSY:${waitSec}`)
      }
    } else {
      console.warn(`[secretslider] tasks/active returned ${activeRes.status}, proceeding`)
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('SS_BUSY')) throw err
    console.warn('[secretslider] tasks/active check failed, proceeding:', err instanceof Error ? err.message : String(err))
  }

  // Content-Type (incl. boundary) set automatically by fetch when body is FormData.
  const form = new FormData()
  form.append('mode', 'visual')
  form.append('prompts', JSON.stringify(prompts))
  form.append('num_images', '1')
  form.append('aspect_ratio', '16:9')

  const genRes = await fetch(`${SS_ORIGIN}/api/v2/generate`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
    body: form,
    signal: AbortSignal.timeout(30_000),
  })
  if (genRes.status === 429) {
    const body = await genRes.text().catch(() => '')
    let retrySec = 0
    try { retrySec = (JSON.parse(body) as { retry_after?: number }).retry_after ?? 0 } catch { /* non-JSON body */ }
    throw new Error(`SS_BUSY:${retrySec}`)
  }
  if (genRes.status !== 202) {
    const body = await genRes.text().catch(() => '')
    throw new Error(`[secretslider] POST /generate returned ${genRes.status}: ${body.slice(0, 300)}`)
  }

  const { task_id: taskId } = await genRes.json() as { task_id: string }
  if (!taskId) throw new Error('[secretslider] no task_id in response')
  console.log(`[secretslider] task=${taskId} prompts=${prompts.length}`)

  const t0 = Date.now()
  const deadline = t0 + ssBudgetMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, SS_POLL_MS))
    const elapsed = Math.round((Date.now() - t0) / 1000)

    const pollRes = await fetch(`${SS_ORIGIN}/api/v2/task/${taskId}`, {
      headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!pollRes.ok) {
      console.warn(`[secretslider] poll ${elapsed}s http=${pollRes.status}`)
      continue
    }

    const poll = await pollRes.json() as SsTaskResult
    console.log(`[secretslider] poll ${elapsed}s status=${poll.status} image_count=${poll.results?.image_count ?? '?'}`)

    if (poll.status === 'failed') {
      throw new Error(`[secretslider] task ${taskId} failed`)
    }

    if (poll.status === 'completed' || poll.status === 'partial_success') {
      const urls = poll.results?.image_urls ?? []
      if (urls.length !== prompts.length) {
        // Without a per-image binding field, index is the only prompt→image link.
        // A count mismatch shifts every subsequent scene to the wrong image — reject entirely.
        throw new Error(
          `[secretslider] image_count mismatch: expected ${prompts.length}, got ${urls.length} (image_count=${poll.results?.image_count ?? '?'})`
        )
      }
      // One-line stat for latency analysis: grep [secretslider] STATS to collect data.
      console.log(`[secretslider] STATS: prompts=${prompts.length} total_sec=${((Date.now() - t0) / 1000).toFixed(1)} status=${poll.status}`)
      return urls.map(u => {
        if (u.startsWith('/')) return `${SS_ORIGIN}${u}`
        if (u.startsWith('http://')) return `https://${u.slice(7)}`
        return u
      })
    }
  }

  throw new Error(`[secretslider] task ${taskId} timed out (budget=${Math.round(ssBudgetMs / 1000)}s)`)
}

export async function POST(request: NextRequest) {
  // === Pre-stream checks — return plain JSON on failure ===
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
  }

  const { script, topic, duration_sec, image_count, project_id, image_interval, subtitle_blocks, engine = 'flux', image_style, custom_style }: ImagesRequest =
    await request.json()

  if (!script?.trim() || !topic?.trim()) {
    return NextResponse.json({ ok: false, error: 'script и topic обязательны' }, { status: 400 })
  }

  Sentry.setUser({ id: user.id })
  Sentry.setContext('generate', { project_id, engine, image_count })

  const count = Math.max(1, Math.min(IMAGE_COUNT_MAX, image_count ?? 1))
  const interval = Math.max(3, Math.min(300, image_interval ?? 10))
  const costPerImage =
    engine === 'gpt_mini'       ? CREDIT_COSTS.image_gpt_mini :
    engine === 'flux_schnell'   ? CREDIT_COSTS.image_flux_schnell :
    engine === 'nano_banana'    ? CREDIT_COSTS.image_nano_banana :
    engine === 'secretslider'   ? CREDIT_COSTS.image_secretslider :
    CREDIT_COSTS.image_flux
  const totalCost = costPerImage * count

  if (engine === 'gpt_mini' && count > 20) {
    return NextResponse.json({
      ok: false,
      code: 'TOO_MANY_FOR_GPT_MINI',
      error: `${ENGINE_DISPLAY.gpt_mini.name} поддерживает максимум 20 иллюстраций за запуск`,
      maxAllowed: 20,
      requested: count,
    }, { status: 400 })
  }

  if (engine === 'secretslider' && count > 15) {
    return NextResponse.json({
      ok: false,
      code: 'TOO_MANY_FOR_SECRETSLIDER',
      // замеры дали разброс времени задачи 32–200+ с независимо от размера батча,
      // плюс ~3.5 с на заливку каждой картинки; при 30 шт расчёт даёт 375 с против maxDuration 300.
      error: `Secret Slider поддерживает максимум 15 иллюстраций за запуск`,
      maxAllowed: 15,
      requested: count,
    }, { status: 400 })
  }

  const enough = await hasCredits(user.id, totalCost, supabase)
  if (!enough) {
    return NextResponse.json({ ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }, { status: 402 })
  }

  // When custom_style is provided it fully overrides preset STYLE_CONFIGS: both the Claude
  // scene-description instruction and the fal prompt suffix use the free-text string directly.
  const styleConfig: StyleConfig = custom_style?.trim()
    ? {
        claudeInstruction: `${custom_style.trim()}. Describe each scene strictly in this visual style.`,
        fluxSuffix: custom_style.trim(),
        negativePrompt: DEFAULT_STYLE_CONFIG.negativePrompt,
        enhanceSystemHint: custom_style.trim(),
        fallbackPrompt: DEFAULT_STYLE_CONFIG.fallbackPrompt,
        illustrative: false,
      }
    : getStyleConfig(image_style)
  if (!custom_style?.trim() && image_style && styleConfig === DEFAULT_STYLE_CONFIG) {
    console.warn(`[images] image_style not in STYLE_CONFIGS — using default. value="${image_style.slice(0, 80)}"`)
  }
  console.log(`[images] engine=${engine} style="${image_style ?? 'default'}" custom_style="${custom_style ?? ''}" suffix="${styleConfig.fluxSuffix.slice(0, 60)}"`)

  // === SSE streaming — keeps the connection alive for the full generation ===
  const encoder = new TextEncoder()
  const send = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`)

  const stream = new ReadableStream({
    async start(controller) {
      let generationSucceeded = false
      let t0Request = Date.now()
      try {
        if (project_id) {
          await supabase
            .from('projects')
            .update({ scene_images: [], status: 'generating_images' })
            .eq('id', project_id)
            .eq('user_id', user.id)
        }

        // Read subtitle_blocks from DB — source of truth, avoids stale/empty client state
        // on page reload, and scales to 2000+ blocks for hour-long videos.
        let resolvedSubtitleBlocks: SubtitleBlock[] | null = null
        let projectTitle = ''
        if (project_id) {
          const { data: projData } = await supabase
            .from('projects')
            .select('subtitle_blocks, title')
            .eq('id', project_id)
            .eq('user_id', user.id)
            .single()
          resolvedSubtitleBlocks = (projData?.subtitle_blocks as SubtitleBlock[] | null) ?? null
          projectTitle = ((projData as Record<string, unknown> | null)?.title as string | undefined ?? '').trim()
        }
        // Fallback: client-supplied (for project_id-less calls, e.g. single-scene preview)
        if (!resolvedSubtitleBlocks?.length) resolvedSubtitleBlocks = subtitle_blocks ?? null

        const hasSubtitles = Array.isArray(resolvedSubtitleBlocks) && resolvedSubtitleBlocks.length > 0
        console.log(`[images] mode=${hasSubtitles ? 'subtitle' : 'script'} count=${count}`)
        t0Request = Date.now()

        // Derive a short clean topic label from the script instead of using raw user input.
        // scriptParams.topic may contain thousands of chars of pasted source material
        // (research text the user entered to generate the script), which dominates Haiku's
        // context window and causes wrong-season prompts and language mixing.
        // The script already encodes the correct topic — its first ~20 words are sufficient.
        const effectiveTopic = script.split(/\s+/).slice(0, 20).join(' ').trim()
          || topic.slice(0, 150)

        // Short, clean label for fallback scene prompts — must NOT be narrative prose.
        // Priority: user's typed topic (Step1Topic) → project title from DB → first 8 script words.
        const rawUserTopic = (topic || '').trim()
        let fallbackTopic: string
        let fallbackTopicSource: string
        if (rawUserTopic && rawUserTopic.length <= 120) {
          fallbackTopic = rawUserTopic.split(/\s+/).slice(0, 8).join(' ')
          fallbackTopicSource = 'user_topic'
        } else if (projectTitle && projectTitle.length <= 120) {
          fallbackTopic = projectTitle.split(/\s+/).slice(0, 8).join(' ')
          fallbackTopicSource = 'project_title'
        } else {
          fallbackTopic = script.split(/\s+/).slice(0, 8).join(' ')
          fallbackTopicSource = 'script_head'
        }
        console.log(`[scenes] fallbackTopic source: ${fallbackTopicSource} → "${fallbackTopic}"`)

        const t0Claude = Date.now()
        const scenes = hasSubtitles
          ? await generateScenesFromSubtitles(effectiveTopic, count, duration_sec, resolvedSubtitleBlocks!, styleConfig, fallbackTopic)
          : await generateScenesFromScript(script, effectiveTopic, duration_sec, count, styleConfig, fallbackTopic)
        const claudeSec = ((Date.now() - t0Claude) / 1000).toFixed(1)

        console.log(`[images] scenes generated: ${scenes.length}`)
        console.log(`[images] claude_phase: ${scenes.length} scenes, ${claudeSec}s`)

        // Tell the client how many images to expect so it can show a progress bar
        controller.enqueue(send({ type: 'start', total: scenes.length }))

        const serviceClient = createServiceClient()
        const sceneImages: SceneImage[] = new Array(scenes.length)
        let successCount = 0
        let chargedCount = 0
        let failCount = 0

        const GPT_BATCH_SIZE = parseInt(env('GPT_BATCH_SIZE') || '3')
        const CONCURRENCY = engine === 'gpt_mini'
          ? GPT_BATCH_SIZE
          : parseInt(env('FAL_CONCURRENCY_LIMIT') || '40')
        console.log(`[images] engine: ${engine}, concurrency: ${CONCURRENCY}, total: ${scenes.length}`)
        const rawFal = process.env.FAL_CONCURRENCY_LIMIT
        const rawGpt = process.env.GPT_BATCH_SIZE
        console.log(`[images] concurrency_env: FAL_CONCURRENCY_LIMIT=${rawFal ?? '(not set)'}[len=${rawFal?.length ?? 0}] GPT_BATCH_SIZE=${rawGpt ?? '(not set)'}[len=${rawGpt?.length ?? 0}]`)
        const t0Images = Date.now()

        if (engine === 'secretslider') {
          // === Secret Slider: single batch call, URLs distributed to scenes by index ===
          const allStyledPrompts: string[] = scenes.map((scn, i) => {
            const styledPrompt = `${sanitizeScenePrompt(scn.prompt, i)}, ${styleConfig.fluxSuffix}`
            console.log(`[images/secretslider] scene ${i + 1} prompt: "${styledPrompt.slice(0, 120)}"`)
            return styledPrompt
          })
          console.log(`[images/secretslider] batch: ${allStyledPrompts.length} prompts`)

          const ssUrls = await generateImagesSecretSlider(allStyledPrompts, t0Request)
          console.log(`[images/secretslider] received ${ssUrls.length} URLs in ${((Date.now() - t0Images) / 1000).toFixed(1)}s`)

          for (let i = 0; i < scenes.length; i++) {
            const scn = scenes[i]
            const styledPrompt = allStyledPrompts[i]
            const ssUrl = ssUrls[i]
            try {
              // Images arrive at 1376×768; no resize applied — sharp is not in project deps (see report п.4).
              const storagePath = project_id ? `${user.id}/${project_id}/scene_ss_${i}.jpg` : undefined
              const t0Upload = Date.now()
              const url = project_id
                ? await uploadFalToStorage(ssUrl, storagePath!, 'image/jpeg', serviceClient)
                : ssUrl
              const uploadMs = project_id ? Date.now() - t0Upload : 0
              const audioFp = duration_sec != null ? Math.round(duration_sec) : undefined
              const img: SceneImage = {
                scene_index: i, prompt: styledPrompt, url,
                scene: scn.scene, timecode_start: scn.timecode_start, timecode_end: scn.timecode_end,
                engine, audio_fingerprint: audioFp,
              }
              sceneImages[i] = img
              successCount++
              if (url) {
                // Spend credits only after image lands in Supabase Storage — same invariant as the per-batch path.
                const chargeResult = await spendCredits(user.id, costPerImage, `image_${engine}`, project_id)
                if (chargeResult.ok) chargedCount++
              }
              console.log(`[images/secretslider] scene ${i + 1} upload: ${uploadMs}ms url=${url?.slice(0, 80) ?? 'NULL'}`)
            } catch (err) {
              failCount++
              const msg = err instanceof Error ? err.message : String(err)
              console.error(`[images/secretslider] scene ${i + 1} FAILED:`, msg)
              sceneImages[i] = {
                scene_index: i, prompt: styledPrompt, url: null,
                scene: scn.scene, timecode_start: scn.timecode_start, timecode_end: scn.timecode_end,
                engine, audio_fingerprint: duration_sec != null ? Math.round(duration_sec) : undefined,
              }
            }
            controller.enqueue(send({
              type: 'progress',
              completed: successCount + failCount,
              total: scenes.length,
              images: sceneImages[i]?.url ? [sceneImages[i]!] : [],
            }))
            if (project_id) {
              await supabase
                .from('projects')
                .update({ scene_images: sceneImages.filter(Boolean) })
                .eq('id', project_id)
                .eq('user_id', user.id)
              console.log(`[images/secretslider] incremental save: ${sceneImages.filter(Boolean).length}/${scenes.length}`)
            }
          }
        } else {
          for (let batchStart = 0; batchStart < scenes.length; batchStart += CONCURRENCY) {
            const batchEnd = Math.min(batchStart + CONCURRENCY, scenes.length)
            const batchNewImages: SceneImage[] = []
            console.log(`[images] batch ${Math.floor(batchStart / CONCURRENCY) + 1}: scenes ${batchStart + 1}–${batchEnd}`)
            const batchT0 = Date.now()
            const batchSuccessBefore = successCount
            const batchFailBefore = failCount

            await Promise.all(
              scenes.slice(batchStart, batchEnd).map(async (scn, batchIdx) => {
                const i = batchStart + batchIdx
                const sanitizedPrompt = sanitizeScenePrompt(scn.prompt, i)
                const styledPrompt = `${sanitizedPrompt}, ${styleConfig.fluxSuffix}`
                console.log(`[images] scene ${i + 1} REQUESTED style: "${image_style ?? 'default'}"`)
                console.log(`[images] scene ${i + 1} claude prompt result: "${scn.prompt}"`)
                console.log(`[images] scene ${i + 1} FINAL flux prompt: "${styledPrompt}"`)
                console.log(`[images] scene ${i + 1} NEGATIVE prompt: "${styleConfig.negativePrompt}"`)
                try {
                  const sceneLabel = `scene ${i + 1}`
                  const url = engine === 'gpt_mini'
                    ? await generateImageGptMini(styledPrompt, user.id, project_id, i, serviceClient)
                    : await withImageRetry(
                        () => engine === 'flux_schnell'
                          ? generateImageFluxSchnell(styledPrompt, user.id, project_id, i, serviceClient)
                          : engine === 'nano_banana'
                          ? generateImageNanoBanana(styledPrompt, user.id, project_id, i, serviceClient)
                          : generateImageFlux(styledPrompt, styleConfig.negativePrompt, user.id, project_id, i, serviceClient),
                        sceneLabel,
                      )
                  const audioFp = duration_sec != null ? Math.round(duration_sec) : undefined
                  const img: SceneImage = { scene_index: i, prompt: styledPrompt, url, scene: scn.scene, timecode_start: scn.timecode_start, timecode_end: scn.timecode_end, engine, audio_fingerprint: audioFp }
                  sceneImages[i] = img
                  successCount++
                  if (url) {
                    batchNewImages.push(img)
                    // Spend credits only for images that actually landed in Supabase Storage.
                    // Track chargedCount separately so the client displays exactly what was deducted.
                    const chargeResult = await spendCredits(user.id, costPerImage, `image_${engine}`, project_id)
                    if (chargeResult.ok) chargedCount++
                  }
                  console.log(`[images] scene ${i + 1} RESULT url: ${url?.slice(0, 100) ?? 'NULL'}`)
                } catch (err) {
                  failCount++
                  const msg = err instanceof Error ? err.message : String(err)
                  const nsfwBlocked = msg.startsWith('NSFW_FILTERED')
                  console.error(`[images] scene ${i + 1} ${nsfwBlocked ? 'NSFW_FILTERED (both attempts)' : 'FAILED'}:`, msg)
                  sceneImages[i] = {
                    scene_index: i, prompt: styledPrompt, url: null,
                    scene: scn.scene, timecode_start: scn.timecode_start, timecode_end: scn.timecode_end,
                    engine, audio_fingerprint: duration_sec != null ? Math.round(duration_sec) : undefined,
                    nsfw_blocked: nsfwBlocked || undefined,
                  }
                }
              })
            )

            const batchSec = ((Date.now() - batchT0) / 1000).toFixed(1)
            const batchOk = successCount - batchSuccessBefore
            const batchFail = failCount - batchFailBefore
            const accumulatedSec = ((Date.now() - t0Images) / 1000).toFixed(1)
            console.log(`[images] batch ${Math.floor(batchStart / CONCURRENCY) + 1} done: engine=${engine} size=${batchEnd - batchStart} ok=${batchOk} fail=${batchFail} batch_sec=${batchSec}s accumulated_sec=${accumulatedSec}s`)

            // Send progress after every batch so the client can update its UI immediately
            controller.enqueue(send({
              type: 'progress',
              completed: successCount + failCount,
              total: scenes.length,
              images: batchNewImages,
            }))

            // Persist after every batch: if Vercel kills the function the user keeps
            // all paid images. filter(Boolean) strips uninitialised (undefined) slots
            // for future batches; null-url slots (failed FAL calls) are kept so the
            // video renderer knows which scenes need re-generation.
            if (project_id) {
              await supabase
                .from('projects')
                .update({ scene_images: sceneImages.filter(Boolean) })
                .eq('id', project_id)
                .eq('user_id', user.id)
              console.log(`[images] incremental save: ${sceneImages.filter(Boolean).length}/${scenes.length} scenes persisted`)
            }
          }
        }

        console.log(`[images] done: success=${successCount} failed=${failCount} total=${scenes.length}`)
        const totalSec = ((Date.now() - t0Request) / 1000).toFixed(1)
        const imagesSec = ((Date.now() - t0Images) / 1000).toFixed(1)
        const avgSec = successCount > 0 ? ((Date.now() - t0Images) / 1000 / successCount).toFixed(2) : 'N/A'
        console.log(`[images] SUMMARY: engine=${engine} ordered=${count} created=${successCount} total_sec=${totalSec}s claude_sec=${claudeSec}s images_sec=${imagesSec}s avg_per_image=${avgSec}s concurrency=${CONCURRENCY}`)

        const validImages = sceneImages.filter(Boolean)
        if (project_id) {
          await supabase
            .from('projects')
            .update({ scene_images: validImages, image_interval: interval, image_style: image_style ?? null, status: 'draft' })
            .eq('id', project_id)
            .eq('user_id', user.id)
          const newExpiry = mediaExpiryFromNow()
          await supabase
            .from('projects')
            .update({ media_expires_at: newExpiry })
            .eq('id', project_id)
            .eq('user_id', user.id)
            .or(`media_expires_at.is.null,media_expires_at.lt.${newExpiry}`)
            .catch(() => {})
        }
        generationSucceeded = true

        if (Date.now() - t0Request > 90_000) {
          const appUrl = env('NEXT_PUBLIC_APP_URL') || ''
          await notifyUserTelegram(
            user.id,
            `🖼 Иллюстрации готовы! (${validImages.length} шт.)\nПерейти в студию: ${appUrl}/studio`
          ).catch(() => {})
        }

        controller.enqueue(send({
          type: 'done',
          images: validImages,
          success_count: successCount,
          charged_count: chargedCount,
          fail_count: failCount,
        }))
        controller.close()
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[generate/images] stream error:', msg)
        if (Date.now() - t0Request > 90_000) {
          const appUrl = env('NEXT_PUBLIC_APP_URL') || ''
          await notifyUserTelegram(
            user.id,
            `⚠️ Генерация иллюстраций прервалась.\nПопробуйте снова в студии: ${appUrl}/studio`
          ).catch(() => {})
        }
        if (msg.startsWith('SS_BUSY')) {
          // Concurrency limit from Secret Slider — not a bug, do not send to Sentry/Telegram.
          const waitSec = parseInt(msg.split(':')[1] ?? '0', 10) || 0
          console.log(`[secretslider] BUSY: retry_after=${waitSec}s`)
          try {
            controller.enqueue(send({ type: 'error', code: 'BUSY_SECRETSLIDER', retry_after: waitSec }))
            controller.close()
          } catch { /* controller may already be closed */ }
        } else {
          Sentry.captureException(error)
          if (isBillingError(msg)) await notifyBillingError('Anthropic', '/generate/images').catch(() => {})
          else await notifyError('/generate/images', msg).catch(() => {})
          try {
            controller.enqueue(send({ type: 'error', error: 'Ошибка генерации иллюстраций' }))
            controller.close()
          } catch { /* controller may already be closed on a second error */ }
        }
      } finally {
        if (!generationSucceeded && project_id) {
          try {
            await supabase
              .from('projects')
              .update({ status: 'failed' })
              .eq('id', project_id)
              .eq('user_id', user.id)
          } catch { /* best-effort — stream already failed */ }
        }
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
