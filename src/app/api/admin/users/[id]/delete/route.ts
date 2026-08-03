export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { env } from '@/lib/env'

// Pattern: same ADMIN_EMAILS check as credits/route.ts and plan/route.ts
const ADMIN_EMAILS = ['khudyshkin.d@gmail.com', 'denis-region@mail.ru']
const STORAGE_BUCKETS = ['images', 'audio', 'videos'] as const
// storage.list default limit is 100 (storage-js/src/lib/types.ts SearchOptions @default 100).
// We use a larger page size and loop until the prefix is empty.
const LIST_PAGE_SIZE = 200
const LIST_MAX_PAGES = 50 // hard ceiling: 50 × 200 = 10 000 files per prefix

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user?.email || !ADMIN_EMAILS.includes(user.email)) {
      return NextResponse.json({ ok: false, error: 'Нет доступа' }, { status: 403 })
    }

    const { id: userId } = await params

    if (userId === user.id) {
      return NextResponse.json({ ok: false, error: 'Нельзя удалить собственный аккаунт' }, { status: 400 })
    }

    const svc = createServiceClient()

    // 2а: Проверить активную Paddle-подписку — отказать, если есть
    const { data: profileRaw, error: profileError } = await svc
      .from('profiles')
      .select('id, email, paddle_subscription_id')
      .eq('id', userId)
      .single()

    if (profileError || !profileRaw) {
      return NextResponse.json({ ok: false, error: 'Пользователь не найден' }, { status: 404 })
    }

    const profile = profileRaw as { id: string; email: string; paddle_subscription_id: string | null }

    if (profile.paddle_subscription_id) {
      return NextResponse.json({
        ok: false,
        error: `Нельзя удалить: у пользователя активна подписка Paddle (${profile.paddle_subscription_id}). Сначала отмените подписку в Paddle Dashboard, затем повторите удаление.`,
      }, { status: 409 })
    }

    // 2б: Собрать project_id пользователя
    const { data: projectsRaw } = await svc
      .from('projects')
      .select('id')
      .eq('user_id', userId)

    const projectIds = ((projectsRaw ?? []) as { id: string }[]).map(p => p.id)
    console.log(`[admin/delete] START user=${userId} email=${profile.email} projects=${projectIds.length}`)

    let totalFilesDeleted = 0

    // 2в: Очистить Supabase Storage (images + audio + videos) для каждого проекта.
    // Читаем постранично (LIST_PAGE_SIZE) до пустой страницы, чтобы не упереться в лимит 100.
    for (const projectId of projectIds) {
      const prefix = `${userId}/${projectId}`
      for (const bucket of STORAGE_BUCKETS) {
        let page = 0
        let limitExceeded = false
        while (true) {
          const { data: files, error: listErr } = await svc.storage
            .from(bucket)
            .list(prefix, { limit: LIST_PAGE_SIZE, offset: page * LIST_PAGE_SIZE })
          if (listErr) {
            console.error(`[admin/delete] list ${bucket}/${prefix} page=${page} error: ${listErr.message}`)
            return NextResponse.json({
              ok: false,
              error: `Ошибка чтения ${bucket}/${prefix}: ${listErr.message} — аккаунт не удалён.`,
            }, { status: 500 })
          }
          if (!files?.length) break
          const paths = files.map(f => `${prefix}/${f.name}`)
          const { error: removeErr } = await svc.storage.from(bucket).remove(paths)
          if (removeErr) {
            console.error(`[admin/delete] remove ${bucket}/${prefix} page=${page} error: ${removeErr.message}`)
            return NextResponse.json({
              ok: false,
              error: `Ошибка удаления файлов ${bucket}/${prefix}: ${removeErr.message} — аккаунт не удалён.`,
            }, { status: 500 })
          }
          totalFilesDeleted += files.length
          console.log(`[admin/delete] ${bucket} deleted ${files.length} files (page=${page}) for project ${projectId}`)
          if (files.length < LIST_PAGE_SIZE) break // неполная страница — конец
          page++
          if (page >= LIST_MAX_PAGES) { limitExceeded = true; break }
        }
        if (limitExceeded) {
          return NextResponse.json({
            ok: false,
            error: `Превышен лимит страниц (${LIST_MAX_PAGES}×${LIST_PAGE_SIZE}) при очистке ${bucket}/${prefix} — аккаунт не удалён. Проверьте хранилище вручную.`,
          }, { status: 500 })
        }
      }
    }

    // 2г: Railway B2 purge — ожидаем ответа для каждого проекта (не fire-and-forget)
    const railwayUrl = env('RAILWAY_VIDEO_SERVER_URL').replace(/\/$/, '')
    const railwaySecret = env('RAILWAY_API_SECRET')

    if (!railwayUrl || !railwaySecret) {
      return NextResponse.json({
        ok: false,
        error: 'RAILWAY_VIDEO_SERVER_URL или RAILWAY_API_SECRET не заданы — очистка B2 невозможна, аккаунт не удалён. Настройте переменные окружения и повторите.',
      }, { status: 500 })
    }

    for (const projectId of projectIds) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      let railwayRes: Response
      try {
        railwayRes = await fetch(`${railwayUrl}/purge-project`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-secret': railwaySecret },
          body: JSON.stringify({ project_id: projectId, user_id: userId }),
          signal: controller.signal,
        })
        clearTimeout(timer)
      } catch (e) {
        clearTimeout(timer)
        const msg = (e as Error).message
        console.error(`[admin/delete] Railway /purge-project project=${projectId} error: ${msg}`)
        return NextResponse.json({
          ok: false,
          error: `Ошибка Railway B2 для проекта ${projectId}: ${msg} — аккаунт не удалён.`,
        }, { status: 500 })
      }
      if (!railwayRes.ok) {
        console.error(`[admin/delete] Railway /purge-project project=${projectId} HTTP ${railwayRes.status}`)
        return NextResponse.json({
          ok: false,
          error: `Railway B2 вернул ${railwayRes.status} для проекта ${projectId} — аккаунт не удалён.`,
        }, { status: 500 })
      }
      console.log(`[admin/delete] Railway B2 purge ok project=${projectId}`)
    }

    // 2д: Удалить image_jobs (нет FK — каскадом не удалятся)
    const { count: imageJobsCount } = await svc
      .from('image_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)

    const { error: imageJobsError } = await svc
      .from('image_jobs')
      .delete()
      .eq('user_id', userId)

    if (imageJobsError) {
      console.error(`[admin/delete] image_jobs delete error: ${imageJobsError.message}`)
      return NextResponse.json({
        ok: false,
        error: `Ошибка удаления image_jobs: ${imageJobsError.message} — аккаунт не удалён.`,
      }, { status: 500 })
    }
    console.log(`[admin/delete] image_jobs deleted: ${imageJobsCount ?? 0} rows`)

    // 2е: Удалить пользователя — каскад уберёт profiles, projects, credit_transactions, analytics, legal_acceptances
    const { error: deleteError } = await svc.auth.admin.deleteUser(userId)

    if (deleteError) {
      console.error(`[admin/delete] auth.admin.deleteUser error: ${deleteError.message}`)
      return NextResponse.json({
        ok: false,
        error: `Ошибка удаления аккаунта: ${deleteError.message}`,
      }, { status: 500 })
    }

    console.log(`[admin/delete] DONE user=${userId} email=${profile.email} projects=${projectIds.length} files=${totalFilesDeleted} imageJobs=${imageJobsCount ?? 0}`)

    return NextResponse.json({
      ok: true,
      summary: {
        userId,
        email: profile.email,
        projectsDeleted: projectIds.length,
        filesDeleted: totalFilesDeleted,
        imageJobsDeleted: imageJobsCount ?? 0,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[admin/delete] unexpected error:', msg)
    return NextResponse.json({ ok: false, error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
