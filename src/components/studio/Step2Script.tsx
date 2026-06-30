'use client'

import { useRef, useState } from 'react'
import { useStudioStore } from '@/lib/studio-store'
import { CREDIT_COSTS } from '@/lib/types'
import { SCRIPT_LANGUAGES } from '@/lib/languages'
import { refreshCredits } from '@/lib/refresh-credits'
import { useLang } from '@/hooks/useLang'

const MODEL_COSTS: Record<string, number> = {
  'claude-sonnet': CREDIT_COSTS.script_sonnet,
  'claude-opus': CREDIT_COSTS.script_opus,
  'gpt-4o': CREDIT_COSTS.script_gpt,
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

export default function Step2Script() {
  const { scriptParams, setScriptParams, projectId, planSections, script, setScript, setStep } = useStudioStore()
  const { t } = useLang()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [processingMode, setProcessingMode] = useState<'unique' | 'human' | 'both' | null>(null)
  const [bothStep, setBothStep] = useState<1 | 2 | null>(null)
  const [originalScript, setOriginalScript] = useState<string | null>(null)
  const [processSuccess, setProcessSuccess] = useState(false)
  const [outputLang, setOutputLang] = useState<string>(scriptParams.language ?? 'ru')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const MODEL_LABELS: Record<string, string> = {
    'claude-sonnet': t('model.standard'),
    'claude-opus':   t('model.enhanced'),
    'gpt-4o':        t('model.alternative'),
  }

  const model = scriptParams.model
  const creditCost = MODEL_COSTS[model] ?? 10

  async function handleGenerate() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/generate/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...scriptParams, project_id: projectId, plan_sections: planSections.length > 0 ? planSections : undefined }),
      })
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') {
          setError(t('step2.err_credits'))
          return
        }
        throw new Error(json.error)
      }
      setScript(json.data.script)
      void refreshCredits()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('step2.err_gen'))
    } finally {
      setLoading(false)
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError('')

    if (file.size > 5 * 1024 * 1024) {
      setUploadError(t('step2.err_file_big'))
      return
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      if (!text?.trim()) { setUploadError(t('step2.err_file_empty')); return }
      const trimmed = text.trim()
      setScript(trimmed)
      // Auto-fill topic from first 50 chars if topic is missing or placeholder
      const { topic } = useStudioStore.getState().scriptParams
      if (!topic.trim() || topic === 'Свой текст') {
        const autoTopic = trimmed.slice(0, 60).replace(/\s+/g, ' ').replace(/\n/g, ' ').trim()
        setScriptParams({ topic: autoTopic })
      }
    }
    reader.onerror = () => setUploadError(t('step2.err_file_read'))
    reader.readAsText(file, 'UTF-8')
    e.target.value = ''
  }

  async function handleProcess(mode: 'unique' | 'human' | 'both') {
    if (!script?.trim()) return
    setError('')
    setProcessingMode(mode)
    setProcessSuccess(false)
    try {
      let finalText: string
      if (mode === 'both') {
        // Step 1: uniqueize
        setBothStep(1)
        const res1 = await fetch('/api/generate/uniqueize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script, project_id: projectId, mode: 'unique', output_lang: outputLang }),
        })
        const json1 = await res1.json()
        if (!json1.ok) {
          if (json1.code === 'NO_CREDITS') { setError(t('step2.err_credits')); return }
          throw new Error(json1.error)
        }
        const uniqueized = json1.data.script

        // Step 2: humanize the uniqueized output (not the original text)
        setBothStep(2)
        const res2 = await fetch('/api/generate/uniqueize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script: uniqueized, project_id: projectId, mode: 'human', output_lang: outputLang }),
        })
        const json2 = await res2.json()
        if (!json2.ok) {
          if (json2.code === 'NO_CREDITS') { setError(t('step2.err_credits')); return }
          throw new Error(json2.error)
        }
        finalText = json2.data.script
      } else {
        const res = await fetch('/api/generate/uniqueize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ script, project_id: projectId, mode, output_lang: outputLang }),
        })
        const json = await res.json()
        if (!json.ok) {
          if (json.code === 'NO_CREDITS') { setError(t('step2.err_credits')); return }
          throw new Error(json.error)
        }
        finalText = json.data.script
      }
      setOriginalScript(script)
      setScript(finalText)
      setProcessSuccess(true)
      void refreshCredits()
      setTimeout(() => setProcessSuccess(false), 3000)
    } catch (err) {
      const errKey = mode === 'human' ? 'step2.err_humanize' : 'step2.err_uniqueize'
      setError(err instanceof Error ? err.message : t(errKey))
    } finally {
      setProcessingMode(null)
      setBothStep(null)
    }
  }

  function handleUndoProcess() {
    if (originalScript !== null) {
      setScript(originalScript)
      setOriginalScript(null)
      setProcessSuccess(false)
    }
  }

  function handlePasteMode() { setScript('') }

  const words = script ? countWords(script) : 0
  const estimatedMin = Math.round(words / 130)
  const hasScript = script !== null && script.trim().length > 0

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">{t('step2.title')}</h2>
        <p className="text-sm text-slate-500">
          {t('step2.topic_prefix')} <span className="font-medium text-slate-300">«{scriptParams.topic}»</span>
        </p>
      </div>

      {/* Selected model info */}
      <div
        className="flex items-center gap-3 rounded-xl px-4 py-3"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)' }}
        >
          <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-200">{MODEL_LABELS[model]}</p>
          <p className="text-xs text-slate-500">{scriptParams.duration_minutes} {t('step2.min_label')} · {scriptParams.language.toUpperCase()}</p>
        </div>
        <button
          type="button"
          onClick={() => setStep(1)}
          className="text-xs text-violet-400 hover:text-violet-300 font-medium shrink-0 transition-colors"
        >
          {t('step2.change_model')}
        </button>
      </div>

      {/* Generate button */}
      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading}
        className="w-full py-3 btn-gradient text-white font-semibold rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <SpinnerIcon className="w-4 h-4 animate-spin" />
            {t('step2.generating')}
          </>
        ) : hasScript ? (
          `↺ ${t('step2.regenerate')} (−${creditCost} ${t('step1.credits_suffix')})`
        ) : (
          `${t('step2.generate')} (−${creditCost} ${t('step1.credits_suffix')})`
        )}
      </button>

      {/* Text processing buttons — shown when script exists */}
      {hasScript && !loading && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">{t('tools.output_lang')}</label>
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
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleProcess('unique')}
              disabled={processingMode !== null}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-xl transition-all disabled:opacity-50"
              style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', color: processingMode === 'unique' ? '#6b7280' : '#60a5fa' }}
            >
              {processingMode === 'unique' ? (
                <><SpinnerIcon className="w-3.5 h-3.5 animate-spin" />{t('step2.uniqueizing')}</>
              ) : t('step2.uniqueize')}
            </button>
            <button
              type="button"
              onClick={() => handleProcess('human')}
              disabled={processingMode !== null}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-xl transition-all disabled:opacity-50"
              style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: processingMode === 'human' ? '#6b7280' : '#34d399' }}
            >
              {processingMode === 'human' ? (
                <><SpinnerIcon className="w-3.5 h-3.5 animate-spin" />{t('step2.humanizing')}</>
              ) : t('step2.humanize')}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleProcess('both')}
              disabled={processingMode !== null}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-xl transition-all disabled:opacity-50"
              style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)', color: processingMode === 'both' ? '#6b7280' : '#a78bfa' }}
            >
              {processingMode === 'both' ? (
                <><SpinnerIcon className="w-3.5 h-3.5 animate-spin" />{bothStep === 1 ? 'Шаг 1/2: уникализация...' : 'Шаг 2/2: очеловечивание...'}</>
              ) : t('step2.both_process')}
            </button>
            {originalScript !== null && (
              <button
                type="button"
                onClick={handleUndoProcess}
                className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded-xl transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}
              >
                {t('step2.original')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Process success notice */}
      {processSuccess && (
        <p className="text-xs font-medium rounded-xl px-3 py-2 text-center" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#34d399' }}>
          {t('step2.done_ok')}
        </p>
      )}

      {/* Secondary actions */}
      {!loading && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-slate-400 text-xs font-medium rounded-xl hover:text-slate-200 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {t('step2.upload_txt')}
          </button>
          {script === null && (
            <button
              type="button"
              onClick={handlePasteMode}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-slate-400 text-xs font-medium rounded-xl hover:text-slate-200 transition-colors"
              style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              {t('step2.paste')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setStep(4)}
            className="flex items-center gap-1 py-2 px-3 text-slate-500 text-xs font-medium rounded-xl hover:text-slate-300 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.07)' }}
          >
            {t('step2.skip')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      )}

      {uploadError && (
        <p className="text-xs text-red-400 rounded-xl px-3 py-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.15)' }}>
          {uploadError}
        </p>
      )}

      {error && (
        <p className="text-sm text-red-400 rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </p>
      )}

      {/* Script textarea */}
      {script !== null && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-slate-300">{t('step2.script_label')}</p>
            <span className="text-xs text-slate-500">
              {words} {t('step2.words')} · ~{estimatedMin} {t('step2.min_label')}
            </span>
          </div>
          <textarea
            rows={16}
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="..."
            className="w-full px-4 py-3 rounded-xl text-sm resize-none leading-relaxed"
          />
          <p className="text-xs text-slate-600 mt-1">{t('step2.edit_hint')}</p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(2)}
          className="px-5 py-3 btn-ghost-dark font-medium rounded-xl text-sm"
        >
          {t('step2.back')}
        </button>
        <button
          type="button"
          onClick={() => setStep(4)}
          disabled={!hasScript}
          className="flex-1 py-3 btn-gradient text-white font-semibold rounded-xl text-sm disabled:opacity-40"
        >
          {t('step2.next')}
        </button>
      </div>
    </div>
  )
}
