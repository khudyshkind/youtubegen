'use client'

import { useEffect, useState } from 'react'
import type { ServiceResult } from '@/app/api/admin/services/route'

// ─── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  ok:            'bg-green-400',
  warn:          'bg-amber-400',
  error:         'bg-red-500',
  unconfigured:  'bg-gray-300',
}

const STATUS_RING: Record<string, string> = {
  ok:            'ring-green-200',
  warn:          'ring-amber-200',
  error:         'ring-red-200',
  unconfigured:  'ring-gray-200',
}

const STATUS_LABEL: Record<string, string> = {
  ok:            'Норма',
  warn:          'Предупреждение',
  error:         'Ошибка',
  unconfigured:  'Не настроен',
}

const STATUS_BADGE: Record<string, string> = {
  ok:            'bg-green-50 text-green-700 border-green-200',
  warn:          'bg-amber-50 text-amber-700 border-amber-200',
  error:         'bg-red-50 text-red-600 border-red-200',
  unconfigured:  'bg-gray-50 text-gray-500 border-gray-200',
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex w-2.5 h-2.5 rounded-full ring-4 ${STATUS_DOT[status] ?? 'bg-gray-300'} ${STATUS_RING[status] ?? 'ring-gray-100'}`}
    />
  )
}

function ServiceCard({ svc }: { svc: ServiceResult }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col gap-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="text-2xl leading-none">{svc.icon}</div>
          <div>
            <p className="font-semibold text-gray-800 text-sm leading-tight">{svc.name}</p>
            <span
              className={`inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[svc.status] ?? STATUS_BADGE.unconfigured}`}
            >
              <StatusDot status={svc.status} />
              {STATUS_LABEL[svc.status] ?? svc.status}
            </span>
          </div>
        </div>
        <a
          href={svc.link}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-gray-400 hover:text-gray-700 transition-colors p-1.5 rounded-lg hover:bg-gray-100"
          title={`Открыть ${svc.name}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>

      {/* Metrics */}
      {svc.metrics.length > 0 && (
        <div className="flex flex-col gap-2 pt-1 border-t border-gray-50">
          {svc.metrics.map((m) => (
            <div key={m.label} className="flex items-start justify-between gap-2">
              <span className="text-xs text-gray-400 shrink-0">{m.label}</span>
              {m.url ? (
                <a href={m.url} target="_blank" rel="noopener noreferrer"
                   className="text-xs text-blue-600 hover:text-blue-800 font-medium text-right hover:underline">
                  {m.value}
                </a>
              ) : (
                <span className="text-xs text-gray-700 font-medium text-right">{m.value}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Error message */}
      {svc.error && (
        <p className="text-xs text-red-500 bg-red-50 rounded-lg px-2.5 py-1.5 leading-snug">
          {svc.error}
        </p>
      )}
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 bg-gray-100 rounded-xl" />
        <div className="flex-1">
          <div className="h-4 bg-gray-200 rounded w-32 mb-2" />
          <div className="h-3 bg-gray-100 rounded w-20" />
        </div>
      </div>
      <div className="border-t border-gray-50 pt-3 flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex justify-between">
            <div className="h-3 bg-gray-100 rounded w-24" />
            <div className="h-3 bg-gray-100 rounded w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Summary bar ────────────────────────────────────────────────────────────────

function SummaryBar({ services }: { services: ServiceResult[] }) {
  const counts = services.reduce<Record<string, number>>(
    (acc, s) => { acc[s.status] = (acc[s.status] ?? 0) + 1; return acc },
    {}
  )
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {(['ok', 'warn', 'error', 'unconfigured'] as const).map((s) => {
        const n = counts[s] ?? 0
        if (n === 0) return null
        return (
          <div key={s} className="flex items-center gap-1.5">
            <StatusDot status={s} />
            <span className="text-sm text-gray-600 font-medium">{n}</span>
            <span className="text-xs text-gray-400">{STATUS_LABEL[s]}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────

interface ServicesResponse {
  ok: boolean
  services: ServiceResult[]
  checkedAt: string
}

export default function AdminServicesPage() {
  const [data, setData] = useState<ServicesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/services', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as ServicesResponse
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const checkedAt = data?.checkedAt
    ? new Date(data.checkedAt).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    : null

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Сервисы</h1>
          <p className="text-gray-500 text-sm mt-1">Мониторинг балансов и статусов внешних API</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Проверяем...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Обновить все
              </>
            )}
          </button>
          {checkedAt && (
            <p className="text-xs text-gray-400">Обновлено: {checkedAt}</p>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          Ошибка загрузки: {error}
        </div>
      )}

      {/* Summary */}
      {data && !loading && (
        <div className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Сводка</p>
          <SummaryBar services={data.services} />
        </div>
      )}

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading
          ? Array.from({ length: 19 }).map((_, i) => <SkeletonCard key={i} />)
          : data?.services.map((svc) => <ServiceCard key={svc.key} svc={svc} />)
        }
      </div>
    </div>
  )
}
