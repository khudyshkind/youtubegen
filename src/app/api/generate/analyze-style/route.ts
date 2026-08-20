import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { CREDIT_COSTS } from '@/lib/types'
import { isBillingError, notifyBillingError, notifyError } from '@/lib/telegram'
import { startOpLog, finishOpLog } from '@/lib/operation-log'

export const maxDuration = 30

export async function POST(request: NextRequest) {
  let alertUserId: string | undefined
  let alertProjectId: string | undefined
  let _opLogId: string | null = null
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }
    alertUserId = user.id

    const formData = await request.formData()
    const file = formData.get('image') as File | null
    const projectId = formData.get('project_id') as string | null
    alertProjectId = projectId ?? undefined

    if (!file) {
      return NextResponse.json({ ok: false, error: 'Изображение обязательно' }, { status: 400 })
    }

    if (file.size > 4 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: 'Файл слишком большой (макс 4 МБ)' }, { status: 400 })
    }

    const check = await requireCreditsAmount(user.id, CREDIT_COSTS.style_analysis, supabase)
    if (!check.ok) {
      return NextResponse.json({ ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }, { status: 402 })
    }

    _opLogId = await startOpLog({ userId: user.id, projectId: projectId ?? null, opType: 'style_analysis', provider: 'claude-haiku-4-5-20251001' })

    const buffer = Buffer.from(await file.arrayBuffer())
    const base64 = buffer.toString('base64')
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const mediaType = (allowedTypes.includes(file.type) ? file.type : 'image/jpeg') as
      'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: 25_000 })
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
      void finishOpLog(_opLogId, { status: 'failed', errorText: 'empty style description' })
      return NextResponse.json({ ok: false, error: 'Не удалось определить стиль' }, { status: 502 })
    }

    // Store image in Supabase so thumbnail/route.ts can pass the public URL to NB2-edit as image_urls.
    // Supabase public URL is accessible by fal.ai directly — no auth header needed.
    let refUrl: string | null = null
    try {
      const serviceClient = createServiceClient()
      const ext = mediaType === 'image/png' ? 'png' : mediaType === 'image/webp' ? 'webp' : 'jpg'
      const refPath = projectId
        ? `${user.id}/${projectId}/thumbnail_ref.${ext}`
        : `${user.id}/thumbnail_ref.${ext}`
      await serviceClient.storage.from('images').upload(refPath, buffer, {
        contentType: mediaType,
        upsert: true,
      })
      const { data: { publicUrl } } = serviceClient.storage.from('images').getPublicUrl(refPath)
      refUrl = publicUrl
      console.log(`[analyze-style] ref stored: ${refPath}`)
    } catch (e) {
      console.warn('[analyze-style] ref storage upload failed (non-fatal):', e instanceof Error ? e.message : e)
    }

    await spendCredits(user.id, CREDIT_COSTS.style_analysis, 'style_analysis', projectId ?? undefined)

    void finishOpLog(_opLogId, { status: 'done', creditsSpent: CREDIT_COSTS.style_analysis })
    return NextResponse.json({ ok: true, data: { style_description: styleDescription, ref_url: refUrl } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    void finishOpLog(_opLogId, { status: 'failed', errorText: msg.slice(0, 500) })
    console.error('[analyze-style]', msg)
    if (isBillingError(msg)) await notifyBillingError('Anthropic', '/generate/analyze-style', { userId: alertUserId, projectId: alertProjectId }).catch(() => {})
    else await notifyError('/generate/analyze-style', msg, { userId: alertUserId, projectId: alertProjectId }).catch(() => {})
    return NextResponse.json({ ok: false, error: 'Ошибка анализа стиля' }, { status: 500 })
  }
}
