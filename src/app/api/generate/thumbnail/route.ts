import { readFileSync } from 'fs'
import { join } from 'path'
import { NextRequest, NextResponse } from 'next/server'
import React from 'react'
import { ImageResponse } from 'next/og'
import Anthropic from '@anthropic-ai/sdk'
import { fal } from '@fal-ai/client'
import * as Sentry from '@sentry/nextjs'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { CREDIT_COSTS } from '@/lib/types'
import type { ThumbnailTextMode, TextOverlayParams } from '@/lib/thumbnail-text-presets'
import { getStyleConfig } from '@/lib/image-style-configs'
import { isBillingError, notifyBillingError } from '@/lib/telegram'

const MONTSERRAT_BLACK = readFileSync(
  join(process.cwd(), 'public', 'fonts', 'Montserrat-Black.ttf'),
)

export const maxDuration = 120

interface ThumbnailRequest {
  project_id: string
  title: string
  topic: string
  bg_url?: string
  dry_run?: boolean
  custom_prompt?: string
  ref_style?: string
  ref_url?: string
  text_mode?: ThumbnailTextMode
  image_style?: string
}

interface FalImageResult {
  images: Array<{ url: string }>
}

// Fallback used when Claude vision analysis fails
const DEFAULT_OVERLAY_PARAMS: TextOverlayParams = {
  position: 'bottom-left',
  textColor: '#FFFFFF',
  uppercase: false,
  strokeColor: null,
  strokeWidth: 0,
  accentBar: true,
  bandOpacity: 0.94,
}

// ─── Mode A: Claude vision → dynamic text overlay params ──────────────────────
//
// Claude analyzes the actual generated image (colors, composition, style)
// and returns JSON parameters that control exactly how text is rendered in Satori.
// Each image gets its own analysis — no static presets by style name.

async function analyzeImageForTextOverlay(bgDataUrl: string, title: string, refStyle?: string): Promise<TextOverlayParams> {
  try {
    const base64Data = bgDataUrl.split(',')[1]
    const mediaType = (bgDataUrl.split(';')[0].split(':')[1] ?? 'image/jpeg') as
      'image/jpeg' | 'image/png' | 'image/webp'

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      system: `You are a professional YouTube thumbnail designer. Analyze the background image and the video title, then return ONLY a valid JSON object with text overlay parameters — no explanation, no markdown.`,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data },
          },
          {
            type: 'text',
            text: `Video title to overlay: "${title}"
${refStyle ? `Reference typography hint: "${refStyle}" — prefer a text color and stroke that match this style description.\n` : ''}
Analyze the image (colors, brightness zones, visual style — cartoon/illustrated/realistic/cinematic/etc) and return optimal text overlay parameters as JSON:

{
  "position": "bottom-left",
  "textColor": "#FFFFFF",
  "uppercase": false,
  "strokeColor": null,
  "strokeWidth": 0,
  "accentBar": true,
  "bandOpacity": 0.85
}

Field rules:
- position: "top-center" if the upper region is darker/simpler/has open space; "bottom-left" if the lower region is darker or there's clear negative space at bottom
- textColor: choose high-contrast hex color that pops against the chosen position's background (#FFFFFF, #FFD700, #FF6B35, #00FFFF, etc.)
- uppercase: true for cartoon/illustrated/energetic/comic styles; false for realistic/cinematic/documentary/photographic
- strokeColor + strokeWidth: set dark stroke hex (e.g. "#111111") and width 3–5 when the background at the text position is bright or busy; null/0 when background is already dark enough
- accentBar: true for cinematic/news/modern/photorealistic styles (adds a red left-edge border, looks polished); false for illustrated/artistic/whimsical/cartoon styles
- bandOpacity: 0.0–0.9 — how opaque to make the semi-transparent dark band behind the text; 0.0 means text sits directly on the image (only works if the position area is already very dark)`,
          },
        ],
      }],
    })

    const block = msg.content[0]
    if (block.type !== 'text') return DEFAULT_OVERLAY_PARAMS

    const jsonMatch = block.text.trim().match(/\{[\s\S]*\}/)
    if (!jsonMatch) return DEFAULT_OVERLAY_PARAMS

    const parsed = JSON.parse(jsonMatch[0]) as Partial<TextOverlayParams>
    return {
      position: parsed.position === 'top-center' ? 'top-center' : 'bottom-left',
      textColor: typeof parsed.textColor === 'string' && /^#[0-9A-Fa-f]{3,6}$/.test(parsed.textColor)
        ? parsed.textColor : '#FFFFFF',
      uppercase: typeof parsed.uppercase === 'boolean' ? parsed.uppercase : false,
      strokeColor: parsed.strokeColor && typeof parsed.strokeColor === 'string' && /^#[0-9A-Fa-f]{3,6}$/.test(parsed.strokeColor)
        ? parsed.strokeColor : null,
      strokeWidth: typeof parsed.strokeWidth === 'number' ? Math.max(0, Math.min(8, parsed.strokeWidth)) : 0,
      accentBar: typeof parsed.accentBar === 'boolean' ? parsed.accentBar : false,
      bandOpacity: typeof parsed.bandOpacity === 'number' ? Math.max(0, Math.min(0.9, parsed.bandOpacity)) : 0.7,
    }
  } catch (err) {
    console.error('[thumbnail] overlay analysis failed, using defaults:', err)
    return DEFAULT_OVERLAY_PARAMS
  }
}

// ─── Mode B: Claude generates the Flux prompt with text styling decided inline ─
//
// Instead of a fixed suffix, Claude decides how the title text should be visually
// integrated based on imageStyle and scene content — color, lettering, placement.

async function generateFluxPromptWithText(
  title: string,
  topic: string,
  imageStyle?: string,
  refStyle?: string,
  hasRefUrl?: boolean,
): Promise<string> {
  try {
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    // refStyle (uploaded reference) wins unconditionally — single unambiguous style source
    const effectiveStyle = refStyle || imageStyle || 'cinematic photography'

    // When a pixel reference is present, NB2/edit will inherit typography from the reference image
    // directly (color, outline, letter shape). Haiku must NOT also specify text styling — two
    // competing sources cause the model to ignore the reference and invent its own colors.
    const system = hasRefUrl
      ? `You write YouTube thumbnail image prompts for Flux AI image generator.
The prompt must place the video title text as a visible element in the scene.
Rules:
- Focus ONLY on scene composition, environment, and where to position the title text (framing, placement in frame)
- Do NOT specify text color, outline, stroke, glow, font style or any typographic treatment — those are inherited from the reference image
- CRITICAL: include the title text EXACTLY as given — never translate it, never rephrase it, preserve original language and spelling
- 30–40 words. Prompt in English only (except the title itself). Return only the prompt text.`
      : `You write YouTube thumbnail image prompts for Flux AI image generator.
The prompt must naturally integrate the video title text as a visual element in the scene.
Rules:
- Decide how to style and position the title text based on the image style and scene mood
- Describe the text styling organically as part of the scene description (e.g. "bold neon lettering", "hand-painted wooden sign with the title", "carved stone inscription", "comic book text bubble with the title", "retro painted billboard sign")
- The scene composition should frame and complement the text
- CRITICAL: include the title text EXACTLY as given — never translate it, never rephrase it, preserve original language and spelling
- 35–45 words. Prompt in English only (except the title itself). Return only the prompt text.`

    const userMsg = hasRefUrl
      ? `Video title: "${title}"
Topic: "${topic}"
Visual style: "${effectiveStyle}"

Write a thumbnail image prompt placing the title "${title}" in the scene. Describe only the scene and where the text is positioned — do NOT describe text color, outline, or any typographic style.`
      : `Video title: "${title}"
Topic: "${topic}"
Visual style: "${effectiveStyle}"

Write a thumbnail image prompt where the title "${title}" is naturally integrated as a visual element, with text styling that matches the ${effectiveStyle} aesthetic.`

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 160,
      system,
      messages: [{ role: 'user', content: userMsg }],
    })
    const block = msg.content[0]
    return block.type === 'text' ? block.text.trim()
      : `${topic} scene featuring bold title text "${title}" integrated naturally into the composition`
  } catch {
    return `${topic} scene featuring bold title text "${title}" integrated naturally into the composition`
  }
}

// ─── Cascade background generator: nano-banana-2 → nano-banana → flux/dev ────
//
// Mode A and C always use this cascade. Mode B (AI text baked in) is unchanged.
// On each failure the next engine is tried and logged; flux/dev is the guaranteed
// last-resort so the route can never fail due to a nano-banana outage.

// 16:9 ratio tolerance: ±5%. Outside → wrong aspect, cascade to next engine.
const THUMB_RATIO_TARGET = 16 / 9
const THUMB_RATIO_TOL = 0.05

function checkThumbRatio(w: number, h: number, model: string): void {
  if (w <= 0 || h <= 0) return
  const ratio = w / h
  console.log(`[thumbnail] ${model} returned ${w}x${h} (ratio ${ratio.toFixed(4)})`)
  if (Math.abs(ratio - THUMB_RATIO_TARGET) / THUMB_RATIO_TARGET > THUMB_RATIO_TOL) {
    throw new Error(`${model} returned wrong aspect ${w}x${h} (ratio ${ratio.toFixed(3)}, expected ~1.778), falling back`)
  }
}

async function generateThumbnailBg(prompt: string): Promise<string> {
  fal.config({ credentials: env('FAL_KEY') })

  // Primary: nano-banana-2 ($0.08/img, best quality + text)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (fal.subscribe as any)('fal-ai/nano-banana-2', {
      input: { prompt, aspect_ratio: '16:9', resolution: '1K', num_images: 1, output_format: 'jpeg' },
    }) as { data: { images: Array<{ url: string; width?: number; height?: number }> } }
    const img = r.data?.images?.[0]
    if (!img?.url) throw new Error('no image returned')
    checkThumbRatio(img.width ?? 0, img.height ?? 0, 'nano-banana-2')
    return await fetchAsBase64(img.url)
  } catch (e) {
    console.warn('[thumbnail] nano-banana-2 failed, falling back to nano-banana:', e instanceof Error ? e.message : e)
  }

  // Secondary: nano-banana v1
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (fal.subscribe as any)('fal-ai/nano-banana', {
      input: { prompt, aspect_ratio: '16:9', num_images: 1, output_format: 'jpeg' },
    }) as { data: { images: Array<{ url: string; width?: number; height?: number }> } }
    const img = r.data?.images?.[0]
    if (!img?.url) throw new Error('no image returned')
    checkThumbRatio(img.width ?? 0, img.height ?? 0, 'nano-banana')
    return await fetchAsBase64(img.url)
  } catch (e) {
    console.warn('[thumbnail] nano-banana failed, falling back to flux/dev:', e instanceof Error ? e.message : e)
  }

  // Final: flux/dev (guaranteed 1280×720)
  const r = await fal.subscribe('fal-ai/flux/dev', {
    input: { prompt, image_size: { width: 1280, height: 720 }, num_images: 1, num_inference_steps: 35 },
  }) as { data: { images: Array<{ url: string }> } }
  const url = r.data?.images?.[0]?.url
  if (!url) throw new Error('Flux не вернул изображение')
  console.log('[thumbnail] flux/dev fallback succeeded (1280x720)')
  return await fetchAsBase64(url)
}

// ─── Reference-edit cascade: NB2/edit → NB1/edit → text-to-image fallback ────
//
// fal-ai/nano-banana-2/edit accepts image_urls (Supabase public URL) + prompt.
// Instruction: generate new composition, match reference style, don't copy subject.
// Falls back to the existing text-to-image cascade if both edit endpoints fail.

async function generateThumbnailBgWithRef(prompt: string, refUrl: string): Promise<string> {
  fal.config({ credentials: env('FAL_KEY') })
  const editPrompt = `${prompt}. Create a NEW YouTube thumbnail composition; match the visual style, palette, lighting and mood of the reference image AND the typography treatment: text color, outline style, letter shape and placement manner — but render the NEW title text provided, not the words from the reference; do NOT copy its subject or layout.`

  // Primary: nano-banana-2/edit (same model, edit endpoint)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (fal.subscribe as any)('fal-ai/nano-banana-2/edit', {
      input: { prompt: editPrompt, image_urls: [refUrl], aspect_ratio: '16:9', resolution: '1K', num_images: 1, output_format: 'jpeg' },
    }) as { data: { images: Array<{ url: string; width?: number; height?: number }> } }
    const img = r.data?.images?.[0]
    if (!img?.url) throw new Error('no image returned')
    checkThumbRatio(img.width ?? 0, img.height ?? 0, 'nano-banana-2/edit')
    console.log('[thumbnail] nano-banana-2/edit succeeded')
    return await fetchAsBase64(img.url)
  } catch (e) {
    console.warn('[thumbnail] nano-banana-2/edit failed:', e instanceof Error ? e.message : e)
  }

  // Secondary: nano-banana/edit
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (fal.subscribe as any)('fal-ai/nano-banana/edit', {
      input: { prompt: editPrompt, image_urls: [refUrl], aspect_ratio: '16:9', num_images: 1, output_format: 'jpeg' },
    }) as { data: { images: Array<{ url: string; width?: number; height?: number }> } }
    const img = r.data?.images?.[0]
    if (!img?.url) throw new Error('no image returned')
    checkThumbRatio(img.width ?? 0, img.height ?? 0, 'nano-banana/edit')
    console.log('[thumbnail] nano-banana/edit succeeded')
    return await fetchAsBase64(img.url)
  } catch (e) {
    console.warn('[thumbnail] nano-banana/edit failed, falling back to text-to-image cascade:', e instanceof Error ? e.message : e)
  }

  // Fallback: text-to-image cascade (ref_style text description already in prompt via Haiku)
  return generateThumbnailBg(prompt)
}

// ─── Mode A/C: background-only Flux prompt ────────────────────────────────────

async function generateFluxPromptBackground(
  title: string,
  topic: string,
  refStyle?: string,
  imageStyle?: string,
): Promise<string> {
  try {
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: `You write dramatic background image prompts for YouTube thumbnails using Flux AI.
Rules:
- Vivid, eye-catching, high-contrast visuals only
- NO text, logos, watermarks, faces looking at camera
- Cinematic lighting, saturated colors, strong focal point
- 25–35 words. English only. Return only the prompt text.`,
      messages: [{
        role: 'user',
        content: (() => {
          const effectiveStyle = refStyle || imageStyle || null
          const styleHint = effectiveStyle ? `\nVisual style: ${effectiveStyle}` : ''
          return `Video title: "${title}"\nTopic: "${topic}"${styleHint}\nWrite a dramatic thumbnail background image prompt.`
        })(),
      }],
    })
    const block = msg.content[0]
    return block.type === 'text' ? block.text.trim()
      : `Dramatic cinematic scene about ${topic}, vivid colors, high contrast lighting, ultra-sharp`
  } catch {
    return `Dramatic cinematic scene about ${topic}, vivid colors, high contrast lighting, ultra-sharp`
  }
}

// ─── Mode B engine: GPT Image ─────────────────────────────────────────────────
//
// gpt-image-2 supports text rendering in multiple scripts including Cyrillic.
// Closest landscape size: 1536×1024 (3:2 ratio; YouTube thumbnail is 16:9).
//
// IMPORTANT: gpt-image-2 moderation blocks Cyrillic characters in the prompt text
// (output stage), but correctly renders Cyrillic glyphs when asked to display
// transliterated text "in Cyrillic script". We pre-process the prompt here.

const CYRILLIC_MAP: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'ye','ё':'yo','ж':'zh','з':'z',
  'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
  'с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh',
  'щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
  'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'Ye','Ё':'Yo','Ж':'Zh','З':'Z',
  'И':'I','Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R',
  'С':'S','Т':'T','У':'U','Ф':'F','Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh',
  'Щ':'Shch','Ъ':'','Ы':'Y','Ь':'','Э':'E','Ю':'Yu','Я':'Ya',
}

function sanitizePromptForGptImage(prompt: string): string {
  return prompt.replace(/[а-яёА-ЯЁ]+/g, (word) => {
    const latin = word.split('').map((c) => CYRILLIC_MAP[c] ?? c).join('')
    return `${latin} (in Cyrillic)`
  })
}

async function generateGptThumbnail(prompt: string): Promise<string> {
  const sanitized = sanitizePromptForGptImage(prompt)
  console.log('[thumbnail] gpt-image-2 sanitized prompt:', sanitized.slice(0, 200))

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt: sanitized,
      size: '1536x1024',
      quality: 'medium',
      n: 1,
    }),
  })
  const data = await res.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string } }
  if (!res.ok) {
    const msg = data.error?.message ?? String(res.status)
    if (msg.toLowerCase().includes('verif')) {
      throw new Error('GPT Image: требуется верификация организации OpenAI')
    }
    throw new Error(`GPT Image: ${msg}`)
  }
  const base64 = data.data?.[0]?.b64_json
  if (!base64) throw new Error('GPT Image: no image data in response')
  return `data:image/png;base64,${base64}`
}

// ─── Mode B engine: Gemini Image ──────────────────────────────────────────────
//
// Uses Google AI Studio API (not Google Cloud — simpler, no billing needed for testing).
// Model ID is configurable via GEMINI_IMAGE_MODEL env var.
// Set GEMINI_API_KEY from https://ai.google.dev/ to activate.

async function generateGeminiThumbnail(prompt: string): Promise<string> {
  const key = env('GEMINI_API_KEY')
  const model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3-pro-image-preview'

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    },
  )
  type GeminiPart = { inlineData?: { data: string; mimeType: string }; text?: string }
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>
    error?: { message?: string }
  }
  if (!res.ok) {
    throw new Error(`Gemini Image: ${data.error?.message ?? res.status}`)
  }
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const imgPart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'))
  if (!imgPart?.inlineData) throw new Error('Gemini Image: no image in response')
  return `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`
}

// ─── Text wrap ─────────────────────────────────────────────────────────────────

function wrapText(text: string, maxChars = 20): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (test.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 3)
}

// ─── Image fetch ───────────────────────────────────────────────────────────────

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Не удалось загрузить изображение (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  const mime = res.headers.get('content-type') ?? 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}

// ─── Generalized Satori renderer (all params dynamic) ─────────────────────────
//
// Handles both position variants with a single function.
// All visual parameters come from Claude's analysis of the actual image.

function buildThumbnailOverlay(
  bgDataUrl: string,
  lines: string[],
  fontSize: number,
  params: TextOverlayParams,
): React.ReactElement {
  const isTop = params.position === 'top-center'
  const bandHeight = 170

  const textLineEls = lines.map((line, i) =>
    React.createElement('div', {
      key: i,
      style: {
        fontFamily: 'Montserrat',
        fontSize,
        fontWeight: 900,
        color: params.textColor,
        lineHeight: 1.2,
        letterSpacing: params.uppercase ? '1px' : '-1px',
        textTransform: params.uppercase ? 'uppercase' as const : 'none' as const,
        ...(params.strokeColor && params.strokeWidth > 0
          ? { WebkitTextStroke: `${params.strokeWidth}px ${params.strokeColor}` }
          : {}),
        display: 'flex',
      },
    }, line),
  )

  const children: React.ReactElement[] = []

  // Background band / gradient
  if (params.bandOpacity > 0) {
    if (isTop) {
      children.push(React.createElement('div', {
        key: 'band',
        style: {
          position: 'absolute' as const, top: 0, left: 0, right: 0, height: bandHeight,
          background: `rgba(0,0,0,${params.bandOpacity})`,
          display: 'flex',
        },
      }))
    } else {
      // Gradient fades in from transparent, matches original default appearance when bandOpacity≈0.94
      const mid = Math.max(0, params.bandOpacity - 0.35).toFixed(2)
      const full = params.bandOpacity.toFixed(2)
      children.push(React.createElement('div', {
        key: 'gradient',
        style: {
          position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 380,
          background: `linear-gradient(to bottom, transparent 0%, rgba(0,0,0,${mid}) 45%, rgba(0,0,0,${full}) 100%)`,
          display: 'flex',
        },
      }))
    }
  }

  // Text container
  if (isTop) {
    children.push(React.createElement('div', {
      key: 'text',
      style: {
        position: 'absolute' as const, top: 0, left: 0, right: 0, height: bandHeight,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 60px',
      },
    },
      React.createElement('div', {
        style: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 6 },
      }, ...textLineEls),
    ))
  } else {
    const textStack = React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
    }, ...textLineEls)

    const innerRow = params.accentBar
      ? React.createElement('div', {
          style: { display: 'flex', flexDirection: 'row' as const, alignItems: 'stretch', gap: 22 },
        },
          React.createElement('div', {
            key: 'bar',
            style: { width: 10, background: '#FF0000', borderRadius: 5, flexShrink: 0, display: 'flex' },
          }),
          textStack,
        )
      : textStack

    children.push(React.createElement('div', {
      key: 'text',
      style: { position: 'absolute' as const, bottom: 48, left: 56, right: 80, display: 'flex' },
    }, innerRow))
  }

  return React.createElement('div', {
    style: {
      width: 1280, height: 720,
      display: 'flex',
      position: 'relative' as const,
      backgroundImage: `url(${bgDataUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    },
  }, ...children)
}

// ─── Compose thumbnail with Claude-determined overlay params ───────────────────

async function createThumbnailBuffer(bgDataUrl: string, title: string, refStyle?: string): Promise<{ buffer: Buffer; overlayParams: TextOverlayParams }> {
  const lines = wrapText(title)
  const lineCount = lines.length
  const fontSize = lineCount === 1 ? 82 : lineCount === 2 ? 70 : 58

  const fontData = MONTSERRAT_BLACK.buffer.slice(
    MONTSERRAT_BLACK.byteOffset,
    MONTSERRAT_BLACK.byteOffset + MONTSERRAT_BLACK.byteLength,
  ) as ArrayBuffer

  const overlayParams = await analyzeImageForTextOverlay(bgDataUrl, title, refStyle)
  console.log('[thumbnail] overlay params from Claude:', JSON.stringify(overlayParams))

  const rootEl = buildThumbnailOverlay(bgDataUrl, lines, fontSize, overlayParams)

  const response = new ImageResponse(rootEl, {
    width: 1280,
    height: 720,
    fonts: [{ name: 'Montserrat', data: fontData, weight: 900 }],
  })

  return { buffer: Buffer.from(await response.arrayBuffer()), overlayParams }
}

// ─── Route ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body: ThumbnailRequest = await request.json()
    const { project_id, title, topic, bg_url, dry_run, custom_prompt, ref_style, ref_url, text_mode = 'overlay', image_style } = body

    if (!project_id || !title?.trim() || !topic?.trim()) {
      return NextResponse.json(
        { ok: false, error: 'project_id, title и topic обязательны' },
        { status: 400 },
      )
    }

    // THUMBNAIL_AI_TEXT_ENGINE: when set to 'gpt' or 'gemini', mode=ai uses external engine for text-in-image.
    // Default 'nano_banana_2' (NB2 cascade). Set in Vercel env if switching engines.
    const AI_TEXT_ENGINE_HINT = text_mode === 'ai'
      ? (process.env.THUMBNAIL_AI_TEXT_ENGINE ?? 'nano_banana_2')
      : 'overlay'
    Sentry.setUser({ id: user.id })
    Sentry.setContext('generate', { project_id, text_mode, engine: AI_TEXT_ENGINE_HINT })

    console.log(`[thumbnail] image_style="${image_style ?? 'none'}" ref_style="${(ref_style ?? '').slice(0, 60) || 'none'}" ref_url=${ref_url ? 'yes' : 'no'}`)

    // dry_run: return the Flux prompt only — no image generation, no credits
    if (dry_run) {
      const prompt = custom_prompt?.trim() || (
        text_mode === 'ai'
          ? await generateFluxPromptWithText(title, topic, image_style, ref_style, !!ref_url)
          : await generateFluxPromptBackground(title, topic, ref_style, image_style)
      )
      return NextResponse.json({ ok: true, data: { prompt } })
    }

    const check = await requireCredits(user.id, 'thumbnail', supabase)
    if (!check.ok) return NextResponse.json(check, { status: 402 })

    const serviceClient = createServiceClient()
    let bgDataUrl: string
    let storedBgUrl: string

    if (bg_url && text_mode !== 'ai') {
      // Re-use stored background (Mode B always needs fresh generation because text is baked in)
      console.log('[thumbnail] re-using bg:', bg_url.split('?')[0])
      bgDataUrl = await fetchAsBase64(bg_url)
      const { data: { publicUrl } } = serviceClient.storage
        .from('images')
        .getPublicUrl(`${user.id}/${project_id}/thumbnail_bg.jpg`)
      storedBgUrl = publicUrl
    } else {
      const rawPrompt = custom_prompt?.trim() || (
        text_mode === 'ai'
          ? await generateFluxPromptWithText(title, topic, image_style, ref_style, !!ref_url)
          : await generateFluxPromptBackground(title, topic, ref_style, image_style)
      )

      // Apply project illustration style suffix for visual consistency — same as image-single/route.ts.
      // Skip when ref_url is present: pixel reference controls style, two sources would conflict.
      const fluxSuffix = (image_style && !ref_url) ? getStyleConfig(image_style).fluxSuffix : ''
      const prompt = fluxSuffix ? `${rawPrompt}, ${fluxSuffix}` : rawPrompt

      // Mode B: GPT/Gemini only if explicitly set via env; default → nano-banana-2 cascade
      const AI_TEXT_ENGINE = (process.env.THUMBNAIL_AI_TEXT_ENGINE ?? 'nano_banana_2') as 'flux' | 'gpt' | 'gemini' | 'nano_banana_2'
      const usesExternalEngine = text_mode === 'ai' && (AI_TEXT_ENGINE === 'gpt' || AI_TEXT_ENGINE === 'gemini')

      if (usesExternalEngine) {
        console.log(`[thumbnail] mode=ai engine=${AI_TEXT_ENGINE} prompt: ${prompt}`)
        bgDataUrl = AI_TEXT_ENGINE === 'gemini'
          ? await generateGeminiThumbnail(prompt)
          : await generateGptThumbnail(prompt)
      } else if (ref_url) {
        const editBase = text_mode === 'ai' ? prompt : `${prompt}, NO TEXT, NO WATERMARKS`
        console.log(`[thumbnail] mode=${text_mode} engine=nano-banana-2/edit (ref) prompt: ${editBase}`)
        bgDataUrl = await generateThumbnailBgWithRef(editBase, ref_url)
      } else {
        const fluxPrompt = text_mode === 'ai' ? prompt : `${prompt}, NO TEXT, NO WATERMARKS`
        console.log(`[thumbnail] mode=${text_mode} engine=nano-banana-2 (cascade) prompt: ${fluxPrompt}`)
        bgDataUrl = await generateThumbnailBg(fluxPrompt)
      }

      // Detect actual format to set correct content-type (GPT/Gemini return PNG, Flux JPEG)
      const bgMime = bgDataUrl.split(';')[0].split(':')[1] ?? 'image/jpeg'
      const bgExt = bgMime.includes('png') ? 'png' : 'jpg'
      const bgPath = `${user.id}/${project_id}/thumbnail_bg.${bgExt}`
      const rawBuf = Buffer.from(bgDataUrl.split(',')[1], 'base64')
      await serviceClient.storage.from('images').upload(bgPath, rawBuf, {
        contentType: bgMime,
        upsert: true,
      })
      const { data: { publicUrl } } = serviceClient.storage.from('images').getPublicUrl(bgPath)
      storedBgUrl = publicUrl
    }

    let thumbBuf: Buffer
    let overlayParams: TextOverlayParams | null = null

    if (text_mode === 'overlay') {
      // Mode A: Claude analyzes the actual image → dynamic text overlay params → Satori render
      const result = await createThumbnailBuffer(bgDataUrl, title.trim(), ref_style ?? undefined)
      thumbBuf = result.buffer
      overlayParams = result.overlayParams
    } else {
      // Mode B (text baked in by Flux) or Mode C (no text): use raw background as thumbnail
      thumbBuf = Buffer.from(bgDataUrl.split(',')[1], 'base64')
    }

    const thumbPath = `${user.id}/${project_id}/thumbnail.png`
    await serviceClient.storage.from('images').upload(thumbPath, thumbBuf, {
      contentType: 'image/png',
      upsert: true,
    })
    const { data: { publicUrl: thumbUrl } } = serviceClient.storage
      .from('images')
      .getPublicUrl(thumbPath)

    await supabase
      .from('projects')
      .update({ thumbnail_url: thumbUrl, thumbnail_text_mode: text_mode })
      .eq('id', project_id)
      .eq('user_id', user.id)

    await spendCredits(user.id, CREDIT_COSTS.thumbnail, 'thumbnail', project_id)

    const ts = Date.now()
    return NextResponse.json({
      ok: true,
      data: {
        thumbnail_url: `${thumbUrl}?t=${ts}`,
        bg_url: `${storedBgUrl}?t=${ts}`,
        // Included for testing: shows what parameters Claude chose for this specific image
        overlay_params: overlayParams,
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[thumbnail]', msg)
    if (isBillingError(msg)) await notifyBillingError('Anthropic', '/generate/thumbnail').catch(() => {})
    return NextResponse.json({ ok: false, error: 'Ошибка генерации превью' }, { status: 500 })
  }
}
