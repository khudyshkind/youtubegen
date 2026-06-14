'use client'

import { useEffect, useState } from 'react'

// ─── types ────────────────────────────────────────────────────────────────────

interface PaddleRevenue {
  monthlyTotal: number
  currency: string
  txCount: number
  avgCheck: number
  activeSubs: number
  error?: string
}

interface TopUser {
  id: string
  email: string
  full_name: string | null
  plan: string
  credits: number
  projectCount: number
}

interface DashboardData {
  totalUsers: number
  newToday: number
  newWeek: number
  totalProjects: number
  completedVideos: number
  regDays: [string, number][]
  opEntries: [string, number][]
  topUsers: TopUser[]
  paddle: PaddleRevenue
  svcKeyPresent: boolean
  svcKeyLength: number
  svcKeyPrefix: string
  hasQueryError: boolean
  queryError?: string
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-extrabold ${accent ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function MiniBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-28 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-8 text-right">{value}</span>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex flex-col gap-8 animate-pulse">
      <div>
        <div className="h-7 w-32 bg-gray-200 rounded-lg mb-2" />
        <div className="h-4 w-48 bg-gray-100 rounded" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-gray-200 p-5 h-24" />
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-gray-200 p-5 h-24" />
        ))}
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [data, setData]   = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/dashboard', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((json: DashboardData) => setData(json))
      .catch((e: Error) => setError(e.message))
  }, [])

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
        Ошибка загрузки данных: {error}
      </div>
    )
  }

  if (!data) return <Spinner />

  const fmt = (n: number, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)

  const regMax = Math.max(1, ...data.regDays.map(([, v]) => v))
  const opMax  = Math.max(1, ...data.opEntries.map(([, v]) => v))

  const opLabels: Record<string, string> = {
    script_sonnet: 'Сценарий (Sonnet)', script_opus: 'Сценарий (Opus)', script_gpt: 'Сценарий (GPT)',
    audio: 'Озвучка', subtitles: 'Субтитры', image: 'Иллюстрации',
    video: 'Сборка видео', seo: 'SEO', thumbnail: 'Превью',
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Дашборд</h1>
        <p className="text-gray-500 text-sm mt-1">Общая статистика проекта</p>
      </div>

      {/* Diagnostic banners */}
      {!data.svcKeyPresent && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          ⚠️ <strong>SUPABASE_SERVICE_ROLE_KEY</strong> не задан (длина: {data.svcKeyLength}, префикс: «{data.svcKeyPrefix}»).
          Добавьте ключ в Vercel → Settings → Environment Variables.
        </div>
      )}
      {data.svcKeyPresent && data.hasQueryError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
          ⚠️ Ошибка Supabase: {data.queryError}
        </div>
      )}

      {/* User stats */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Пользователи</p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="Всего пользователей" value={data.totalUsers} />
          <StatCard label="Новых сегодня"        value={data.newToday} />
          <StatCard label="Новых за неделю"       value={data.newWeek} />
          <StatCard label="Всего проектов"        value={data.totalProjects} />
          <StatCard label="Готовых видео"         value={data.completedVideos} />
        </div>
      </div>

      {/* Revenue stats */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Финансы (Paddle)</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Выручка за месяц"
            value={data.paddle.error && data.paddle.monthlyTotal === 0 ? '—' : fmt(data.paddle.monthlyTotal, data.paddle.currency)}
            sub={data.paddle.error ? `⚠️ ${data.paddle.error}` : undefined}
            accent="text-green-700"
          />
          <StatCard label="Активных подписок"   value={data.paddle.activeSubs} />
          <StatCard label="Транзакций за месяц" value={data.paddle.txCount} />
          <StatCard
            label="Средний чек"
            value={data.paddle.txCount > 0 ? fmt(data.paddle.avgCheck, data.paddle.currency) : '—'}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Registrations chart */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <p className="text-sm font-semibold text-gray-700 mb-4">Регистрации (30 дней)</p>
          {data.regDays.some(([, v]) => v > 0) ? (
            <>
              <div className="flex items-end gap-0.5 h-28">
                {data.regDays.map(([label, val]) => (
                  <div key={label} className="flex flex-col items-center flex-1 gap-0.5 h-full justify-end">
                    <div
                      className="w-full bg-red-400 hover:bg-red-500 rounded-t transition-colors cursor-default"
                      style={{ height: `${(val / regMax) * 100}%`, minHeight: val > 0 ? '3px' : '0' }}
                      title={`${label}: ${val}`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-[10px] text-gray-400">
                <span>{data.regDays[0]?.[0]}</span>
                <span>{data.regDays[14]?.[0]}</span>
                <span>{data.regDays[data.regDays.length - 1]?.[0]}</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">Нет регистраций за 30 дней</p>
          )}
        </div>

        {/* Operations chart */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <p className="text-sm font-semibold text-gray-700 mb-4">Генерации по типу (30 дней)</p>
          {data.opEntries.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {data.opEntries.map(([op, cnt]) => (
                <MiniBar key={op} label={opLabels[op] ?? op} value={cnt} max={opMax} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Нет данных о генерациях</p>
          )}
        </div>
      </div>

      {/* Top 5 users */}
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">Топ-5 активных пользователей</p>
          <a href="/admin/users" className="text-xs text-red-500 hover:text-red-600 font-medium">
            Все пользователи →
          </a>
        </div>
        <div className="divide-y divide-gray-50">
          {data.topUsers.length > 0 ? data.topUsers.map((u, i) => (
            <div key={u.id} className="flex items-center gap-4 px-6 py-3">
              <span className="text-lg font-bold text-gray-300 w-6 shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{u.email ?? '—'}</p>
                <p className="text-xs text-gray-400">{u.full_name ?? ''} · {u.plan ?? 'free'}</p>
              </div>
              <span className="text-sm font-bold text-gray-700 shrink-0">{u.projectCount} проектов</span>
              <a href={`/admin/users?q=${encodeURIComponent(u.email ?? '')}`}
                className="text-xs text-red-500 hover:text-red-600 font-medium shrink-0">→</a>
            </div>
          )) : (
            <p className="px-6 py-8 text-sm text-gray-400 text-center">
              {data.svcKeyPresent ? 'Нет проектов' : 'Данные недоступны — проверьте service role key'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
