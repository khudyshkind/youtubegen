import { NextRequest, NextResponse } from 'next/server'
import { fal } from '@fal-ai/client'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { hasCredits, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import type { SceneImage } from '@/lib/types'

interface ImagesRequest {
  prompts: string[]
  project_id?: string
}

interface FalImageResult {
  images: Array<{ url: string }>
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Необходима авторизация' },
        { status: 401 }
      )
    }

    const { prompts, project_id }: ImagesRequest = await request.json()

    if (!prompts || prompts.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Список промптов не может быть пустым' },
        { status: 400 }
      )
    }

    const totalCost = CREDIT_COSTS.image * prompts.length
    const enough = await hasCredits(user.id, totalCost)
    if (!enough) {
      return NextResponse.json(
        { ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' },
        { status: 402 }
      )
    }

    fal.config({ credentials: process.env.FAL_KEY })
    const serviceClient = createServiceClient()
    const sceneImages: SceneImage[] = []

    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i]

      const result = await fal.subscribe('fal-ai/flux/dev', {
        input: {
          prompt,
          image_size: 'landscape_16_9',
          num_images: 1,
          num_inference_steps: 28,
        },
      }) as { data: FalImageResult }

      const imageUrl = result.data?.images?.[0]?.url ?? null

      // Re-upload to Supabase Storage for persistent hosting
      let storedUrl = imageUrl
      if (imageUrl && project_id) {
        const imgResponse = await fetch(imageUrl)
        if (imgResponse.ok) {
          const imgBuffer = await imgResponse.arrayBuffer()
          const storagePath = `${user.id}/${project_id}/scene_${i}.jpg`

          const { error: uploadError } = await serviceClient.storage
            .from('images')
            .upload(storagePath, imgBuffer, {
              contentType: 'image/jpeg',
              upsert: true,
            })

          if (!uploadError) {
            const { data: { publicUrl } } = serviceClient.storage
              .from('images')
              .getPublicUrl(storagePath)
            storedUrl = publicUrl
          }
        }
      }

      sceneImages.push({ scene_index: i, prompt, url: storedUrl })
      await spendCredits(user.id, CREDIT_COSTS.image, 'image', project_id)
    }

    if (project_id) {
      await supabase
        .from('projects')
        .update({
          scene_images: sceneImages,
          status: 'generating_video',
        })
        .eq('id', project_id)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ ok: true, data: { scene_images: sceneImages } })
  } catch (error) {
    console.error('[generate/images]', error)
    return NextResponse.json(
      { ok: false, error: 'Ошибка генерации иллюстраций' },
      { status: 500 }
    )
  }
}
