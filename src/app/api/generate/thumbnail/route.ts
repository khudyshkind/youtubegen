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

// Loaded once per cold start — avoids re-reading on every request
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
}

interface FalImageResult {
  images: Array<{ url: string }>
}

// ─── Flux prompt ───────────────────────────────────────────────────────────────

async function generateFluxPrompt(title: string, topic: string, refStyle?: string): Promise<string> {
  try {
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      system: `You write dramatic background image prompts for YouTube thumbnails using Flux AI.
Rules:
- Vivid, eye-catching, high-contrast visuals only
- NO text, logos, watermarks, faces looking at camera
- Cinematic lighting, saturated colors, strong focal point
- 25–35 words. English only. Return only the prompt text.`,
      messages: [{
        role: 'user',
        content: `Video title: "${title}"\nTopic: "${topic}"${refStyle ? `\nVisual style reference: ${refStyle}` : ''}\nWrite a dramatic thumbnail background image prompt.`,
      }],
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

// ─── Thumbnail composer ────────────────────────────────────────────────────────
//
// Layout (1280×720):
//   [background image fills frame]
//   [gradient overlay: transparent → black, bottom 40%]
//   [red 8px bar at very bottom edge]
//   [logo pill top-right: red square + "YouTubeGen"]
//   [text block bottom-left: red vertical accent + bold white text]

async function createThumbnailBuffer(bgDataUrl: string, title: string): Promise<Buffer> {
  const lines = wrapText(title)
  const lineCount = lines.length
  const fontSize = lineCount === 1 ? 82 : lineCount === 2 ? 70 : 58

  const fontData = MONTSERRAT_BLACK.buffer.slice(
    MONTSERRAT_BLACK.byteOffset,
    MONTSERRAT_BLACK.byteOffset + MONTSERRAT_BLACK.byteLength,
  ) as ArrayBuffer

  // ── Gradient overlay (bottom 380px) ──────────────────────────────────────────
  const gradientEl = React.createElement('div', {
    style: {
      position: 'absolute' as const,
      bottom: 0,
      left: 0,
      right: 0,
      height: 380,
      background:
        'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.94) 100%)',
      display: 'flex',
    },
  })

  // ── Text lines ────────────────────────────────────────────────────────────────
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

  // ── Text column (lines stacked) ───────────────────────────────────────────────
  const textColEl = React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 8,
    },
  }, ...textLineEls)

  // ── Red left accent + text (side by side) ─────────────────────────────────────
  const textRowEl = React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'row' as const,
      alignItems: 'stretch',
      gap: 22,
    },
  },
    React.createElement('div', {
      style: {
        width: 10,
        background: '#FF0000',
        borderRadius: 5,
        flexShrink: 0,
        display: 'flex',
      },
    }),
    textColEl,
  )

  // ── Bottom text container (absolute) ─────────────────────────────────────────
  const textContainerEl = React.createElement('div', {
    style: {
      position: 'absolute' as const,
      bottom: 48,
      left: 56,
      right: 80,
      display: 'flex',
    },
  }, textRowEl)

  // ── Root ─────────────────────────────────────────────────────────────────────
  const rootEl = React.createElement('div', {
    style: {
      width: 1280,
      height: 720,
      display: 'flex',
      position: 'relative' as const,
      backgroundImage: `url(${bgDataUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    },
  }, gradientEl, textContainerEl)

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
    const { project_id, title, topic, bg_url, dry_run, custom_prompt, ref_style } = body

    if (!project_id || !title?.trim() || !topic?.trim()) {
      return NextResponse.json(
        { ok: false, error: 'project_id, title и topic обязательны' },
        { status: 400 },
      )
    }

    // dry_run: just return the generated prompt, no credits, no Flux call
    if (dry_run) {
      const dryPrompt = custom_prompt?.trim() || await generateFluxPrompt(title, topic, ref_style)
      return NextResponse.json({ ok: true, data: { prompt: dryPrompt } })
    }

    const check = await requireCredits(user.id, 'thumbnail', supabase)
    if (!check.ok) return NextResponse.json(check, { status: 402 })

    const serviceClient = createServiceClient()
    let bgDataUrl: string
    let storedBgUrl: string

    if (bg_url) {
      console.log('[thumbnail] re-using bg:', bg_url.split('?')[0])
      bgDataUrl = await fetchAsBase64(bg_url)
      const { data: { publicUrl } } = serviceClient.storage
        .from('images')
        .getPublicUrl(`${user.id}/${project_id}/thumbnail_bg.jpg`)
      storedBgUrl = publicUrl
    } else {
      const prompt = custom_prompt?.trim() || await generateFluxPrompt(title, topic, ref_style)
      console.log('[thumbnail] Flux prompt:', prompt)

      fal.config({ credentials: env('FAL_KEY') })
      const result = await fal.subscribe('fal-ai/flux/dev', {
        input: {
          prompt: `${prompt}, NO TEXT, NO WATERMARKS`,
          image_size: { width: 1280, height: 720 },
          num_images: 1,
          num_inference_steps: 35,
        },
      }) as { data: FalImageResult }

      const falUrl = result.data?.images?.[0]?.url
      if (!falUrl) throw new Error('Flux не вернул изображение')

      bgDataUrl = await fetchAsBase64(falUrl)

      // Store raw background (no text) for "Изменить текст" flow
      const bgPath = `${user.id}/${project_id}/thumbnail_bg.jpg`
      const rawBuf = Buffer.from(bgDataUrl.split(',')[1], 'base64')
      await serviceClient.storage.from('images').upload(bgPath, rawBuf, {
        contentType: 'image/jpeg',
        upsert: true,
      })
      const { data: { publicUrl } } = serviceClient.storage.from('images').getPublicUrl(bgPath)
      storedBgUrl = publicUrl
    }

    // Compose thumbnail (WebAssembly via next/og — no native dependencies)
    const thumbBuf = await createThumbnailBuffer(bgDataUrl, title.trim())

    // Upload final PNG
    const thumbPath = `${user.id}/${project_id}/thumbnail.png`
    await serviceClient.storage.from('images').upload(thumbPath, thumbBuf, {
      contentType: 'image/png',
      upsert: true,
    })
    const { data: { publicUrl: thumbUrl } } = serviceClient.storage
      .from('images')
      .getPublicUrl(thumbPath)

    // Save URL to the specific project only
    await supabase
      .from('projects')
      .update({ thumbnail_url: thumbUrl })
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
