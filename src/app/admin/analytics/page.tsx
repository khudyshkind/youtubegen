export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-server'
import type { Project } from '@/lib/types'

const ADMIN_EMAILS = ['khudyshkin.d@gmail.com', 'denis-region@mail.ru']

function FunnelBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-600 w-32 shrink-0">{label}</span>
      <div className="flex-1 h-7 bg-gray-100 rounded-lg overflow-hidden relative">
        <div className={`h-full ${color} rounded-lg transition-all`} style={{ width: `${pct}%` }} />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-700">
          {value} ({pct}%)
        </span>
      </div>
    </div>
  )
}

export default async function AdminAnalyticsPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email || !ADMIN_EMAILS.includes(user.email)) redirect('/dashboard')

  const svc = createServiceClient()

  const [
    { data: allProjects },
    { data: allProfiles },
    { count: totalUsers },
    { data: scriptProjects },
  ] = await Promise.all([
    svc.from('projects').select('status, script, audio_url, subtitle_blocks, scene_images, video_url, seo, topic, created_at'),
    svc.from('profiles').select('id'),
    svc.from('profiles').select('*', { count: 'exact', head: true }),
    svc.from('projects').select('topic').not('script', 'is', null).limit(500),
  ])

  const projects = (allProjects ?? []) as Partial<Project>[]
  const total = projects.length

  // Funnel counts
  const funnel = {
    total,
    script:    projects.filter((p) => p.script).length,
    audio:     projects.filter((p) => p.audio_url).length,
    subtitles: projects.filter((p) => p.subtitle_blocks).length,
    images:    projects.filter((p) => p.scene_images).length,
    video:     projects.filter((p) => p.video_url).length,
    seo:       projects.filter((p) => p.seo).length,
    completed: projects.filter((p) => p.status === 'completed').length,
  }

  // Language detection from topics — simple heuristic: Cyrillic = ru
  const langCounts: Record<string, number> = {}
  for (const p of scriptProjects ?? []) {
    if (!p.topic) continue
    const lang = /[а-яёА-ЯЁ]/.test(p.topic) ? 'ru'
      : /[一-鿿]/.test(p.topic) ? 'zh'
      : /[؀-ۿ]/.test(p.topic) ? 'ar'
      : 'en'
    langCounts[lang] = (langCounts[lang] ?? 0) + 1
  }
  const langEntries = Object.entries(langCounts).sort(([, a], [, b]) => b - a).slice(0, 6)
  const langMax = Math.max(1, ...langEntries.map(([, v]) => v))

  const avgProjects = totalUsers ? (total / totalUsers).toFixed(1) : '0'
  const completedPct = total > 0 ? Math.round((funnel.completed / total) * 100) : 0

  // Drop-off: where most users stop
  const dropOff = [
    { from: 'Проект создан', to: 'Сценарий',    count: total - funnel.script },
    { from: 'Сценарий',      to: 'Озвучка',     count: funnel.script - funnel.audio },
    { from: 'Озвучка',       to: 'Субтитры',    count: funnel.audio - funnel.subtitles },
    { from: 'Субтитры',      to: 'Иллюстрации', count: funnel.subtitles - funnel.images },
    { from: 'Иллюстрации',   to: 'Видео',       count: funnel.images - funnel.video },
    { from: 'Видео',         to: 'SEO',         count: funnel.video - funnel.seo },
  ].sort((a, b) => b.count - a.count)

  const funnelColors = [
    'bg-red-400', 'bg-orange-400', 'bg-yellow-400',
    'bg-green-400', 'bg-blue-400', 'bg-purple-400', 'bg-indigo-400',
  ]

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Аналитика</h1>
        <p className="text-gray-500 text-sm mt-1">Воронка студии и поведение пользователей</p>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">Всего проектов</p>
          <p className="text-3xl font-extrabold text-gray-900">{total}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">Завершённых</p>
          <p className="text-3xl font-extrabold text-green-600">{funnel.completed}</p>
          <p className="text-xs text-gray-400 mt-1">{completedPct}% от всех</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">Среднее проектов на юзера</p>
          <p className="text-3xl font-extrabold text-gray-900">{avgProjects}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500 mb-1">Дошли до видео</p>
          <p className="text-3xl font-extrabold text-blue-600">{funnel.video}</p>
          <p className="text-xs text-gray-400 mt-1">
            {total > 0 ? Math.round((funnel.video / total) * 100) : 0}% от всех
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Funnel */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <p className="text-sm font-semibold text-gray-700 mb-5">Воронка по шагам студии</p>
          <div className="flex flex-col gap-3">
            {[
              { label: 'Все проекты',  value: funnel.total },
              { label: 'Сценарий',     value: funnel.script },
              { label: 'Озвучка',      value: funnel.audio },
              { label: 'Субтитры',     value: funnel.subtitles },
              { label: 'Иллюстрации',  value: funnel.images },
              { label: 'Видео',        value: funnel.video },
              { label: 'SEO',          value: funnel.seo },
            ].map(({ label, value }, i) => (
              <FunnelBar key={label} label={label} value={value} total={funnel.total} color={funnelColors[i] ?? 'bg-gray-300'} />
            ))}
          </div>
        </div>

        {/* Drop-off + languages */}
        <div className="flex flex-col gap-6">
          {/* Biggest drop-off */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <p className="text-sm font-semibold text-gray-700 mb-4">Где пользователи останавливаются</p>
            <div className="flex flex-col gap-2.5">
              {dropOff.map((d, i) => (
                <div key={d.from} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">{d.from} → {d.to}</span>
                  <span className={`text-sm font-bold ${i === 0 ? 'text-red-600' : 'text-gray-600'}`}>
                    -{d.count}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Languages */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <p className="text-sm font-semibold text-gray-700 mb-4">Топ языков (по темам)</p>
            <div className="flex flex-col gap-2">
              {langEntries.map(([lang, cnt]) => (
                <div key={lang} className="flex items-center gap-3">
                  <span className="text-sm font-mono text-gray-700 uppercase w-8">{lang}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-400 rounded-full"
                      style={{ width: `${(cnt / langMax) * 100}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-right">{cnt}</span>
                </div>
              ))}
              {langEntries.length === 0 && <p className="text-sm text-gray-400">Нет данных</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
