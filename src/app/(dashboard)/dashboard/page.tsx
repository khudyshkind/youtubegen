import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase-server'
import DeleteProjectButton from '@/components/shared/DeleteProjectButton'
import NewProjectButton from '@/components/shared/NewProjectButton'
import OnboardingModal from '@/components/shared/OnboardingModal'
import ReferralBlock from '@/components/shared/ReferralBlock'
import type { Metadata } from 'next'
import type { Profile, Project, ProjectStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Дашборд' }

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'Черновик',
  generating_script: 'Генерация...',
  generating_audio: 'Озвучка...',
  generating_subtitles: 'Субтитры...',
  generating_images: 'Иллюстрации...',
  generating_video: 'Сборка видео...',
  generating_seo: 'SEO...',
  completed: 'Готово',
  failed: 'Ошибка',
}

const STATUS_COLORS: Record<ProjectStatus, string> = {
  draft: 'bg-white/5 text-slate-400 border border-white/10',
  generating_script: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
  generating_audio: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
  generating_subtitles: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
  generating_images: 'bg-violet-500/15 text-violet-400 border border-violet-500/20',
  generating_video: 'bg-violet-500/15 text-violet-400 border border-violet-500/20',
  generating_seo: 'bg-amber-500/15 text-amber-400 border border-amber-500/20',
  completed: 'bg-green-500/15 text-green-400 border border-green-500/20',
  failed: 'bg-red-500/15 text-red-400 border border-red-500/20',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function CreditsBar({ credits, plan }: { credits: number; plan: string }) {
  const maxMap: Record<string, number> = { free: 20, starter: 100, pro: 300, agency: 1000 }
  const max = maxMap[plan] ?? 5
  const pct = Math.min(100, Math.round((credits / max) * 100))
  return (
    <div className="w-full rounded-full h-1.5" style={{ background: 'rgba(255,255,255,0.08)' }}>
      <div
        className="h-1.5 rounded-full transition-all"
        style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #7C3AED, #2563EB)' }}
      />
    </div>
  )
}

function ProjectThumbnail({ project }: { project: Project }) {
  const previewUrl =
    project.thumbnail_url ??
    (project.scene_images && project.scene_images.length > 0 ? project.scene_images[0].url : null)

  if (previewUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={previewUrl} alt="" className="w-full h-full object-cover" />
    )
  }

  return (
    <div className="w-full h-full flex items-center justify-center">
      {project.status === 'completed' ? (
        <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      ) : (
        <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
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
      .limit(20),
  ])

  const typedProfile = profile as Profile | null
  const typedProjects = (projects ?? []) as Project[]

  return (
    <>
      <OnboardingModal initialShow={typedProfile?.onboarding_completed === false} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">
              Привет, {typedProfile?.full_name?.split(' ')[0] ?? 'пользователь'} 👋
            </h1>
            <p className="text-slate-500 text-sm mt-1">Ваши видео и статистика</p>
          </div>
          <NewProjectButton className="inline-flex items-center gap-2 px-5 py-3 btn-gradient text-white font-semibold rounded-xl text-sm shadow-lg">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Создать видео
          </NewProjectButton>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="card-dark rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-slate-400">Кредиты</p>
              <Link href="/billing" className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors">
                Пополнить →
              </Link>
            </div>
            <p className="text-3xl font-bold text-slate-100 mb-2">{typedProfile?.credits ?? 0}</p>
            <CreditsBar credits={typedProfile?.credits ?? 0} plan={typedProfile?.plan ?? 'free'} />
            <p className="text-xs text-slate-600 mt-2">
              Тариф: <span className="font-medium text-slate-400 capitalize">{typedProfile?.plan ?? 'free'}</span>
            </p>
          </div>

          <div className="card-dark rounded-2xl p-5">
            <p className="text-sm font-medium text-slate-400 mb-3">Всего проектов</p>
            <p className="text-3xl font-bold text-slate-100">{typedProjects.length}</p>
            <p className="text-xs text-slate-600 mt-2">За всё время</p>
          </div>

          <div className="card-dark rounded-2xl p-5">
            <p className="text-sm font-medium text-slate-400 mb-3">Готовых видео</p>
            <p className="text-3xl font-bold text-slate-100">
              {typedProjects.filter((p) => p.status === 'completed').length}
            </p>
            <p className="text-xs text-slate-600 mt-2">Статус: completed</p>
          </div>
        </div>

        {/* Referral block */}
        {typedProfile?.referral_code && (
          <div className="mb-8">
            <ReferralBlock
              referralCode={typedProfile.referral_code}
              referralCount={typedProfile.referral_count ?? 0}
              referralCreditsEarned={typedProfile.referral_credits_earned ?? 0}
            />
          </div>
        )}

        {/* Projects list */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <h2 className="font-semibold text-slate-200">Последние проекты</h2>
            {typedProjects.length > 0 && (
              <span className="text-sm text-slate-500">{typedProjects.length} проектов</span>
            )}
          </div>

          {typedProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)' }}
              >
                <svg className="w-8 h-8 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-slate-200 font-medium mb-1">Нет проектов</p>
              <p className="text-slate-500 text-sm mb-6">Создайте первое видео и оно появится здесь</p>
              <NewProjectButton className="px-5 py-2.5 btn-gradient text-white font-semibold rounded-xl text-sm">
                Создать первое видео
              </NewProjectButton>
            </div>
          ) : (
            <div>
              {typedProjects.map((project) => (
                <div
                  key={project.id}
                  className="flex items-center gap-4 px-6 py-4 transition-colors group hover:bg-white/[0.03]"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                >
                  {/* Thumbnail */}
                  <Link
                    href={`/studio?project=${project.id}`}
                    className="w-20 h-12 rounded-lg shrink-0 overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.06)' }}
                  >
                    <ProjectThumbnail project={project} />
                  </Link>

                  {/* Info */}
                  <Link
                    href={`/studio?project=${project.id}`}
                    className="flex-1 min-w-0"
                  >
                    <p className="font-medium text-slate-200 truncate group-hover:text-violet-400 transition-colors">
                      {project.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-slate-500 truncate">{project.topic}</p>
                      <span className="text-slate-700 hidden sm:block">·</span>
                      <span className="text-xs text-slate-600 hidden sm:block whitespace-nowrap">
                        {formatDate(project.created_at)}
                      </span>
                      {project.credits_spent > 0 && (
                        <>
                          <span className="text-slate-700 hidden sm:block">·</span>
                          <span className="text-xs text-amber-500/80 font-medium hidden sm:block whitespace-nowrap">
                            {project.credits_spent} кр.
                          </span>
                        </>
                      )}
                    </div>
                  </Link>

                  {/* Status badge */}
                  <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[project.status]}`}>
                    {STATUS_LABELS[project.status]}
                  </span>

                  {/* Open / Continue button */}
                  <Link
                    href={`/studio?project=${project.id}`}
                    className={`shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      project.status === 'completed'
                        ? 'btn-ghost-dark'
                        : 'btn-gradient text-white'
                    }`}
                  >
                    {project.status === 'completed' ? 'Открыть' : 'Продолжить →'}
                  </Link>

                  <DeleteProjectButton projectId={project.id} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
