'use client'

import { useState, useEffect, useCallback } from 'react'

type JobStatus = 'queued' | 'running' | 'done' | 'failed'
type JobType = 'audio' | 'video' | 'image'

type Job = {
  id: string
  type: JobType
  user_id: string
  project_id: string | null
  engine: string | null
  status_raw: string
  status: JobStatus
  credits: number
  error: string | null
  created_at: string
  completed_at: string | null
  email: string | null
  plan: string | null
}

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  done: 'Готово',
  failed: 'Упало',
}

const STATUS_RAW_MAP: Record<string, JobStatus> = {
  pending: 'queued',
  processing: 'running',
  finalizing: 'running',
  awaiting_webhook: 'running',
  completed: 'done',
  failed: 'failed',
}

const STATUS_COLORS: Record<JobStatus, string> = {
  queued: 'bg-gray-100 text-gray-600',
  running: 'bg-yellow-100 text-yellow-800',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

const TYPE_LABELS: Record<JobType, string> = {
  audio: 'Озвучка',
  video: 'Рендер',
  image: 'Иллюстрации',
}

function fmtDuration(created: string, completed: string | null): string {
  if (!completed) return '—'
  const ms = new Date(completed).getTime() - new Date(created).getTime()
  if (ms <= 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} с`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem > 0 ? `${m} м ${rem} с` : `${m} м`
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtCredits(n: number): string {
  return n === 0 ? '—' : new Intl.NumberFormat('ru-RU').format(n)
}

export default function JobsTable() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  const [days, setDays] = useState(7)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [emailFilter, setEmailFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const p = new URLSearchParams({ days: String(days), status: statusFilter, type: typeFilter })
      if (emailFilter.trim()) p.set('email', emailFilter.trim())
      const res = await fetch(`/api/admin/jobs?${p}`)
      const data = await res.json()
      if (!data.ok) throw new Error(data.error ?? 'Ошибка сервера')
      setJobs(data.jobs)
      setLastFetch(new Date())
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [days, statusFilter, typeFilter, emailFilter])

  useEffect(() => { load() }, [load])

  const failedCount = jobs.filter(j => j.status === 'failed').length
  const runningCount = jobs.filter(j => j.status === 'running').length

  return (
    <div className="flex flex-col gap-4">
      {/* Filters + refresh */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 font-medium">Период</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-200">
            {[1, 7, 30].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  days === d
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {d}д
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 font-medium">Статус</span>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            <option value="all">Все статусы</option>
            <option value="queued">В очереди</option>
            <option value="running">Выполняется</option>
            <option value="done">Готово</option>
            <option value="failed">Упало</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 font-medium">Тип задачи</span>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            <option value="all">Все типы</option>
            <option value="audio">Озвучка</option>
            <option value="video">Рендер</option>
            <option value="image">Иллюстрации</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 font-medium">Пользователь (email)</span>
          <input
            type="text"
            placeholder="Поиск по email..."
            value={emailFilter}
            onChange={e => setEmailFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-gray-300 w-48"
          />
        </div>

        <button
          onClick={load}
          disabled={loading}
          className="ml-auto flex items-center gap-2 px-4 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Обновить
        </button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 text-sm text-gray-500">
        {lastFetch && (
          <span>Обновлено: {lastFetch.toLocaleTimeString('ru-RU')}</span>
        )}
        {!loading && !fetchError && (
          <>
            <span className="font-medium text-gray-700">{jobs.length} задач</span>
            {runningCount > 0 && (
              <span className="text-yellow-700 font-medium">{runningCount} выполняется</span>
            )}
            {failedCount > 0 && (
              <span className="text-red-600 font-medium">{failedCount} упало</span>
            )}
          </>
        )}
      </div>

      {/* Error */}
      {fetchError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
          {fetchError}
        </div>
      )}

      {/* Table */}
      {!fetchError && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Время</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Пользователь</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Тариф</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Тип</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Статус</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Длительность</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Кредиты</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ошибка</th>
              </tr>
            </thead>
            <tbody>
              {loading && jobs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    Загрузка...
                  </td>
                </tr>
              )}
              {!loading && jobs.length === 0 && !fetchError && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    Задач не найдено
                  </td>
                </tr>
              )}
              {jobs.map(job => (
                <tr key={`${job.type}-${job.id}`} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap font-mono text-xs">
                    {fmtDateTime(job.created_at)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {job.email ? (
                      <span className="text-gray-800">{job.email}</span>
                    ) : (
                      <span className="text-gray-400 font-mono text-xs">{job.user_id.slice(0, 8)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {job.plan ? (
                      <span className={`text-xs font-medium ${job.plan !== 'free' ? 'text-indigo-700' : 'text-gray-500'}`}>
                        {job.plan}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-gray-700">
                      {TYPE_LABELS[job.type]}
                      {job.engine && (
                        <span className="text-gray-400 ml-1 text-xs">({job.engine})</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_COLORS[job.status]}`}>
                      {STATUS_LABELS[job.status]}
                    </span>
                    {job.status_raw !== job.status && job.status_raw !== 'completed' && job.status_raw !== 'failed' && job.status_raw !== 'pending' && (
                      <span className="ml-1 text-gray-400 text-xs">({job.status_raw})</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600 font-mono text-xs">
                    {fmtDuration(job.created_at, job.completed_at)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-mono text-xs text-gray-700">
                    {fmtCredits(job.credits)}
                  </td>
                  <td className="px-4 py-3 max-w-md">
                    {job.error ? (
                      <pre className="whitespace-pre-wrap font-mono text-xs text-red-700 bg-red-50 rounded px-2 py-1 leading-relaxed">
                        {job.error}
                      </pre>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Status mapping reference */}
      <details className="mt-2">
        <summary className="text-xs text-gray-400 cursor-pointer select-none hover:text-gray-600">
          Маппинг статусов
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="text-xs border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-gray-600 font-medium">Статус в БД</th>
                <th className="px-3 py-2 text-left text-gray-600 font-medium">Таблица</th>
                <th className="px-3 py-2 text-left text-gray-600 font-medium">Отображение</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {[
                { raw: 'pending', tables: 'audio_jobs, video_jobs, image_jobs', display: 'В очереди' },
                { raw: 'processing', tables: 'audio_jobs, video_jobs, image_jobs', display: 'Выполняется' },
                { raw: 'finalizing', tables: 'image_jobs', display: 'Выполняется' },
                { raw: 'awaiting_webhook', tables: 'image_jobs', display: 'Выполняется' },
                { raw: 'completed', tables: 'audio_jobs, video_jobs, image_jobs', display: 'Готово' },
                { raw: 'failed', tables: 'audio_jobs, video_jobs, image_jobs', display: 'Упало' },
              ].map(row => (
                <tr key={row.raw}>
                  <td className="px-3 py-2 font-mono text-gray-700">{row.raw}</td>
                  <td className="px-3 py-2 text-gray-500">{row.tables}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[STATUS_RAW_MAP[row.raw]]}`}>
                      {row.display}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
