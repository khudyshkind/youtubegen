import { readFileSync } from 'fs'
import { join } from 'path'
import { NextRequest, NextResponse } from 'next/server'
import React from 'react'
import { ImageResponse } from 'next/og'
import Anthropic from '@anthropic-ai/sdk'
import { fal } from '@fal-ai/client'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { CREDIT_COSTS } from '@/lib/types'
import type { ThumbnailTextMode, TextPresetKey } from '@/lib/thumbnail-text-presets'
import { getTextPresetKey, getModeBAiPromptSuffix } from '@/lib/thumbnail-text-presets'

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
  text_mode?: ThumbnailTextMode
  image_style?: string
}

interface FalImageResult {
  images: Array<{ url: string }>
}

// ─── Flux background prompt ────────────────────────────────────────────────────

async function generateFluxPrompt(
  title: string,
  topic: string,
  refStyle?: string,
  embedTitle?: string,
  presetKey?: TextPresetKey,
): Promise<string> {
  try {
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const systemPrompt = embedTitle
      ? `You write YouTube thumbnail image prompts for Flux AI where the title text is part of the image.
Rules:
- Include bold stylized title text in the scene as described
- Vivid, eye-catching, high-contrast visuals that complement the text
- 30–40 words. English only. Return only the prompt text.`
      : `You write dramatic background image prompts for YouTube thumbnails using Flux AI.
Rules:
- Vivid, eye-catching, high-contrast visuals only
- NO text, logos, watermarks, faces looking at camera
- Cinematic lighting, saturated colors, strong focal point
- 25–35 words. English only. Return only the prompt text.`

    const userContent = embedTitle
      ? `Video title: "${title}"\nTopic: "${topic}"${refStyle ? `\nVisual style reference: ${refStyle}` : ''}\n\nGenerate a thumbnail prompt that includes the title text "${embedTitle}" as part of the image${getModeBAiPromptSuffix(embedTitle, presetKey ?? 'default')}`
      : `Video title: "${title}"\nTopic: "${topic}"${refStyle ? `\nVisual style reference: ${refStyle}` : ''}\nWrite a dramatic thumbnail background image prompt.`

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    })
    const block = msg.content[0]
    return block.type === 'text'
      ? block.text.trim()
      : `Dramatic cinematic scene about ${topic}, vivid colors, high contrast lighting, ultra-sharp`
  } catch {
    return `Dramatic cinematic scene about ${topic}, vivid colors, high contrast lighting, ultra-sharp`
  }
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

// ─── Thumbnail composer — default preset ──────────────────────────────────────
//
// Layout (1280×720):
//   [background image fills frame]
//   [gradient overlay: transparent → black, bottom 40%]
//   [red 8px bar at very bottom edge]
//   [text block bottom-left: red vertical accent + bold white text]

function buildThumbnailDefault(bgDataUrl: string, lines: string[], fontSize: number): React.ReactElement {
  const textLineEls = lines.map((line, i) =>
    React.createElement('div', {
      key: i,
      style: {
        fontFamily: 'Montserrat',
        fontSize,
        fontWeight: 900,
        color: 'white',
        lineHeight: 1.18,
        letterSpacing: '-1px',
        display: 'flex',
      },
    }, line),
  )

  return React.createElement('div', {
    style: {
      width: 1280, height: 720,
      display: 'flex',
      position: 'relative' as const,
      backgroundImage: `url(${bgDataUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    },
  },
    // Gradient overlay
    React.createElement('div', {
      style: {
        position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 380,
        background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.94) 100%)',
        display: 'flex',
      },
    }),
    // Text block
    React.createElement('div', {
      style: { position: 'absolute' as const, bottom: 48, left: 56, right: 80, display: 'flex' },
    },
      React.createElement('div', {
        style: { display: 'flex', flexDirection: 'row' as const, alignItems: 'stretch', gap: 22 },
      },
        React.createElement('div', {
          style: { width: 10, background: '#FF0000', borderRadius: 5, flexShrink: 0, display: 'flex' },
        }),
        React.createElement('div', {
          style: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
        }, ...textLineEls),
      ),
    ),
  )
}

// ─── Thumbnail composer — cartoon preset ──────────────────────────────────────
//
// Layout (1280×720):
//   [background image fills frame]
//   [semi-transparent dark band top 170px]
//   [yellow UPPERCASE text top-center, with simulated stroke]

function buildThumbnailCartoon(bgDataUrl: string, lines: string[], fontSize: number): React.ReactElement {
  const textLineEls = lines.map((line, i) =>
    React.createElement('div', {
      key: i,
      style: {
        fontFamily: 'Montserrat',
        fontSize,
        fontWeight: 900,
        color: '#FFE600',
        lineHeight: 1.2,
        letterSpacing: '2px',
        textTransform: 'uppercase' as const,
        WebkitTextStroke: '5px #111111',
        display: 'flex',
      },
    }, line),
  )

  return React.createElement('div', {
    style: {
      width: 1280, height: 720,
      display: 'flex',
      position: 'relative' as const,
      backgroundImage: `url(${bgDataUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    },
  },
    // Dark band at top
    React.createElement('div', {
      style: {
        position: 'absolute' as const, top: 0, left: 0, right: 0, height: 170,
        background: 'rgba(0,0,0,0.62)',
        display: 'flex',
      },
    }),
    // Text container top-center
    React.createElement('div', {
      style: {
        position: 'absolute' as const, top: 0, left: 0, right: 0, height: 170,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 60px',
      },
    },
      React.createElement('div', {
        style: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 6 },
      }, ...textLineEls),
    ),
  )
}

// ─── Compose thumbnail (dispatches by preset) ─────────────────────────────────

async function createThumbnailBuffer(bgDataUrl: string, title: string, presetKey: TextPresetKey): Promise<Buffer> {
  const lines = wrapText(title)
  const lineCount = lines.length
  const fontSize = lineCount === 1 ? 82 : lineCount === 2 ? 70 : 58

  const fontData = MONTSERRAT_BLACK.buffer.slice(
    MONTSERRAT_BLACK.byteOffset,
    MONTSERRAT_BLACK.byteOffset + MONTSERRAT_BLACK.byteLength,
  ) as ArrayBuffer

  const rootEl = presetKey === 'cartoon'
    ? buildThumbnailCartoon(bgDataUrl, lines, fontSize)
    : buildThumbnailDefault(bgDataUrl, lines, fontSize)

  const response = new ImageResponse(rootEl, {
    width: 1280,
    height: 720,
    fonts: [{ name: 'Montserrat', data: fontData, weight: 900 }],
  })
  return Buffer.from(await response.arrayBuffer())
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
    const { project_id, title, topic, bg_url, dry_run, custom_prompt, ref_style, text_mode = 'overlay', image_style } = body

    if (!project_id || !title?.trim() || !topic?.trim()) {
      return NextResponse.json(
        { ok: false, error: 'project_id, title и topic обязательны' },
        { status: 400 },
      )
    }

    const presetKey = getTextPresetKey(image_style)

    // dry_run: just return the generated prompt, no credits, no Flux call
    if (dry_run) {
      const embedTitle = text_mode === 'ai' ? title.trim() : undefined
      const dryPrompt = custom_prompt?.trim() || await generateFluxPrompt(title, topic, ref_style, embedTitle, presetKey)
      return NextResponse.json({ ok: true, data: { prompt: dryPrompt } })
    }

    const check = await requireCredits(user.id, 'thumbnail', supabase)
    if (!check.ok) return NextResponse.json(check, { status: 402 })

    const serviceClient = createServiceClient()
    let bgDataUrl: string
    let storedBgUrl: string

    if (bg_url && text_mode !== 'ai') {
      // Re-use stored background (not applicable for Mode B — text is baked in)
      console.log('[thumbnail] re-using bg:', bg_url.split('?')[0])
      bgDataUrl = await fetchAsBase64(bg_url)
      const { data: { publicUrl } } = serviceClient.storage
        .from('images')
        .getPublicUrl(`${user.id}/${project_id}/thumbnail_bg.jpg`)
      storedBgUrl = publicUrl
    } else {
      // Generate new background via Flux
      const embedTitle = text_mode === 'ai' ? title.trim() : undefined
      const prompt = custom_prompt?.trim() || await generateFluxPrompt(title, topic, ref_style, embedTitle, presetKey)
      console.log(`[thumbnail] mode=${text_mode} preset=${presetKey} prompt: ${prompt}`)

      fal.config({ credentials: env('FAL_KEY') })
      const fluxPrompt = text_mode === 'ai'
        ? prompt  // AI text — don't suppress text
        : `${prompt}, NO TEXT, NO WATERMARKS`

      const result = await fal.subscribe('fal-ai/flux/dev', {
        input: {
          prompt: fluxPrompt,
          image_size: { width: 1280, height: 720 },
          num_images: 1,
          num_inference_steps: 35,
        },
      }) as { data: FalImageResult }

      const falUrl = result.data?.images?.[0]?.url
      if (!falUrl) throw new Error('Flux не вернул изображение')

      bgDataUrl = await fetchAsBase64(falUrl)

      const bgPath = `${user.id}/${project_id}/thumbnail_bg.jpg`
      const rawBuf = Buffer.from(bgDataUrl.split(',')[1], 'base64')
      await serviceClient.storage.from('images').upload(bgPath, rawBuf, {
        contentType: 'image/jpeg',
        upsert: true,
      })
      const { data: { publicUrl } } = serviceClient.storage.from('images').getPublicUrl(bgPath)
      storedBgUrl = publicUrl
    }

    let thumbBuf: Buffer

    if (text_mode === 'overlay') {
      // Mode A: programmatic text overlay with style-adaptive preset
      thumbBuf = await createThumbnailBuffer(bgDataUrl, title.trim(), presetKey)
    } else {
      // Mode B (AI drew text) or Mode C (no text): use raw background as-is
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
      },
    })
  } catch (error) {
    console.error('[thumbnail]', error)
    return NextResponse.json({ ok: false, error: 'Ошибка генерации превью' }, { status: 500 })
  }
}
