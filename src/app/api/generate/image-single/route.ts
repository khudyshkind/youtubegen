import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { fal } from '@fal-ai/client'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { CREDIT_COSTS } from '@/lib/types'
import type { SceneImage } from '@/lib/types'

export const maxDuration = 120

interface SingleImageRequest {
  project_id: string
  scene_index: number
  prompt: string
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
      system: `You are an expert at writing image generation prompts for Flux AI (photorealistic model).
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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body: SingleImageRequest = await request.json()
    const { project_id, scene_index, prompt } = body

    if (!project_id || scene_index === undefined || !prompt?.trim()) {
      return NextResponse.json(
        { ok: false, error: 'project_id, scene_index и prompt обязательны' },
        { status: 400 }
      )
    }

    const check = await requireCredits(user.id, 'image', supabase)
    if (!check.ok) return NextResponse.json(check, { status: 402 })

    const enhancedPrompt = await enhancePrompt(prompt)
    console.log(`[image-single] scene_index=${scene_index} enhanced prompt:`, enhancedPrompt)

    // Fetch existing scene metadata BEFORE generating, to preserve scene/timecode fields
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

    fal.config({ credentials: env('FAL_KEY') })
    const result = await fal.subscribe('fal-ai/flux/dev', {
      input: {
        prompt: `${enhancedPrompt}, NO TEXT, NO WATERMARKS`,
        image_size: { width: 1280, height: 720 },
        num_images: 1,
        num_inference_steps: 35,
      },
    }) as { data: FalImageResult }

    const falUrl = result.data?.images?.[0]?.url ?? null
    if (!falUrl) throw new Error('Flux не вернул изображение')

    const serviceClient = createServiceClient()
    const storagePath = `${user.id}/${project_id}/scene_${scene_index}.jpg`

    let storedUrl = falUrl
    const imgResponse = await fetch(falUrl)
    if (imgResponse.ok) {
      const { error: uploadError } = await serviceClient.storage
        .from('images')
        .upload(storagePath, await imgResponse.arrayBuffer(), {
          contentType: 'image/jpeg',
          upsert: true,
        })
      if (!uploadError) {
        const { data: { publicUrl } } = serviceClient.storage.from('images').getPublicUrl(storagePath)
        storedUrl = publicUrl
      }
    }

    // Preserve original scene metadata; only replace prompt + url
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

    await spendCredits(user.id, CREDIT_COSTS.image, 'image', project_id)

    return NextResponse.json({ ok: true, data: { image: newImage } })
  } catch (error) {
    console.error('[image-single]', error)
    return NextResponse.json({ ok: false, error: 'Ошибка генерации иллюстрации' }, { status: 500 })
  }
}
