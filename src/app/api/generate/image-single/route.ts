import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { fal } from '@fal-ai/client'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { CREDIT_COSTS } from '@/lib/types'
import type { SceneImage } from '@/lib/types'

export const maxDuration = 120

type ImageEngine = 'flux' | 'gpt_mini'

interface SingleImageRequest {
  project_id: string
  scene_index: number
  prompt: string
  engine?: ImageEngine
}

interface FalImageResult {
  images: Array<{ url: string }>
}

async function enhancePrompt(raw: string): Promise<string> {
  try {
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `You are an expert at writing image generation prompts for AI image models (photorealistic style).
RULES: Generate LITERAL visual descriptions only. No metaphors, no abstract art.
Start with the MAIN VISUAL SUBJECT. Add camera angle, lighting, time of day, colors, environment.
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
  userId: string,
  projectId: string,
  sceneIndex: number,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<string> {
  fal.config({ credentials: env('FAL_KEY') })
  const result = await fal.subscribe('fal-ai/flux/dev', {
    input: {
      prompt: `${prompt}, NO TEXT, NO WATERMARKS`,
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
  const storagePath = `${userId}/${projectId}/scene_${sceneIndex}.jpg`

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
    const { project_id, scene_index, prompt, engine = 'flux' } = body

    if (!project_id || scene_index === undefined || !prompt?.trim()) {
      return NextResponse.json(
        { ok: false, error: 'project_id, scene_index и prompt обязательны' },
        { status: 400 },
      )
    }

    const costKey = engine === 'gpt_mini' ? 'image_gpt_mini' : 'image_flux'
    const cost = CREDIT_COSTS[costKey]

    const check = await requireCredits(user.id, engine === 'gpt_mini' ? 'image_gpt_mini' : 'image', supabase)
    if (!check.ok) return NextResponse.json(check, { status: 402 })

    const enhancedPrompt = await enhancePrompt(prompt)
    console.log(`[image-single] engine=${engine} scene_index=${scene_index} prompt:`, enhancedPrompt)

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
      : await generateFlux(enhancedPrompt, user.id, project_id, scene_index, serviceClient)

    const newImage: SceneImage = {
      ...(originalScene ?? {}),
      scene_index,
      prompt: enhancedPrompt,
      url: storedUrl,
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
    console.error('[image-single]', error)
    return NextResponse.json({ ok: false, error: 'Ошибка генерации иллюстрации' }, { status: 500 })
  }
}
