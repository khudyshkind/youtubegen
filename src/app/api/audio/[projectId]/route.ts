// Proxy: redirects to a short-lived Supabase signed URL for private bucket audio.
// Using a server-side redirect means the stored URL (/api/audio/{id}) never expires,
// survives stampAudioUrl (which strips query params), and is always served fresh.
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Необходима авторизация' }, { status: 401 })
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()
    if (!project) {
      return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
    }

    const storagePath = `${user.id}/${projectId}/audio.mp3`
    const svc = createServiceClient()
    const { data, error } = await svc.storage
      .from('audio')
      .createSignedUrl(storagePath, 300) // 5 min — long enough to buffer; browser caches bytes
    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: 'Аудио не найдено' }, { status: 404 })
    }

    return NextResponse.redirect(data.signedUrl, { status: 307 })
  } catch (err) {
    console.error('[audio/:projectId]', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
