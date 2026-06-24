import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { fal } from '@fal-ai/client'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { CREDIT_COSTS } from '@/lib/types'
import type { SceneImage } from '@/lib/types'
import { getStyleConfig } from '@/lib/image-style-configs'

export const maxDuration = 120

type ImageEngine = 'flux' | 'flux_schnell' | 'gpt_mini'

interface SingleImageRequest {
  project_id: string
  scene_index: number
  prompt: string
  engine?: ImageEngine
  image_style?: string
}

interface FalImageResult {
  images: Array<{ url: string }>
}

async function enhancePrompt(raw: string, styleHint: string): Promise<string> {
  try {
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `You are an expert at writing image generation prompts for AI image models.
STYLE: ${styleHint}
RULES: Generate LITERAL visual descriptions only. No metaphors, no abstract art.
Start with the MAIN VISUAL SUBJECT. Add relevant details matching the style.
30–40 words. English only. Return only the prompt text, nothing else.`,
      messages: [{ role: 'user', content: `Enhance this scene description: ${raw}` }],
    })
    const block = msg.content[0]
    return block.type === 'text' ? block.text.trim() : raw
  } catch {
    return raw
  }
}

async function generateFlux(
  prompt: string,
  negativePrompt: string,
  userId: string,
  projectId: string,
  sceneIndex: number,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<string> {
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

  const falUrl = result.data?.images?.[0]?.url ?? null
  if (!falUrl) throw new Error('Flux не вернул изображение')

  const storagePath = `${userId}/${projectId}/scene_${sceneIndex}.jpg`
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

async function generateFluxSchnell(
  prompt: string,
  userId: string,
  projectId: string,
  sceneIndex: number,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<string> {
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

async function generateGptMini(
  prompt: string,
  userId: string,
  projectId: string,
  sceneIndex: number,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<string> {
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
  const storagePath = `${userId}/${projectId}/scene_gpt_${sceneIndex}.png`

  const { error: uploadError } = await serviceClient.storage
    .from('images')
    .upload(storagePath, buffer, { contentType: 'image/png', upsert: true })
  if (uploadError) throw new Error(`Storage: ${uploadError.message}`)

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

    const body: SingleImageRequest = await request.json()
    const { project_id, scene_index, prompt, engine = 'flux', image_style } = body

    if (!project_id || scene_index === undefined || !prompt?.trim()) {
      return NextResponse.json(
        { ok: false, error: 'project_id, scene_index и prompt обязательны' },
        { status: 400 },
      )
    }

    const costKey = engine === 'gpt_mini' ? 'image_gpt_mini' : engine === 'flux_schnell' ? 'image_flux_schnell' : 'image_flux'
    const cost = CREDIT_COSTS[costKey]

    const check = await requireCredits(user.id, costKey, supabase)
    if (!check.ok) return NextResponse.json(check, { status: 402 })

    const styleConfig = getStyleConfig(image_style)
    const enhancedBase = await enhancePrompt(prompt, styleConfig.enhanceSystemHint)
    const enhancedPrompt = `${enhancedBase}, ${styleConfig.fluxSuffix}`
    console.log(`[image-single] engine=${engine} scene_index=${scene_index} style="${image_style ?? 'default'}"`)
    console.log(`[image-single] FINAL flux prompt: "${enhancedPrompt.slice(0, 180)}"`)
    console.log(`[image-single] NEGATIVE prompt: "${styleConfig.negativePrompt}"`)

    const { data: projectRow } = await supabase
      .from('projects')
      .select('scene_images')
      .eq('id', project_id)
      .eq('user_id', user.id)
      .single()

    if (!projectRow) {
      return NextResponse.json({ ok: false, error: 'Проект не найден' }, { status: 404 })
    }

    const existing: SceneImage[] = projectRow?.scene_images ?? []
    const originalScene = existing.find((img) => img.scene_index === scene_index)

    const serviceClient = createServiceClient()

    const storedUrl = engine === 'gpt_mini'
      ? await generateGptMini(enhancedPrompt, user.id, project_id, scene_index, serviceClient)
      : engine === 'flux_schnell'
      ? await generateFluxSchnell(enhancedPrompt, user.id, project_id, scene_index, serviceClient)
      : await generateFlux(enhancedPrompt, styleConfig.negativePrompt, user.id, project_id, scene_index, serviceClient)

    const newImage: SceneImage = {
      ...(originalScene ?? {}),
      scene_index,
      prompt: enhancedPrompt,
      url: storedUrl,
      engine,
    }

    const updated = existing.some((img) => img.scene_index === scene_index)
      ? existing.map((img) => img.scene_index === scene_index ? newImage : img)
      : [...existing, newImage]

    await supabase
      .from('projects')
      .update({ scene_images: updated })
      .eq('id', project_id)
      .eq('user_id', user.id)

    await spendCredits(user.id, cost, `image_${engine}`, project_id)

    return NextResponse.json({ ok: true, data: { image: newImage } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[image-single]', msg)
    if (msg.includes('верификация') || msg.toLowerCase().includes('verif')) {
      return NextResponse.json({ ok: false, error: msg }, { status: 403 })
    }
    return NextResponse.json({ ok: false, error: 'Ошибка генерации иллюстрации' }, { status: 500 })
  }
}
