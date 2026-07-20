'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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

const TOOL_CARDS = [
  {
    slug: 'script-gen',
    emoji: '📝',
    titleKey: 'tools.card_script' as const,
    descKey: 'tools.card_script_desc' as const,
    accent: { bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.2)', hover: 'rgba(124,58,237,0.35)', color: '#a78bfa' },
  },
  {
    slug: 'seo',
    emoji: '🎯',
    titleKey: 'tools.card_seo' as const,
    descKey: 'tools.card_seo_desc' as const,
    accent: { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)', hover: 'rgba(59,130,246,0.35)', color: '#60a5fa' },
  },
  {
    slug: 'repack',
    emoji: '🔁',
    titleKey: 'tools.card_repack' as const,
    descKey: 'tools.card_repack_desc' as const,
    accent: { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)', hover: 'rgba(16,185,129,0.35)', color: '#34d399' },
  },
]

export default function ToolsPage() {
  const { t, lang } = useLang()
  const router = useRouter()

  const [inputText, setInputText] = useState('')
  const [outputLang, setOutputLang] = useState('ru')
  const [resultText, setResultText] = useState('')
  const [processingMode, setProcessingMode] = useState<'unique' | 'human' | 'both' | null>(null)
  const [bothStep, setBothStep] = useState<1 | 2 | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setOutputLang(lang === 'en' ? 'en' : 'ru')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const charCount = inputText.length

  async function handleProcess(mode: 'unique' | 'human' | 'both') {
    if (!inputText.trim()) { setError(t('tools.err_empty')); return }
    setError('')
    setSuccess(false)
    setProcessingMode(mode)
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
        setResultText(json2.data!.script)
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
        setResultText(json.data!.script)
      }
      setSuccess(true)
      void refreshCredits()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tools.err_gen'))
    } finally {
      setProcessingMode(null)
      setBothStep(null)
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

  const creditCost = (mode: 'unique' | 'human' | 'both') =>
    mode === 'both'  ? CREDIT_COSTS.uniqueize + CREDIT_COSTS.humanize :
    mode === 'human' ? CREDIT_COSTS.humanize :
    CREDIT_COSTS.uniqueize

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">{t('tools.title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.hub_subtitle')}</p>
      </div>

      {/* New tool cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        {TOOL_CARDS.map((card) => (
          <Link
            key={card.slug}
            href={`/tools/${card.slug}`}
            className="flex flex-col gap-2 p-5 rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: card.accent.bg, border: `1px solid ${card.accent.border}` }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = card.accent.hover)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = card.accent.border)}
          >
            <span className="text-2xl">{card.emoji}</span>
            <span className="text-sm font-semibold" style={{ color: card.accent.color }}>{t(card.titleKey)}</span>
            <span className="text-xs text-slate-500">{t(card.descKey)}</span>
          </Link>
        ))}
      </div>

      {/* Uniqueizer — inline as before */}
      <div
        className="rounded-2xl p-6 flex flex-col gap-5"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div>
          <h2 className="text-base font-semibold text-slate-100">{t('tools.uniqueizer')}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{t('tools.card_uniqueizer_desc')}</p>
        </div>

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

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <button
                type="button"
                onClick={() => handleProcess('unique')}
                disabled={processingMode !== null}
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
                disabled={processingMode !== null}
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
              disabled={processingMode !== null}
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
          <p className="text-sm text-red-400 rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </p>
        )}

        {success && (
          <p className="text-xs font-medium rounded-xl px-3 py-2 text-center" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#34d399' }}>
            {t('tools.done_ok')}
          </p>
        )}

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
