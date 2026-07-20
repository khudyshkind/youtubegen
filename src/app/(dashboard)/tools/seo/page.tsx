'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useLang } from '@/hooks/useLang'
import { refreshCredits } from '@/lib/refresh-credits'
import { CREDIT_COSTS } from '@/lib/types'
import type { SeoData } from '@/lib/types'

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const { t } = useLang()
  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-xs font-medium px-2 py-1 rounded-lg border transition-all"
      style={copied
        ? { borderColor: 'rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.1)', color: '#34D399' }
        : { borderColor: 'rgba(255,255,255,0.1)', color: '#64748B' }
      }
    >
      {copied ? t('tools.copied') : t('tools.copy_result')}
    </button>
  )
}

function SeoContent() {
  const { t } = useLang()
  const searchParams = useSearchParams()
  const runId = searchParams.get('run')

  const [scriptText, setScriptText] = useState('')
  const [topic, setTopic] = useState('')
  const [result, setResult] = useState<SeoData | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Load existing run
  useEffect(() => {
    if (!runId) return
    fetch(`/api/projects/${runId}`)
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data?.seo) {
          setResult(json.data.seo as SeoData)
          setTopic(json.data.topic ?? '')
          setSavedId(runId)
        }
      })
      .catch(() => {})
  }, [runId])

  async function handleGenerate() {
    if (!scriptText.trim() && !topic.trim()) { setError(t('tools.err_empty')); return }
    setError('')
    setResult(null)
    setSavedId(null)
    setGenerating(true)
    try {
      const res = await fetch('/api/generate/seo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: scriptText, topic }),
      })
      if (res.status === 504 || res.status === 524) throw new Error(t('tools.err_timeout'))
      const json: { ok: boolean; data?: { seo: SeoData }; error?: string; code?: string } = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') { setError(t('tools.err_credits')); return }
        throw new Error(json.error ?? t('tools.err_gen'))
      }
      const seo = json.data!.seo
      setResult(seo)
      void refreshCredits()
      void saveRun(topic || scriptText.slice(0, 100), seo)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tools.err_gen'))
    } finally {
      setGenerating(false)
    }
  }

  async function saveRun(inputText: string, seo: SeoData) {
    setSaving(true)
    try {
      const res = await fetch('/api/tools/save-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_type: 'seo',
          title: t('tools.card_seo'),
          input_text: inputText,
          result_seo: seo,
          credits_spent: CREDIT_COSTS.seo,
        }),
      })
      const json: { ok: boolean; data?: { project_id: string } } = await res.json()
      if (json.ok) setSavedId(json.data!.project_id)
    } finally {
      setSaving(false)
    }
  }

  function copyAll() {
    if (!result) return
    const text = [
      `Заголовок: ${result.title}`,
      result.title_alt ? `Альт. заголовок: ${result.title_alt}` : '',
      `\nОписание:\n${result.description}`,
      `\nТеги: ${result.tags.join(', ')}`,
      `Хэштеги: ${result.hashtags.join(' ')}`,
    ].filter(Boolean).join('\n')
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/tools" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">{t('tools.back_to_tools')}</Link>
        <h1 className="text-2xl font-bold text-slate-100 mt-2">{t('tools.seo_title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.seo_subtitle')}</p>
      </div>

      <div
        className="rounded-2xl p-6 flex flex-col gap-5"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div>
          <label className="text-xs font-medium text-slate-400 block mb-1.5">{t('tools.seo_topic_label')}</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={t('tools.seo_topic_ph')}
            className="w-full px-4 py-2.5 rounded-xl text-sm"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', outline: 'none' }}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-slate-400">{t('tools.seo_script_label')}</label>
            <span className="text-xs text-slate-600">{scriptText.length} {t('tools.chars')}</span>
          </div>
          <textarea
            rows={8}
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            placeholder={t('tools.seo_script_ph')}
            className="w-full px-4 py-3 rounded-xl text-sm resize-y leading-relaxed"
          />
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-xl btn-gradient text-white transition-all disabled:opacity-60"
        >
          {generating ? (
            <><SpinnerIcon className="w-4 h-4 animate-spin" /> {t('tools.seo_generating')}</>
          ) : (
            <>{t('tools.seo_gen_btn')} · −{CREDIT_COSTS.seo} {t('nav.credits_suffix')}</>
          )}
        </button>

        {error && (
          <p className="text-sm text-red-400 rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </p>
        )}

        {result && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-400">
                {saving && <span className="text-slate-600">{t('tools.saving')}</span>}
                {savedId && !saving && <span className="text-green-500">{t('tools.saved')}</span>}
              </p>
              <button
                type="button"
                onClick={copyAll}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
                style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)', color: '#a78bfa' }}
              >
                {t('tools.seo_copy_all')}
              </button>
            </div>

            <SeoField label={t('tools.seo_title_label')} value={result.title} />
            {result.title_alt && <SeoField label={t('tools.seo_title_alt_label')} value={result.title_alt} />}
            <SeoField label={t('tools.seo_desc_label')} value={result.description} multiline />
            <SeoField label={t('tools.seo_tags_label')} value={result.tags.join(', ')} />
            <SeoField label={t('tools.seo_hashtags_label')} value={result.hashtags.join(' ')} />
          </div>
        )}
      </div>
    </div>
  )
}

function SeoField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-slate-400">{label}</label>
        <CopyButton text={value} />
      </div>
      {multiline ? (
        <textarea
          rows={4}
          value={value}
          readOnly
          className="w-full px-4 py-3 rounded-xl text-sm resize-y leading-relaxed text-slate-300"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
        />
      ) : (
        <div
          className="px-4 py-2.5 rounded-xl text-sm text-slate-300 break-words"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          {value}
        </div>
      )}
    </div>
  )
}

export default function SeoPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">Загрузка...</div>}>
      <SeoContent />
    </Suspense>
  )
}
