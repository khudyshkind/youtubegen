import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { detectSceneCount } from '@/lib/scene-split'

export const maxDuration = 30

interface ScenesRequest {
  text: string
  count_mode: 'auto' | 'manual'
  count?: number
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const { text, count_mode, count }: ScenesRequest = await request.json()

    if (!text?.trim()) {
      return NextResponse.json({ ok: false, error: 'text обязателен' }, { status: 400 })
    }

    if (count_mode === 'manual') {
      const n = Math.min(30, Math.max(1, parseInt(String(count ?? 10), 10) || 10))
      return NextResponse.json({ ok: true, data: { scene_count: n, preview: [] } })
    }

    // Auto mode: Haiku estimates scene count + brief descriptions
    const result = await detectSceneCount(text)
    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[illustrations/scenes]', msg)
    return NextResponse.json({ ok: false, error: 'Ошибка определения сцен' }, { status: 500 })
  }
}
