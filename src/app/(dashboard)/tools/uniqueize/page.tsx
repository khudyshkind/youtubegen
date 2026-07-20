'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useLang } from '@/hooks/useLang'
import { useStudioStore } from '@/lib/studio-store'
import { refreshCredits } from '@/lib/refresh-credits'
import { SCRIPT_LANGUAGES } from '@/lib/languages'
import { CREDIT_COSTS } from '@/lib/types'

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function UniqueizeContent() {
  const { t, lang } = useLang()
  const router = useRouter()
  const searchParams = useSearchParams()
  const runId = searchParams.get('run')

  const [inputText, setInputText] = useState('')
  const [outputLang, setOutputLang] = useState('ru')
  const [resultText, setResultText] = useState('')
  const [processingMode, setProcessingMode] = useState<'unique' | 'human' | 'both' | null>(null)
  const [bothStep, setBothStep] = useState<1 | 2 | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [copied, setCopied] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [usingStudio, setUsingStudio] = useState(false)

  useEffect(() => {
    setOutputLang(lang === 'en' ? 'en' : 'ru')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load existing run from dashboard
  useEffect(() => {
    if (!runId) return
    fetch(`/api/projects/${runId}`)
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data?.script) {
          setResultText(json.data.script)
          setInputText(json.data.topic ?? '')
          setSavedId(runId)
        }
      })
      .catch(() => {})
  }, [runId])

  const charCount = inputText.length

  const creditCost = (mode: 'unique' | 'human' | 'both') =>
    mode === 'both'  ? CREDIT_COSTS.uniqueize + CREDIT_COSTS.humanize :
    mode === 'human' ? CREDIT_COSTS.humanize :
    CREDIT_COSTS.uniqueize

  async function handleProcess(mode: 'unique' | 'human' | 'both') {
    if (!inputText.trim()) { setError(t('tools.err_empty')); return }
    setError('')
    setSuccess(false)
    setResultText('')
    setSavedId(null)
    setProcessingMode(mode)
    let finalScript = ''

    try {
      if (mode === 'both') {
        setBothStep(1)
        const res1 = await fetch('/api/generate/uniqueize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script: inputText, mode: 'unique', output_lang: outputLang }),
        })
        if (res1.status === 504 || res1.status === 524) throw new Error(t('tools.err_timeout'))
        let json1: { ok: boolean; data?: { script: string }; error?: string; code?: string }
        try { json1 = await res1.json() } catch { throw new Error(t('tools.err_gen')) }
        if (!json1.ok) {
          if (json1.code === 'NO_CREDITS') { setError(t('tools.err_credits')); return }
          throw new Error(json1.error ?? t('tools.err_gen'))
        }
        const uniqueized = json1.data!.script

        setBothStep(2)
        const res2 = await fetch('/api/generate/uniqueize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script: uniqueized, mode: 'human', output_lang: outputLang }),
        })
        if (res2.status === 504 || res2.status === 524) throw new Error(t('tools.err_timeout'))
        let json2: { ok: boolean; data?: { script: string }; error?: string; code?: string }
        try { json2 = await res2.json() } catch { throw new Error(t('tools.err_gen')) }
        if (!json2.ok) {
          if (json2.code === 'NO_CREDITS') { setError(t('tools.err_credits')); return }
          throw new Error(json2.error ?? t('tools.err_gen'))
        }
        finalScript = json2.data!.script
      } else {
        const res = await fetch('/api/generate/uniqueize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script: inputText, mode, output_lang: outputLang }),
        })
        if (res.status === 504 || res.status === 524) throw new Error(t('tools.err_timeout'))
        let json: { ok: boolean; data?: { script: string }; error?: string; code?: string }
        try { json = await res.json() } catch { throw new Error(t('tools.err_gen')) }
        if (!json.ok) {
          if (json.code === 'NO_CREDITS') { setError(t('tools.err_credits')); return }
          throw new Error(json.error ?? t('tools.err_gen'))
        }
        finalScript = json.data!.script
      }

      setResultText(finalScript)
      setSuccess(true)
      void refreshCredits()
      setTimeout(() => setSuccess(false), 3000)
      void saveRun(inputText, finalScript, creditCost(mode))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tools.err_gen'))
    } finally {
      setProcessingMode(null)
      setBothStep(null)
    }
  }

  async function saveRun(input: string, result: string, credits: number) {
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch('/api/tools/save-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_type: 'uniqueize',
          title: t('tools.card_uniqueizer'),
          input_text: input,
          result_text: result,
          credits_spent: credits,
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

  async function handleCopyResult() {
    if (!resultText) return
    await navigator.clipboard.writeText(resultText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleUseInStudio() {
    if (!resultText.trim()) return
    setUsingStudio(true)
    try {
      const res = await fetch('/api/projects/from-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: inputText.slice(0, 100) || t('tools.card_uniqueizer'),
          script: resultText,
          language: outputLang,
          credits_spent: 0,
        }),
      })
      const json: { ok: boolean; data?: { project: { id: string } }; error?: string } = await res.json()
      if (!json.ok) throw new Error(json.error)
      const projectId = json.data!.project.id

      const store = useStudioStore.getState()
      store.reset()
      store.setProjectId(projectId)
      store.setScript(resultText)
      store.setStep(3)

      router.push('/studio?from=tools')
    } catch {
      setSaveError('Ошибка открытия студии')
      setUsingStudio(false)
    }
  }

  const isProcessing = processingMode !== null

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/tools" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">{t('tools.back_to_tools')}</Link>
        <h1 className="text-2xl font-bold text-slate-100 mt-2">{t('tools.uniqueizer')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.card_uniqueizer_desc')}</p>
      </div>

      <div
        className="rounded-2xl p-6 flex flex-col gap-5"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* Input */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-slate-400">{t('tools.input_label')}</label>
            <span className="text-xs text-slate-600">{charCount} {t('tools.chars')}</span>
          </div>
          <textarea
            rows={10}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={t('tools.input_ph')}
            className="w-full px-4 py-3 rounded-xl text-sm resize-y leading-relaxed"
          />
        </div>

        {/* Output language */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-slate-400 whitespace-nowrap">{t('tools.output_lang')}</label>
          <select
            value={outputLang}
            onChange={(e) => setOutputLang(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            {SCRIPT_LANGUAGES.map(l => (
              <option key={l.code} value={l.code} className="bg-slate-900">{l.flag} {l.name}</option>
            ))}
          </select>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <button
                type="button"
                onClick={() => handleProcess('unique')}
                disabled={isProcessing}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold rounded-xl transition-all disabled:opacity-50"
                style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', color: processingMode === 'unique' ? '#6b7280' : '#60a5fa' }}
              >
                {processingMode === 'unique' ? (
                  <><SpinnerIcon className="w-4 h-4 animate-spin" /> {t('tools.processing')}</>
                ) : (
                  <>{t('tools.unique_btn')} · −{creditCost('unique')} {t('nav.credits_suffix')}</>
                )}
              </button>
              <p className="text-xs text-slate-500 mt-1 text-center">{t('tools.uniqueize_desc')}</p>
            </div>
            <div className="flex-1">
              <button
                type="button"
                onClick={() => handleProcess('human')}
                disabled={isProcessing}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold rounded-xl transition-all disabled:opacity-50"
                style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: processingMode === 'human' ? '#6b7280' : '#34d399' }}
              >
                {processingMode === 'human' ? (
                  <><SpinnerIcon className="w-4 h-4 animate-spin" /> {t('tools.processing')}</>
                ) : (
                  <>{t('tools.human_btn')} · −{creditCost('human')} {t('nav.credits_suffix')}</>
                )}
              </button>
              <p className="text-xs text-slate-500 mt-1 text-center">{t('tools.humanize_desc')}</p>
            </div>
          </div>
          <div>
            <button
              type="button"
              onClick={() => handleProcess('both')}
              disabled={isProcessing}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold rounded-xl transition-all disabled:opacity-50"
              style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)', color: processingMode === 'both' ? '#6b7280' : '#a78bfa' }}
            >
              {processingMode === 'both' ? (
                <><SpinnerIcon className="w-4 h-4 animate-spin" /> {bothStep === 1 ? 'Шаг 1/2: повышаем уникальность...' : 'Шаг 2/2: убираем следы ИИ...'}</>
              ) : (
                <>{t('tools.both_btn')} · −{creditCost('both')} {t('nav.credits_suffix')}</>
              )}
            </button>
            <p className="text-xs text-slate-500 mt-1 text-center">{t('tools.both_desc')}</p>
          </div>

          {charCount > 0 && (
            <p className="text-xs text-slate-600 text-right">
              {charCount} {t('tools.cost_info')} <span className="text-slate-400">{CREDIT_COSTS.uniqueize} / {CREDIT_COSTS.humanize} / {CREDIT_COSTS.uniqueize + CREDIT_COSTS.humanize} {t('nav.credits_suffix')}</span>
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-xl px-4 py-3 flex items-center justify-between gap-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {success && (
          <p className="text-xs font-medium rounded-xl px-3 py-2 text-center" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#34d399' }}>
            {t('tools.done_ok')}
          </p>
        )}

        {/* Result */}
        {resultText && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-400">
                {t('tools.result_label')}
                {saving && <span className="ml-2 text-slate-600">{t('tools.saving')}</span>}
                {savedId && !saving && <span className="ml-2 text-green-500">{t('tools.saved')}</span>}
                {saveError && !saving && <span className="ml-2 text-red-400">{saveError}</span>}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopyResult}
                  className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border transition-all"
                  style={copied
                    ? { borderColor: 'rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.1)', color: '#34D399' }
                    : { borderColor: 'rgba(255,255,255,0.1)', color: '#64748B' }
                  }
                >
                  {copied ? t('tools.copied') : t('tools.copy_result')}
                </button>
                <button
                  type="button"
                  onClick={handleUseInStudio}
                  disabled={usingStudio}
                  className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-all disabled:opacity-60"
                  style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)', color: '#a78bfa' }}
                >
                  {usingStudio ? t('tools.use_studio_creating') : t('tools.use_studio')}
                </button>
              </div>
            </div>
            <textarea
              rows={10}
              value={resultText}
              onChange={(e) => setResultText(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm resize-y leading-relaxed"
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default function UniqueizePage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">Загрузка...</div>}>
      <UniqueizeContent />
    </Suspense>
  )
}
