import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase-server'
import type { Metadata } from 'next'
import type { Profile, Project, ProjectStatus } from '@/lib/types'

export const metadata: Metadata = { title: 'Дашборд' }

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'Черновик',
  generating_script: 'Генерация сценария...',
  generating_audio: 'Озвучка...',
  generating_subtitles: 'Субтитры...',
  generating_images: 'Иллюстрации...',
  generating_video: 'Сборка видео...',
  generating_seo: 'SEO...',
  completed: 'Готово',
  failed: 'Ошибка',
}

const STATUS_COLORS: Record<ProjectStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  generating_script: 'bg-blue-100 text-blue-700',
  generating_audio: 'bg-blue-100 text-blue-700',
  generating_subtitles: 'bg-blue-100 text-blue-700',
  generating_images: 'bg-purple-100 text-purple-700',
  generating_video: 'bg-purple-100 text-purple-700',
  generating_seo: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function CreditsBar({ credits, plan }: { credits: number; plan: string }) {
  const maxMap: Record<string, number> = { free: 5, starter: 50, pro: 200, agency: 1000 }
  const max = maxMap[plan] ?? 5
  const pct = Math.min(100, Math.round((credits / max) * 100))

  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div
        className="bg-amber-400 h-2 rounded-full transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default async function DashboardPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const [{ data: profile }, { data: projects }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase
      .from('projects')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const typedProfile = profile as Profile | null
  const typedProjects = (projects ?? []) as Project[]

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Привет, {typedProfile?.full_name?.split(' ')[0] ?? 'пользователь'} 👋
          </h1>
          <p className="text-gray-500 text-sm mt-1">Ваши видео и статистика</p>
        </div>
        <Link
          href="/studio"
          className="inline-flex items-center gap-2 px-5 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl text-sm transition-colors shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Создать видео
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">

        {/* Credits card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-500">Кредиты</p>
            <Link href="/billing" className="text-xs text-red-500 hover:text-red-600 font-medium">
              Пополнить →
            </Link>
          </div>
          <p className="text-3xl font-bold text-gray-900 mb-2">
            {typedProfile?.credits ?? 0}
          </p>
          <CreditsBar credits={typedProfile?.credits ?? 0} plan={typedProfile?.plan ?? 'free'} />
          <p className="text-xs text-gray-400 mt-2">
            Тариф: <span className="font-medium capitalize">{typedProfile?.plan ?? 'free'}</span>
          </p>
        </div>

        {/* Total projects */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-sm font-medium text-gray-500 mb-3">Всего проектов</p>
          <p className="text-3xl font-bold text-gray-900">{typedProjects.length}</p>
          <p className="text-xs text-gray-400 mt-2">За всё время</p>
        </div>

        {/* Completed videos */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-sm font-medium text-gray-500 mb-3">Готовых видео</p>
          <p className="text-3xl font-bold text-gray-900">
            {typedProjects.filter((p) => p.status === 'completed').length}
          </p>
          <p className="text-xs text-gray-400 mt-2">Статус: completed</p>
        </div>
      </div>

      {/* Projects list */}
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Последние проекты</h2>
          {typedProjects.length > 0 && (
            <span className="text-sm text-gray-500">{typedProjects.length} проектов</span>
          )}
        </div>

        {typedProjects.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-gray-700 font-medium mb-1">Нет проектов</p>
            <p className="text-gray-500 text-sm mb-6">Создайте первое видео и оно появится здесь</p>
            <Link
              href="/studio"
              className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl text-sm transition-colors"
            >
              Создать первое видео
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {typedProjects.map((project) => (
              <div
                key={project.id}
                className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors"
              >
                {/* Thumbnail placeholder */}
                <div className="w-14 h-10 bg-gray-100 rounded-lg shrink-0 flex items-center justify-center">
                  {project.status === 'completed' ? (
                    <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{project.title}</p>
                  <p className="text-sm text-gray-500 truncate">{project.topic}</p>
                </div>

                {/* Status */}
                <span
                  className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${
                    STATUS_COLORS[project.status]
                  }`}
                >
                  {STATUS_LABELS[project.status]}
                </span>

                {/* Date */}
                <span className="shrink-0 text-sm text-gray-400 hidden sm:block">
                  {formatDate(project.created_at)}
                </span>

                {/* Credits */}
                {project.credits_spent > 0 && (
                  <span className="shrink-0 text-xs text-amber-600 font-medium hidden sm:block">
                    {project.credits_spent} кр.
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
