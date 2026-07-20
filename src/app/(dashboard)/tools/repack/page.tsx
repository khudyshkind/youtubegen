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

interface RepackFormats {
  telegram: string
  dzen: string
  thread: string
}

function FormatBlock({ label, text, color }: { label: string; text: string; color: string }) {
  const [copied, setCopied] = useState(false)
  const { t } = useLang()

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color }}>{label}</span>
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
      </div>
      <textarea
        rows={text.length > 800 ? 10 : 6}
        value={text}
        readOnly
        className="w-full px-3 py-2.5 rounded-lg text-sm resize-y leading-relaxed text-slate-300"
        style={{ background: 'rgba(255,255,255,0.02)', border: 'none', outline: 'none' }}
      />
    </div>
  )
}

function RepackContent() {
  const { t, lang } = useLang()
  const searchParams = useSearchParams()
  const runId = searchParams.get('run')

  const [inputText, setInputText] = useState('')
  const [result, setResult] = useState<RepackFormats | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Load existing run
  useEffect(() => {
    if (!runId) return
    fetch(`/api/projects/${runId}`)
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data?.script) {
          // Repack stores JSON in script field
          try {
            const parsed = JSON.parse(json.data.script) as RepackFormats
            if (parsed.telegram && parsed.dzen && parsed.thread) {
              setResult(parsed)
              setInputText(json.data.topic ?? '')
              setSavedId(runId)
            }
          } catch { /* not JSON, skip */ }
        }
      })
      .catch(() => {})
  }, [runId])

  async function handleGenerate() {
    if (!inputText.trim()) { setError(t('tools.err_empty')); return }
    setError('')
    setResult(null)
    setSavedId(null)
    setGenerating(true)
    try {
      const res = await fetch('/api/generate/repack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: inputText, language: lang }),
      })
      if (res.status === 504 || res.status === 524) throw new Error(t('tools.err_timeout'))
      const json: { ok: boolean; data?: { formats: RepackFormats }; error?: string; code?: string } = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') { setError(t('tools.err_credits')); return }
        throw new Error(json.error ?? t('tools.err_gen'))
      }
      const formats = json.data!.formats
      setResult(formats)
      void refreshCredits()
      void saveRun(inputText, formats)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tools.err_gen'))
    } finally {
      setGenerating(false)
    }
  }

  async function saveRun(inputText: string, formats: RepackFormats) {
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch('/api/tools/save-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_type: 'repack',
          title: t('tools.card_repack'),
          input_text: inputText,
          result_text: JSON.stringify(formats),
          credits_spent: CREDIT_COSTS.repack,
        }),
      })
      const json: { ok: boolean; data?: { project_id: string } } = await res.json()
      if (json.ok) setSavedId(json.data!.project_id)
      else setSaveError(t('tools.save_fail'))
    } catch {
      setSaveError(t('tools.save_fail'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/tools" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">{t('tools.back_to_tools')}</Link>
        <h1 className="text-2xl font-bold text-slate-100 mt-2">{t('tools.repack_title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.repack_subtitle')}</p>
      </div>

      <div
        className="rounded-2xl p-6 flex flex-col gap-5"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-slate-400">{t('tools.repack_input_label')}</label>
            <span className="text-xs text-slate-600">{inputText.length} {t('tools.chars')}</span>
          </div>
          <textarea
            rows={10}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={t('tools.repack_input_ph')}
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
            <><SpinnerIcon className="w-4 h-4 animate-spin" /> {t('tools.repack_generating')}</>
          ) : (
            <>{t('tools.repack_gen_btn')} · −{CREDIT_COSTS.repack} {t('nav.credits_suffix')}</>
          )}
        </button>

        {error && (
          <div className="rounded-xl px-4 py-3 flex items-center justify-between gap-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-sm text-red-400">{error}</p>
            <button type="button" onClick={handleGenerate} className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171' }}>{t('tools.retry')}</button>
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-xs">
                {saving && <span className="text-slate-600">{t('tools.saving')}</span>}
                {savedId && !saving && <span className="text-green-500">{t('tools.saved')}</span>}
                {saveError && !saving && <span className="text-red-400">{saveError}</span>}
              </p>
            </div>
            <FormatBlock
              label={`📱 ${t('tools.repack_tg_label')}`}
              text={result.telegram}
              color="#60a5fa"
            />
            <FormatBlock
              label={`📰 ${t('tools.repack_dzen_label')}`}
              text={result.dzen}
              color="#a78bfa"
            />
            <FormatBlock
              label={`🧵 ${t('tools.repack_thread_label')}`}
              text={result.thread}
              color="#34d399"
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default function RepackPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">Загрузка...</div>}>
      <RepackContent />
    </Suspense>
  )
}
