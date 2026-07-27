'use client'

import Link from 'next/link'
import { useLang } from '@/hooks/useLang'
import NewProjectButton from '@/components/shared/NewProjectButton'
import DeleteProjectButton from '@/components/shared/DeleteProjectButton'
import type { Profile, Project, ProjectStatus, ProjectType } from '@/lib/types'
import { TOOL_CARDS, ANALYTICS_GROUPS, STUDIO_STEPS } from '@/lib/content-config'

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

function formatDate(iso: string, lang: string) {
  return new Date(iso).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Media lifecycle badge — three states:
//   1. media_purged_at set → "Медиа удалены {дата}" (grey)
//   2. media_expires_at in past (DRY_RUN or cron not yet run) → "в ближайшую уборку" (red)
//   3. media_expires_at in future → "хранятся 72ч — ~Nч осталось" (yellow/green by urgency)
// Badge is always shown when project has live media; no visibility window.
function MediaBadge({ project }: { project: Project }) {
  // State 1: already purged
  if (project.media_purged_at) {
    const purgedDate = new Date(project.media_purged_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    return (
      <span
        className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ background: 'rgba(100,116,139,0.15)', color: '#94a3b8', border: '1px solid rgba(100,116,139,0.3)' }}
      >
        Медиа удалены {purgedDate}
      </span>
    )
  }

  const hasMedia = !!(project.audio_url || project.video_url || (project.scene_images && project.scene_images.length > 0))
  if (!hasMedia) return null
  if (project.status.startsWith('generating_')) return null
  if (!project.media_expires_at) return null  // cron hasn't run yet after migration

  const hoursLeft = (new Date(project.media_expires_at).getTime() - Date.now()) / 3_600_000

  // State 2: overdue — past expiry but not yet purged (DRY_RUN or cron hasn't run today)
  if (hoursLeft <= 0) {
    return (
      <span
        className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}
        title="Медиа будут удалены при следующем запуске уборки (04:00 UTC)"
      >
        ожидает уборки
      </span>
    )
  }

  // State 3: countdown — always visible while media is alive
  const h = Math.ceil(hoursLeft)
  const urgency = h <= 24
    ? { bg: 'rgba(239,68,68,0.12)',    color: '#f87171', border: 'rgba(239,68,68,0.3)'    }
    : { bg: 'rgba(245,158,11,0.12)',   color: '#fbbf24', border: 'rgba(245,158,11,0.3)'   }
  return (
    <span
      className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: urgency.bg, color: urgency.color, border: `1px solid ${urgency.border}` }}
      title="Скачайте MP4 или ZIP пока медиа ещё доступны"
    >
      Медиа хранятся 72ч — скачайте видео · ~{h}ч
    </span>
  )
}

const TOOL_EMOJI: Record<string, string> = {
  'script-gen':          '📝',
  'seo':                 '🎯',
  'repack':              '🔁',
  'uniqueize':           '✍️',
  'subtitles':           '🎧',
  'image-illustrations': '🖌️',
}

// image_style values are internal routing slugs; some don't match the URL folder name
const TOOL_SLUG_REMAP: Record<string, string> = {
  'image-illustrations': 'illustrations',
}

function toolRunHref(project: Project): string {
  const raw = project.image_style ?? 'script-gen'
  const slug = TOOL_SLUG_REMAP[raw] ?? raw
  return `/tools/${slug}?run=${project.id}`
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

interface Props {
  profile: Profile | null
  projects: Project[]
}

export default function DashboardClient({ profile, projects }: Props) {
  const { t, lang } = useLang()

  const statusLabel = (s: ProjectStatus) => t(`status.${s}`)

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">
          {t('dashboard.hello')}, {profile?.full_name?.split(' ')[0] ?? (lang === 'en' ? 'user' : 'пользователь')} 👋
        </h1>
        <p className="text-slate-500 text-sm mt-1">{t('dashboard.subtitle')}</p>
      </div>

      {/* Section blocks */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 items-start">

        {/* Block 1: Studio */}
        <Link
          href="/studio"
          className="flex flex-col rounded-2xl p-5 transition-all hover:scale-[1.01]"
          style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(124,58,237,0.45)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(124,58,237,0.2)')}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-base font-semibold" style={{ color: '#c4b5fd' }}>🎬 {t('dashboard.block_studio')}</p>
            <svg className="w-4 h-4 shrink-0" style={{ color: '#7c3aed' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">{t('dashboard.block_studio_desc')}</p>
          <div className="flex flex-col gap-0.5">
            {STUDIO_STEPS.map((step) => (
              <div key={step.labelKey} className="flex items-center gap-2 px-2 py-1 text-xs text-slate-400">
                <span>{step.icon}</span>
                <span>{t(step.labelKey)}</span>
              </div>
            ))}
          </div>
        </Link>

        {/* Block 2: Tools */}
        <div
          className="flex flex-col rounded-2xl p-5"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <Link
            href="/tools"
            className="flex items-center justify-between mb-1 group"
          >
            <p className="text-base font-semibold text-slate-200 group-hover:text-white transition-colors">🔧 {t('dashboard.block_tools')}</p>
            <svg className="w-4 h-4 shrink-0 text-slate-500 group-hover:text-slate-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          <p className="text-xs text-slate-500 mb-3">{t('dashboard.block_tools_desc')}</p>
          <div className="flex flex-col gap-0.5">
            {TOOL_CARDS.map((card) => (
              <Link
                key={card.slug}
                href={`/tools/${card.slug}`}
                className="flex items-center gap-2 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                <span>{card.emoji}</span>
                <span>{t(card.titleKey)}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Block 3: Analytics */}
        <div
          className="flex flex-col rounded-2xl p-5"
          style={{ background: 'rgba(6,182,212,0.04)', border: '1px solid rgba(6,182,212,0.15)' }}
        >
          <Link
            href="/analytics"
            className="flex items-center justify-between mb-1 group"
          >
            <p className="text-base font-semibold group-hover:text-white transition-colors" style={{ color: '#22d3ee' }}>📊 {t('dashboard.block_analytics')}</p>
            <svg className="w-4 h-4 shrink-0 text-slate-500 group-hover:text-slate-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          <p className="text-xs text-slate-500 mb-3">{t('dashboard.block_analytics_desc')}</p>
          <div className="flex flex-col gap-0.5">
            {ANALYTICS_GROUPS
              .flatMap((g) => g.tabs)
              .filter((tab) => tab.showInDashboard)
              .map((tab) => (
                <Link
                  key={tab.id}
                  href="/analytics"
                  className="flex items-center gap-2 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <span>{tab.icon}</span>
                  <span>{t(tab.labelKey)}</span>
                </Link>
              ))}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="card-dark rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-slate-400">{t('dashboard.credits')}</p>
            <Link href="/billing" className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors">
              {t('dashboard.top_up')}
            </Link>
          </div>
          <p className="text-3xl font-bold text-slate-100 mb-2">{profile?.credits ?? 0}</p>
          {profile?.plan !== 'free' && profile?.plan_credits != null && (
            <p className="text-xs text-slate-500 mb-1">
              {lang === 'en' ? 'Plan' : 'Тарифных'}: {profile.plan_credits.toLocaleString()}
              {profile.plan_expires_at && (
                <> · {lang === 'en' ? 'until' : 'до'} {new Date(profile.plan_expires_at).toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'short' })}</>
              )}
            </p>
          )}
          <p className="text-xs text-slate-600 mt-2">
            {t('dashboard.plan')} <span className="font-medium text-slate-400 capitalize">{profile?.plan ?? 'free'}</span>
          </p>
        </div>

        <div className="card-dark rounded-2xl p-5">
          <p className="text-sm font-medium text-slate-400 mb-3">{t('dashboard.total_projects')}</p>
          <p className="text-3xl font-bold text-slate-100">{projects.length}</p>
          <p className="text-xs text-slate-600 mt-2">{t('dashboard.all_time')}</p>
        </div>

        <div className="card-dark rounded-2xl p-5">
          <p className="text-sm font-medium text-slate-400 mb-3">{t('dashboard.ready_videos')}</p>
          <p className="text-3xl font-bold text-slate-100">
            {projects.filter((p) => p.status === 'completed').length}
          </p>
          <p className="text-xs text-slate-600 mt-2">{t('status.completed')}</p>
        </div>
      </div>

      {/* Projects list */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <h2 className="font-semibold text-slate-200">{t('dashboard.recent')}</h2>
          {projects.length > 0 && (
            <span className="text-sm text-slate-500">{projects.length} {lang === 'en' ? 'projects' : 'проектов'}</span>
          )}
        </div>

        {projects.length === 0 ? (
          <div className="py-12 px-4">
            <div className="max-w-2xl mx-auto text-center">
              <h3 className="text-xl font-bold text-slate-100 mb-2">{t('dashboard.welcome_title')}</h3>
              <p className="text-slate-400 text-sm mb-6">{t('dashboard.welcome_subtitle')}</p>
              <NewProjectButton className="px-6 py-2.5 rounded-xl text-sm font-semibold text-slate-300 transition-all hover:text-slate-100 bg-white/[0.06] border border-white/10">
                {t('dashboard.create_first')}
              </NewProjectButton>
            </div>
          </div>
        ) : (
          <div>
            {projects.map((project) => {
              const isToolRun = (project.type as ProjectType) === 'tool_run'
              const href = isToolRun ? toolRunHref(project) : `/studio?project=${project.id}`
              return (
                <div
                  key={project.id}
                  className="flex items-center gap-4 px-6 py-4 transition-colors group hover:bg-white/[0.03]"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                >
                  {isToolRun ? (
                    <Link
                      href={href}
                      className="w-20 h-12 rounded-lg shrink-0 overflow-hidden flex items-center justify-center text-2xl"
                      style={{ background: 'rgba(255,255,255,0.06)' }}
                    >
                      {TOOL_EMOJI[project.image_style ?? ''] ?? '🔧'}
                    </Link>
                  ) : (
                    <Link
                      href={href}
                      className="w-20 h-12 rounded-lg shrink-0 overflow-hidden"
                      style={{ background: 'rgba(255,255,255,0.06)' }}
                    >
                      <ProjectThumbnail project={project} />
                    </Link>
                  )}

                  <Link href={href} className="flex-1 min-w-0">
                    <p className="font-medium text-slate-200 truncate group-hover:text-violet-400 transition-colors">
                      {project.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-slate-500 truncate">{project.topic}</p>
                      <span className="text-slate-700">·</span>
                      <span className="text-xs text-slate-600 whitespace-nowrap">
                        {formatDate(project.created_at, lang)}
                      </span>
                      {project.credits_spent > 0 && (
                        <>
                          <span className="text-slate-700 hidden sm:block">·</span>
                          <span className="text-xs text-amber-500/80 font-medium hidden sm:block whitespace-nowrap">
                            {project.credits_spent} {t('nav.credits_suffix')}
                          </span>
                        </>
                      )}
                    </div>
                  </Link>

                  {isToolRun ? (
                    <span
                      className="shrink-0 px-2.5 py-1 rounded-full text-xs font-medium"
                      style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.25)' }}
                    >
                      {t('dashboard.type_tool')}
                    </span>
                  ) : (
                    <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[project.status]}`}>
                      {statusLabel(project.status)}
                    </span>
                  )}

                  <MediaBadge project={project} />

                  <Link
                    href={href}
                    className={`shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      isToolRun || project.status === 'completed' ? 'btn-ghost-dark' : 'btn-gradient text-white'
                    }`}
                  >
                    {isToolRun
                      ? t('dashboard.open_result')
                      : project.status === 'completed'
                        ? t('dashboard.open')
                        : t('dashboard.continue')}
                  </Link>

                  <DeleteProjectButton projectId={project.id} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
