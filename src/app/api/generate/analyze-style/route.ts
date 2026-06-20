import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'

export const maxDuration = 30

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('image') as File | null
    const projectId = formData.get('project_id') as string | null

    if (!file) {
      return NextResponse.json({ ok: false, error: 'Изображение обязательно' }, { status: 400 })
    }

    if (file.size > 4 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: 'Файл слишком большой (макс 4 МБ)' }, { status: 400 })
    }

    const check = await requireCreditsAmount(user.id, 2, supabase)
    if (!check.ok) {
      return NextResponse.json({ ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }, { status: 402 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const base64 = buffer.toString('base64')
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const mediaType = (allowedTypes.includes(file.type) ? file.type : 'image/jpeg') as
      'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: 'Analyze the visual style of this image for use as an image generation prompt suffix. Describe: art style/technique, color palette, lighting, mood. 15-25 words, English only. Return only the description.',
          },
        ],
      }],
    })

    const block = msg.content[0]
    const styleDescription = block.type === 'text' ? block.text.trim() : ''

    if (!styleDescription) {
      return NextResponse.json({ ok: false, error: 'Не удалось определить стиль' }, { status: 502 })
    }

    await spendCredits(user.id, 2, 'style_analysis', projectId ?? undefined)

    return NextResponse.json({ ok: true, data: { style_description: styleDescription } })
  } catch (error) {
    console.error('[analyze-style]', error)
    return NextResponse.json({ ok: false, error: 'Ошибка анализа стиля' }, { status: 500 })
  }
}
