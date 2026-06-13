import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'

interface SignRequest {
  type: 'audio' | 'image'
  project_id: string
  index?: number        // image scene index
  content_type?: string // e.g. 'audio/mpeg', 'image/jpeg'
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body: SignRequest = await request.json()
    const { type, project_id, index = 0, content_type } = body

    if (!project_id) {
      return NextResponse.json({ ok: false, error: 'project_id обязателен' }, { status: 400 })
    }

    const serviceClient = createServiceClient()
    let bucket: string
    let storagePath: string
    let mimeType: string

    if (type === 'audio') {
      bucket = 'audio'
      storagePath = `${user.id}/${project_id}/audio.mp3`
      mimeType = content_type ?? 'audio/mpeg'
    } else {
      bucket = 'images'
      storagePath = `${user.id}/${project_id}/scene_${String(index).padStart(2, '0')}.jpg`
      mimeType = content_type ?? 'image/jpeg'
    }

    const { data, error } = await serviceClient.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath)

    if (error || !data) {
      console.error('[upload/sign]', error?.message)
      return NextResponse.json({ ok: false, error: 'Не удалось создать URL для загрузки' }, { status: 500 })
    }

    // Audio bucket is private — create a signed read URL (1 hour TTL).
    // Images bucket is public — use permanent public URL.
    let accessUrl: string
    if (type === 'audio') {
      const { data: readData } = await serviceClient.storage
        .from(bucket)
        .createSignedUrl(storagePath, 3600)
      accessUrl = readData?.signedUrl ?? ''
    } else {
      const { data: { publicUrl } } = serviceClient.storage.from(bucket).getPublicUrl(storagePath)
      accessUrl = publicUrl
    }

    return NextResponse.json({
      ok: true,
      data: {
        signed_url: data.signedUrl,
        token: data.token,
        path: storagePath,
        access_url: accessUrl,
        bucket,
        content_type: mimeType,
      },
    })
  } catch (err) {
    console.error('[upload/sign]', err)
    return NextResponse.json({ ok: false, error: 'Ошибка сервера' }, { status: 500 })
  }
}
