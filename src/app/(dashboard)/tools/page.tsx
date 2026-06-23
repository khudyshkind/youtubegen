'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useLang } from '@/hooks/useLang'
import { useStudioStore } from '@/lib/studio-store'
import { refreshCredits } from '@/lib/refresh-credits'

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

export default function ToolsPage() {
  const { t, lang } = useLang()
  const router = useRouter()
  const { setScript, setStep } = useStudioStore()

  const [inputText, setInputText] = useState('')
  const [outputLang, setOutputLang] = useState('ru')
  const [resultText, setResultText] = useState('')
  const [processingMode, setProcessingMode] = useState<'unique' | 'human' | 'both' | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [copied, setCopied] = useState(false)

  // Sync outputLang to UI language on first mount (after Zustand persist hydrates)
  useEffect(() => {
    setOutputLang(lang === 'en' ? 'en' : 'ru')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const charCount = inputText.length

  const OUTPUT_LANGS = [
    { value: 'ru',   label: 'Русский' },
    { value: 'en',   label: 'English' },
    { value: 'de',   label: 'Deutsch' },
    { value: 'fr',   label: 'Français' },
    { value: 'es',   label: 'Español' },
    { value: 'it',   label: 'Italiano' },
    { value: 'pt',   label: 'Português' },
    { value: 'zh',   label: '中文' },
    { value: 'ja',   label: '日本語' },
    { value: 'ko',   label: '한국어' },
    { value: 'ar',   label: 'العربية' },
    { value: 'tr',   label: 'Türkçe' },
  ]

  async function handleProcess(mode: 'unique' | 'human' | 'both') {
    if (!inputText.trim()) {
      setError(t('tools.err_empty'))
      return
    }
    setError('')
    setSuccess(false)
    setProcessingMode(mode)
    try {
      const res = await fetch('/api/generate/uniqueize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: inputText, mode, output_lang: outputLang }),
      })
      if (res.status === 504 || res.status === 524) {
        throw new Error(t('tools.err_timeout'))
      }
      let json: { ok: boolean; data?: { script: string }; error?: string; code?: string }
      try {
        json = await res.json()
      } catch {
        throw new Error(t('tools.err_gen'))
      }
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') {
          setError(t('tools.err_credits'))
          return
        }
        throw new Error(json.error ?? t('tools.err_gen'))
      }
      setResultText(json.data!.script)
      setSuccess(true)
      void refreshCredits()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tools.err_gen'))
    } finally {
      setProcessingMode(null)
    }
  }

  async function handleCopyResult() {
    if (!resultText) return
    await navigator.clipboard.writeText(resultText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleUseInStudio() {
    if (!resultText.trim()) return
    useStudioStore.getState().setScript(resultText)
    useStudioStore.getState().setStep(2)
    router.push('/studio?from=tools')
  }

  const creditCost = (mode: 'unique' | 'human' | 'both') => mode === 'both' ? t('tools.cr2') : t('tools.cr1')

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">{t('tools.title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.subtitle')}</p>
      </div>

      {/* Card */}
      <div
        className="rounded-2xl p-6 flex flex-col gap-5"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* Card header */}
        <div>
          <h2 className="text-base font-semibold text-slate-100">{t('tools.uniqueizer')}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{t('tools.uniqueizer_desc')}</p>
        </div>

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
            {OUTPUT_LANGS.map(l => (
              <option key={l.value} value={l.value} className="bg-slate-900">{l.label}</option>
            ))}
          </select>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleProcess('unique')}
              disabled={processingMode !== null}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold rounded-xl transition-all disabled:opacity-50"
              style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', color: processingMode === 'unique' ? '#6b7280' : '#60a5fa' }}
            >
              {processingMode === 'unique' ? (
                <><SpinnerIcon className="w-4 h-4 animate-spin" /> {t('tools.processing')}</>
              ) : (
                <>{t('tools.unique_btn')} · −{creditCost('unique')}</>
              )}
            </button>
            <button
              type="button"
              onClick={() => handleProcess('human')}
              disabled={processingMode !== null}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold rounded-xl transition-all disabled:opacity-50"
              style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: processingMode === 'human' ? '#6b7280' : '#34d399' }}
            >
              {processingMode === 'human' ? (
                <><SpinnerIcon className="w-4 h-4 animate-spin" /> {t('tools.processing')}</>
              ) : (
                <>{t('tools.human_btn')} · −{creditCost('human')}</>
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={() => handleProcess('both')}
            disabled={processingMode !== null}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold rounded-xl transition-all disabled:opacity-50"
            style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)', color: processingMode === 'both' ? '#6b7280' : '#a78bfa' }}
          >
            {processingMode === 'both' ? (
              <><SpinnerIcon className="w-4 h-4 animate-spin" /> {t('tools.processing')}</>
            ) : (
              <>{t('tools.both_btn')} · −{creditCost('both')}</>
            )}
          </button>

          {/* Cost info */}
          {charCount > 0 && (
            <p className="text-xs text-slate-600 text-right">
              {charCount} {t('tools.cost_info')} <span className="text-slate-400">{t('tools.cr1')} / {t('tools.cr1')} / {t('tools.cr2')}</span>
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-400 rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </p>
        )}

        {/* Success notice */}
        {success && (
          <p className="text-xs font-medium rounded-xl px-3 py-2 text-center" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#34d399' }}>
            {t('tools.done_ok')}
          </p>
        )}

        {/* Result */}
        {resultText && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-400">{t('tools.result_label')}</label>
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
                  className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-all"
                  style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)', color: '#a78bfa' }}
                >
                  {t('tools.use_studio')}
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
