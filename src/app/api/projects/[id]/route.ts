import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase-server'
import { env } from '@/lib/env'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const { data: project, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error || !project) {
      return NextResponse.json({ ok: false, error: 'Проект не найден' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, data: { project } })
  } catch (err) {
    console.error('[projects/:id GET]', err)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json({ ok: false, error: 'Ошибка удаления проекта' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[projects/:id DELETE]', err)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}

export const maxDuration = 15

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body = await request.json() as { title?: string; generate_from?: string; language?: string }
    const { title, generate_from, language } = body

    // Fast path: direct language write (e.g. user changed outputLang dropdown — no Haiku needed)
    if (language && !generate_from && !title) {
      const lang = language.toLowerCase().slice(0, 5)
      const { error } = await supabase.from('projects').update({ language: lang }).eq('id', id).eq('user_id', user.id)
      if (error) return NextResponse.json({ ok: false, error: 'Ошибка обновления проекта' }, { status: 500 })
      console.log(`[projects/:id PATCH] direct language write: ${lang}`)
      return NextResponse.json({ ok: true, data: { language: lang } })
    }

    let finalTitle: string | undefined
    let detectedLanguage: string | null = null

    if (generate_from?.trim()) {
      const textSnippet = generate_from.trim().slice(0, 1500)
      const fallback = textSnippet.slice(0, 60).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
      try {
        const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
        const msg = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 60,
          messages: [{
            role: 'user',
            content: `Analyze this video script. Return ONLY valid JSON, no markdown:\n{"title":"<3-6 word video title in the script language>","language":"<ISO 639-1 code, e.g. en, ru, es>"}\n\nScript:\n${textSnippet}`,
          }],
        })
        const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
        try {
          const parsed = JSON.parse(raw) as { title?: string; language?: string }
          finalTitle = (parsed.title?.trim()) || fallback
          detectedLanguage = parsed.language?.toLowerCase().slice(0, 5) ?? null
          console.log(`[projects/:id PATCH] detected title="${finalTitle}" language="${detectedLanguage}"`)
        } catch {
          finalTitle = raw.replace(/^["{]|["}]$/g, '').trim() || fallback
        }
      } catch (e) {
        console.error('[projects/:id PATCH] Haiku failed, using fallback title:', e instanceof Error ? e.message : e)
        finalTitle = fallback
      }
    } else if (title?.trim()) {
      finalTitle = title.trim()
    }

    if (!finalTitle) {
      return NextResponse.json({ ok: false, error: 'title или generate_from обязателен' }, { status: 400 })
    }

    if (finalTitle.length > 100) finalTitle = finalTitle.slice(0, 97) + '…'

    const updatePayload: Record<string, unknown> = { title: finalTitle }
    if (detectedLanguage) updatePayload.language = detectedLanguage

    const { error } = await supabase
      .from('projects')
      .update(updatePayload)
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json({ ok: false, error: 'Ошибка обновления проекта' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, data: { title: finalTitle, language: detectedLanguage } })
  } catch (err) {
    console.error('[projects/:id PATCH]', err)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
