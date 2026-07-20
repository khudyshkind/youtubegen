'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useLang } from '@/hooks/useLang'
import { refreshCredits } from '@/lib/refresh-credits'
import { CREDIT_COSTS } from '@/lib/types'

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function ThumbnailContent() {
  const { t } = useLang()
  const searchParams = useSearchParams()
  const runId = searchParams.get('run')

  const [title, setTitle] = useState('')
  const [topic, setTopic] = useState('')
  const [thumbnailUrl, setThumbnailUrl] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)

  // Restore from ?run=
  useEffect(() => {
    if (!runId) return
    fetch(`/api/projects/${runId}`)
      .then(r => r.json())
      .then(json => {
        const p = json.data?.project
        if (json.ok && p?.thumbnail_url) {
          setThumbnailUrl(p.thumbnail_url)
          setTitle(p.title ?? '')
          setTopic(p.topic ?? '')
          setSavedId(runId)
        }
      })
      .catch(() => {})
  }, [runId])

  async function handleGenerate() {
    if (!title.trim() || !topic.trim()) { setError(t('tools.thumb_err_required')); return }
    setError('')
    setThumbnailUrl('')
    setSavedId(null)
    setGenerating(true)

    try {
      const res = await fetch('/api/generate/thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, topic }),
      })
      if (res.status === 504 || res.status === 524) throw new Error(t('tools.err_timeout'))
      const json: { ok: boolean; data?: { thumbnail_url: string; tool_run_id?: string }; error?: string; code?: string } = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') { setError(t('tools.err_credits')); return }
        throw new Error(json.error ?? t('tools.err_gen'))
      }
      setThumbnailUrl(json.data!.thumbnail_url)
      if (json.data?.tool_run_id) setSavedId(json.data.tool_run_id)
      void refreshCredits()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tools.err_gen'))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/tools" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">{t('tools.back_to_tools')}</Link>
        <h1 className="text-2xl font-bold text-slate-100 mt-2">{t('tools.thumb_title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.thumb_subtitle')}</p>
      </div>

      <div className="rounded-2xl p-6 flex flex-col gap-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>

        <div>
          <label className="text-xs font-medium text-slate-400 block mb-1.5">{t('tools.thumb_title_label')}</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t('tools.thumb_title_ph')}
            maxLength={120}
            className="w-full px-4 py-2.5 rounded-xl text-sm"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', outline: 'none' }}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-400 block mb-1.5">{t('tools.thumb_topic_label')}</label>
          <input
            type="text"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder={t('tools.thumb_topic_ph')}
            maxLength={300}
            className="w-full px-4 py-2.5 rounded-xl text-sm"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', outline: 'none' }}
          />
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-xl btn-gradient text-white transition-all disabled:opacity-60"
        >
          {generating ? (
            <><SpinnerIcon className="w-4 h-4 animate-spin" /> {t('tools.thumb_generating')}</>
          ) : (
            <>{t('tools.thumb_gen_btn')} · −{CREDIT_COSTS.thumbnail} {t('nav.credits_suffix')}</>
          )}
        </button>

        {error && (
          <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {thumbnailUrl && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-400">
                {t('tools.thumb_result_label')}
                {savedId && <span className="ml-2 text-green-500">{t('tools.saved')}</span>}
              </p>
              <a
                href={thumbnailUrl}
                download="thumbnail.png"
                className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-all"
                style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa' }}
              >
                ↓ {t('tools.thumb_download')}
              </a>
            </div>
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailUrl}
                alt={title}
                className="w-full"
                style={{ aspectRatio: '16/9', objectFit: 'cover' }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ThumbnailGenPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">Загрузка...</div>}>
      <ThumbnailContent />
    </Suspense>
  )
}
