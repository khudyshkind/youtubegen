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

interface TitleResult { title: string; sources: string[] }
interface HookResult { hook: string; sources: string[] }
interface SourceVideo { title: string; views: number }
interface TitlesData {
  niche: string
  patterns: string[]
  titles: TitleResult[]
  hooks: HookResult[]
  source_videos: Record<string, SourceVideo>
}

function SourceBadges({ sources, videoMap }: { sources: string[]; videoMap: Record<string, SourceVideo> }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {sources.map(id => {
        const info = videoMap[id]
        return (
          <a
            key={id}
            href={`https://youtube.com/watch?v=${id}`}
            target="_blank"
            rel="noopener noreferrer"
            title={info ? `${info.title} · ${(info.views / 1000).toFixed(0)}K просм.` : id}
            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full transition-all hover:opacity-80"
            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
          >
            ▶ {info ? info.title.slice(0, 30) + (info.title.length > 30 ? '…' : '') : id.slice(0, 8)}
          </a>
        )
      })}
    </div>
  )
}

function TitlesByNicheContent() {
  const { t, lang } = useLang()
  const searchParams = useSearchParams()
  const runId = searchParams.get('run')

  const [niche, setNiche] = useState('')
  const [outputLang, setOutputLang] = useState(lang === 'en' ? 'en' : 'ru')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<TitlesData | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  // Restore from ?run=
  useEffect(() => {
    if (!runId) return
    fetch(`/api/projects/${runId}`)
      .then(r => r.json())
      .then(json => {
        const p = json.data?.project
        if (json.ok && p?.script) {
          try {
            const parsed = JSON.parse(p.script) as TitlesData
            setResult(parsed)
            setNiche(p.topic ?? parsed.niche ?? '')
            setSavedId(runId)
          } catch { /* not valid JSON */ }
        }
      })
      .catch(() => {})
  }, [runId])

  async function handleGenerate() {
    if (!niche.trim()) { setError(t('tools.err_empty')); return }
    setError('')
    setResult(null)
    setSavedId(null)
    setSaveError('')
    setGenerating(true)

    try {
      const res = await fetch('/api/generate/titles-by-niche', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche, language: outputLang }),
      })
      if (res.status === 504 || res.status === 524) throw new Error(t('tools.err_timeout'))
      const json: { ok: boolean; data?: TitlesData; error?: string; code?: string } = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') { setError(t('tools.err_credits')); return }
        throw new Error(json.error ?? t('tools.err_gen'))
      }
      setResult(json.data!)
      void refreshCredits()
      void saveRun(niche, json.data!)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tools.err_gen'))
    } finally {
      setGenerating(false)
    }
  }

  async function saveRun(nicheInput: string, data: TitlesData) {
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch('/api/tools/save-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_type: 'titles-niche',
          title: t('tools.card_titles_niche'),
          input_text: nicheInput,
          result_text: JSON.stringify(data),
          credits_spent: CREDIT_COSTS.titles_by_niche,
        }),
      })
      const json: { ok: boolean; data?: { project_id: string; script: string | null } } = await res.json()
      if (json.ok && json.data?.script) setSavedId(json.data.project_id)
      else setSaveError(t('tools.save_fail'))
    } catch {
      setSaveError(t('tools.save_fail'))
    } finally {
      setSaving(false)
    }
  }

  async function copyText(text: string, key: string) {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/tools" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">{t('tools.back_to_tools')}</Link>
        <h1 className="text-2xl font-bold text-slate-100 mt-2">{t('tools.titles_title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.titles_subtitle')}</p>
      </div>

      <div className="rounded-2xl p-6 flex flex-col gap-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>

        <div className="flex gap-3 flex-wrap">
          <div className="flex-[2] min-w-[200px]">
            <label className="text-xs font-medium text-slate-400 block mb-1.5">{t('tools.titles_niche_label')}</label>
            <input
              type="text"
              value={niche}
              onChange={e => setNiche(e.target.value)}
              placeholder={t('tools.titles_niche_ph')}
              onKeyDown={e => e.key === 'Enter' && handleGenerate()}
              className="w-full px-4 py-2.5 rounded-xl text-sm"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', outline: 'none' }}
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs font-medium text-slate-400 block mb-1.5">{t('tools.output_lang')}</label>
            <select
              value={outputLang}
              onChange={e => setOutputLang(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-300 cursor-pointer outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <option value="ru" className="bg-slate-900">🇷🇺 Русский</option>
              <option value="en" className="bg-slate-900">🇬🇧 English</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-xl btn-gradient text-white transition-all disabled:opacity-60"
        >
          {generating ? (
            <><SpinnerIcon className="w-4 h-4 animate-spin" /> {t('tools.titles_generating')}</>
          ) : (
            <>{t('tools.titles_gen_btn')} · −{CREDIT_COSTS.titles_by_niche} {t('nav.credits_suffix')}</>
          )}
        </button>

        {error && (
          <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <p className="text-xs text-slate-500">
                {saving && t('tools.saving')}
                {savedId && !saving && <span className="text-green-500">{t('tools.saved')}</span>}
                {saveError && !saving && <span className="text-red-400">{saveError}</span>}
              </p>
            </div>

            {/* Patterns */}
            {result.patterns.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{t('tools.titles_patterns_label')}</p>
                <div className="flex flex-col gap-1.5">
                  {result.patterns.map((p, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-slate-300">
                      <span className="text-slate-600 mt-0.5 shrink-0">{i + 1}.</span>
                      <span>{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Titles */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t('tools.titles_list_label')}</p>
              <div className="flex flex-col gap-3">
                {result.titles.map((item, i) => (
                  <div key={i} className="rounded-xl p-3.5" style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.18)' }}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-slate-200 flex-1">
                        <span className="text-slate-500 mr-2">{i + 1}.</span>
                        {item.title}
                      </p>
                      <button
                        type="button"
                        onClick={() => copyText(item.title, `title-${i}`)}
                        className="shrink-0 text-xs px-2 py-1 rounded-lg border transition-all"
                        style={copied === `title-${i}`
                          ? { borderColor: 'rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.1)', color: '#34d399' }
                          : { borderColor: 'rgba(255,255,255,0.1)', color: '#64748b' }
                        }
                      >
                        {copied === `title-${i}` ? '✓' : t('tools.copy_result')}
                      </button>
                    </div>
                    {item.sources.length > 0 && (
                      <SourceBadges sources={item.sources} videoMap={result.source_videos} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Hooks */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{t('tools.titles_hooks_label')}</p>
              <div className="flex flex-col gap-3">
                {result.hooks.map((item, i) => (
                  <div key={i} className="rounded-xl p-3.5" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.18)' }}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-slate-300 flex-1 leading-relaxed">
                        <span className="text-slate-500 mr-2">{i + 1}.</span>
                        {item.hook}
                      </p>
                      <button
                        type="button"
                        onClick={() => copyText(item.hook, `hook-${i}`)}
                        className="shrink-0 text-xs px-2 py-1 rounded-lg border transition-all"
                        style={copied === `hook-${i}`
                          ? { borderColor: 'rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.1)', color: '#34d399' }
                          : { borderColor: 'rgba(255,255,255,0.1)', color: '#64748b' }
                        }
                      >
                        {copied === `hook-${i}` ? '✓' : t('tools.copy_result')}
                      </button>
                    </div>
                    {item.sources.length > 0 && (
                      <SourceBadges sources={item.sources} videoMap={result.source_videos} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function TitlesByNichePage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">Загрузка...</div>}>
      <TitlesByNicheContent />
    </Suspense>
  )
}
