import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { randomUUID } from 'crypto'

const MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024  // 25 MB — Whisper hard limit

const ALLOWED_AUDIO_MIMES = new Set([
  'audio/mpeg', 'audio/mp3',
  'audio/mp4', 'audio/x-m4a', 'audio/m4a',
  'audio/aac', 'audio/x-aac',
  'audio/ogg', 'audio/vorbis',
  'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/vnd.wave',
])

const ALLOWED_AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'ogg', 'wav'])

function getExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

interface SignRequest {
  type: 'audio' | 'image' | 'tool_audio' | 'tool_image_reference'
  project_id?: string
  index?: number
  content_type?: string
  // tool_audio / tool_image_reference only — validated server-side
  file_size?: number
  file_name?: string
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body: SignRequest = await request.json()
    const { type, project_id, index = 0, content_type, file_size, file_name } = body

    // ── tool_image_reference: standalone reference image for style analysis ────
    if (type === 'tool_image_reference') {
      const ALLOWED_REF_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
      const MAX_REF_BYTES = 10 * 1024 * 1024
      if (content_type && !ALLOWED_REF_MIMES.has(content_type)) {
        return NextResponse.json({ ok: false, error: 'Поддерживаются JPEG, PNG, WEBP', code: 'INVALID_FORMAT' }, { status: 400 })
      }
      if (file_size !== undefined && file_size > MAX_REF_BYTES) {
        return NextResponse.json({ ok: false, error: 'Файл слишком большой. Максимум 10 МБ', code: 'FILE_TOO_LARGE' }, { status: 400 })
      }
      const ext = content_type === 'image/png' ? 'png' : content_type === 'image/webp' ? 'webp' : 'jpg'
      const storagePath = `${user.id}/tool/ref_${randomUUID()}.${ext}`
      const svc = createServiceClient()
      const { data, error } = await svc.storage.from('images').createSignedUploadUrl(storagePath)
      if (error || !data) {
        console.error('[upload/sign tool_image_reference]', error?.message)
        return NextResponse.json({ ok: false, error: 'Не удалось создать URL для загрузки' }, { status: 500 })
      }
      return NextResponse.json({
        ok: true,
        data: { signed_url: data.signedUrl, token: data.token, path: storagePath, bucket: 'images', content_type: content_type ?? 'image/jpeg' },
      })
    }

    // ── tool_audio: standalone tool upload (no project_id needed) ──────────────
    if (type === 'tool_audio') {
      // Validate MIME
      if (content_type && !ALLOWED_AUDIO_MIMES.has(content_type)) {
        return NextResponse.json(
          { ok: false, error: 'Поддерживаются mp3/m4a/aac/ogg/wav до 25 МБ', code: 'INVALID_FORMAT' },
          { status: 400 },
        )
      }
      // Validate extension
      if (file_name) {
        const ext = getExt(file_name)
        if (!ALLOWED_AUDIO_EXTS.has(ext)) {
          return NextResponse.json(
            { ok: false, error: 'Поддерживаются mp3/m4a/aac/ogg/wav до 25 МБ', code: 'INVALID_FORMAT' },
            { status: 400 },
          )
        }
      }
      // Validate size
      if (file_size !== undefined && file_size > MAX_AUDIO_UPLOAD_BYTES) {
        return NextResponse.json(
          { ok: false, error: `Файл слишком большой. Максимум 25 МБ (Whisper).`, code: 'FILE_TOO_LARGE' },
          { status: 400 },
        )
      }

      const ext = file_name ? getExt(file_name) : 'mp3'
      const storagePath = `${user.id}/tool/${randomUUID()}.${ext}`
      const mime = content_type ?? 'audio/mpeg'
      const svc = createServiceClient()

      const { data, error } = await svc.storage.from('audio').createSignedUploadUrl(storagePath)
      if (error || !data) {
        console.error('[upload/sign tool_audio]', error?.message)
        return NextResponse.json({ ok: false, error: 'Не удалось создать URL для загрузки' }, { status: 500 })
      }

      // Do NOT call createSignedUrl here: Supabase requires the object to exist first.
      // The signed read URL will be created in generate/subtitles after the upload completes.
      return NextResponse.json({
        ok: true,
        data: {
          signed_url:   data.signedUrl,
          token:        data.token,
          path:         storagePath,
          bucket:       'audio',
          content_type: mime,
        },
      })
    }

    // ── studio paths (audio + image) — unchanged ───────────────────────────────
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
        signed_url:   data.signedUrl,
        token:        data.token,
        path:         storagePath,
        access_url:   accessUrl,
        bucket,
        content_type: mimeType,
      },
    })
  } catch (err) {
    console.error('[upload/sign]', err)
    return NextResponse.json({ ok: false, error: 'Ошибка сервера' }, { status: 500 })
  }
}

// DELETE /api/upload/sign — cleanup temp files after style analysis
// Accepts { ref_url, bucket } and deletes the object at the path extracted from the public URL.
// Security: validates path starts with the authenticated user's ID.
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false }, { status: 401 })

    const { ref_url, bucket = 'images' } = await request.json() as { ref_url: string; bucket?: string }

    let storagePath: string | null = null
    try {
      const url = new URL(ref_url)
      const match = url.pathname.match(/\/object\/public\/[^/]+\/(.+)/)
      if (match?.[1]) storagePath = decodeURIComponent(match[1])
    } catch {}

    if (!storagePath || !storagePath.startsWith(user.id + '/')) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    const svc = createServiceClient()
    const { error } = await svc.storage.from(bucket).remove([storagePath])
    if (error) console.warn('[upload/sign DELETE]', error.message)
    return NextResponse.json({ ok: !error })
  } catch (err) {
    console.error('[upload/sign DELETE]', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
