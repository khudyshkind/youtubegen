export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabase } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-server'
import type { Project, ProjectStatus } from '@/lib/types'

const ADMIN_EMAILS = ['khudyshkin.d@gmail.com', 'denis-region@mail.ru']

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'Черновик', generating_script: 'Сценарий...', generating_audio: 'Озвучка...',
  generating_subtitles: 'Субтитры...', generating_images: 'Иллюстрации...',
  generating_video: 'Сборка...', generating_seo: 'SEO...', completed: 'Готово', failed: 'Ошибка',
}
const STATUS_COLORS: Record<ProjectStatus, string> = {
  draft: 'bg-gray-100 text-gray-600', generating_script: 'bg-blue-100 text-blue-700',
  generating_audio: 'bg-blue-100 text-blue-700', generating_subtitles: 'bg-blue-100 text-blue-700',
  generating_images: 'bg-purple-100 text-purple-700', generating_video: 'bg-purple-100 text-purple-700',
  generating_seo: 'bg-orange-100 text-orange-700', completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

interface Props {
  searchParams: Promise<{ user_id?: string }>
}

export default async function AdminViewPage({ searchParams }: Props) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email || !ADMIN_EMAILS.includes(user.email)) redirect('/dashboard')

  const { user_id } = await searchParams
  if (!user_id) redirect('/admin/users')

  const svc = createServiceClient()

  const [{ data: profile }, { data: projects }] = await Promise.all([
    svc.from('profiles').select('*').eq('id', user_id).single(),
    svc.from('projects').select('*').eq('user_id', user_id).order('created_at', { ascending: false }),
  ])

  if (!profile) {
    return (
      <div className="text-center py-20 text-gray-400">
        Пользователь не найден.{' '}
        <Link href="/admin/users" className="text-red-500 hover:text-red-600">← Назад</Link>
      </div>
    )
  }

  const typedProjects = (projects ?? []) as Project[]
  const totalCreditsSpent = typedProjects.reduce((s, p) => s + (p.credits_spent ?? 0), 0)

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  function steps(p: Project) {
    return [
      p.script ? '✓ Сценарий' : '○ Сценарий',
      p.audio_url ? '✓ Озвучка' : '○ Озвучка',
      p.subtitle_blocks ? '✓ Субтитры' : '○ Субтитры',
      p.scene_images ? '✓ Иллюстрации' : '○ Иллюстрации',
      p.video_url ? '✓ Видео' : '○ Видео',
      p.seo ? '✓ SEO' : '○ SEO',
    ]
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Admin view banner */}
      <div className="bg-red-500 text-white rounded-2xl px-5 py-3 flex items-center justify-between">
        <span className="font-semibold text-sm">
          ⚠️ Режим просмотра: {profile.email}
        </span>
        <Link href="/admin/users"
          className="text-sm bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg transition-colors">
          Выйти
        </Link>
      </div>

      {/* Profile info */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Email', value: profile.email },
          { label: 'Тариф', value: profile.plan },
          { label: 'Кредиты', value: profile.credits },
          { label: 'Потрачено кредитов', value: totalCreditsSpent },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">{s.label}</p>
            <p className="text-lg font-bold text-gray-800 truncate">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Projects */}
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <p className="font-semibold text-gray-800">Проекты ({typedProjects.length})</p>
        </div>
        {typedProjects.length === 0 ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">Нет проектов</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {typedProjects.map((p) => (
              <div key={p.id} className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 truncate">{p.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{p.topic}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {steps(p).map((s) => (
                        <span key={s} className={`text-[11px] px-2 py-0.5 rounded-full ${
                          s.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-400'
                        }`}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[p.status]}`}>
                      {STATUS_LABELS[p.status]}
                    </span>
                    <p className="text-xs text-gray-400 mt-1">{formatDate(p.created_at)}</p>
                    {p.credits_spent > 0 && (
                      <p className="text-xs text-amber-600 font-medium mt-0.5">{p.credits_spent} кр.</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
