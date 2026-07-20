'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
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

const NARRATIVE_STYLES = [
  { value: 'storytelling',   labelRu: 'Сторителлинг',      labelEn: 'Storytelling' },
  { value: 'science',        labelRu: 'Научпоп',            labelEn: 'Science pop' },
  { value: 'documentary',    labelRu: 'Документальный',     labelEn: 'Documentary' },
  { value: 'conversational', labelRu: 'Разговорный',        labelEn: 'Conversational' },
  { value: 'children',       labelRu: 'Детский',            labelEn: 'For children' },
]

const TONES = [
  { value: 'neutral',    labelRu: 'Нейтральный',    labelEn: 'Neutral' },
  { value: 'emotional',  labelRu: 'Эмоциональный',  labelEn: 'Emotional' },
  { value: 'humorous',   labelRu: 'Юмористический', labelEn: 'Humorous' },
  { value: 'dramatic',   labelRu: 'Драматический',  labelEn: 'Dramatic' },
  { value: 'inspiring',  labelRu: 'Вдохновляющий',  labelEn: 'Inspiring' },
]

const PLAN_MIN_DURATION = 5

function ScriptGenContent() {
  const { t, lang } = useLang()
  const searchParams = useSearchParams()
  const runId = searchParams.get('run')

  const [topic, setTopic] = useState('')
  const [duration, setDuration] = useState(5)
  const [language, setLanguage] = useState('ru')
  const [narrativeStyle, setNarrativeStyle] = useState('storytelling')
  const [tone, setTone] = useState('neutral')
  const [withPlan, setWithPlan] = useState(false)
  const [resultScript, setResultScript] = useState('')
  const [generating, setGenerating] = useState<'plan' | 'script' | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Load existing run from dashboard
  useEffect(() => {
    if (!runId) return
    fetch(`/api/projects/${runId}`)
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data?.script) {
          setResultScript(json.data.script)
          setTopic(json.data.topic ?? '')
          setSavedId(runId)
        }
      })
      .catch(() => {})
  }, [runId])

  // Auto-enable plan when duration crosses threshold
  useEffect(() => {
    if (duration >= PLAN_MIN_DURATION && !withPlan) setWithPlan(true)
  }, [duration]) // eslint-disable-line react-hooks/exhaustive-deps

  const planCost = withPlan ? CREDIT_COSTS.plan : 0
  const scriptCost = CREDIT_COSTS.script_sonnet
  const totalCost = planCost + scriptCost

  async function handleGenerate() {
    if (!topic.trim()) { setError(t('tools.err_empty')); return }
    setError('')
    setResultScript('')
    setSavedId(null)

    const commonParams = { topic, duration_minutes: duration, language, narrative_style: narrativeStyle, tone }

    try {
      let planSections = undefined

      if (withPlan) {
        setGenerating('plan')
        const planRes = await fetch('/api/generate/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(commonParams),
        })
        const planJson: { ok: boolean; data?: { sections: unknown[] }; error?: string; code?: string } = await planRes.json()
        if (!planJson.ok) {
          if (planJson.code === 'NO_CREDITS') { setError(t('tools.err_credits')); return }
          throw new Error(planJson.error ?? t('tools.err_gen'))
        }
        planSections = planJson.data!.sections
      }

      setGenerating('script')
      const scriptRes = await fetch('/api/generate/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...commonParams,
          model: 'claude-sonnet',
          target_audience: 'wide',
          hook: true,
          hook_type: 'question',
          cta: true,
          scene_markers: false,
          pauses: false,
          plan_sections: planSections,
        }),
      })
      if (scriptRes.status === 504 || scriptRes.status === 524) throw new Error(t('tools.err_timeout'))
      const scriptJson: { ok: boolean; data?: { script: string }; error?: string; code?: string } = await scriptRes.json()
      if (!scriptJson.ok) {
        if (scriptJson.code === 'NO_CREDITS') { setError(t('tools.err_credits')); return }
        throw new Error(scriptJson.error ?? t('tools.err_gen'))
      }

      const script = scriptJson.data!.script
      setResultScript(script)
      void refreshCredits()

      // Background save to history
      void saveRun(topic, script, scriptCost + planCost, language)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tools.err_gen'))
    } finally {
      setGenerating(null)
    }
  }

  async function saveRun(inputTopic: string, script: string, credits: number, lang: string) {
    setSaving(true)
    try {
      const res = await fetch('/api/tools/save-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_type: 'script-gen',
          title: t('tools.card_script'),
          input_text: inputTopic,
          result_text: script,
          credits_spent: credits,
          language: lang,
        }),
      })
      const json: { ok: boolean; data?: { project_id: string } } = await res.json()
      if (json.ok) setSavedId(json.data!.project_id)
    } finally {
      setSaving(false)
    }
  }

  async function handleCopy() {
    if (!resultScript) return
    await navigator.clipboard.writeText(resultScript)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleUseInStudio() {
    if (!resultScript.trim()) return
    useStudioStore.getState().setScript(resultScript)
    useStudioStore.getState().setStep(2)
    window.location.href = '/studio?from=tools'
  }

  const isGenerating = generating !== null

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/tools" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">{t('tools.back_to_tools')}</Link>
        <h1 className="text-2xl font-bold text-slate-100 mt-2">{t('tools.script_title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.script_subtitle')}</p>
      </div>

      <div
        className="rounded-2xl p-6 flex flex-col gap-5"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* Topic */}
        <div>
          <label className="text-xs font-medium text-slate-400 block mb-1.5">{t('tools.script_topic_label')}</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={t('tools.script_topic_ph')}
            className="w-full px-4 py-3 rounded-xl text-sm"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', outline: 'none' }}
          />
        </div>

        {/* Params row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1.5">{t('tools.script_duration')}</label>
            <input
              type="number"
              min={1}
              max={60}
              value={duration}
              onChange={(e) => setDuration(Math.max(1, Math.min(60, Number(e.target.value))))}
              className="w-full px-3 py-2 rounded-lg text-sm text-slate-300"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', outline: 'none' }}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1.5">{t('tools.output_lang')}</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {SCRIPT_LANGUAGES.map(l => (
                <option key={l.code} value={l.code} className="bg-slate-900">{l.flag} {l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1.5">{lang === 'en' ? 'Style' : 'Стиль'}</label>
            <select
              value={narrativeStyle}
              onChange={(e) => setNarrativeStyle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {NARRATIVE_STYLES.map(s => (
                <option key={s.value} value={s.value} className="bg-slate-900">
                  {lang === 'en' ? s.labelEn : s.labelRu}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1.5">{lang === 'en' ? 'Tone' : 'Тон'}</label>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              {TONES.map(t => (
                <option key={t.value} value={t.value} className="bg-slate-900">
                  {lang === 'en' ? t.labelEn : t.labelRu}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Plan checkbox */}
        <div
          className="flex items-start gap-3 rounded-xl px-4 py-3 cursor-pointer"
          style={{ background: withPlan ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${withPlan ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.08)'}` }}
          onClick={() => setWithPlan(!withPlan)}
        >
          <div
            className="w-4 h-4 rounded flex items-center justify-center shrink-0 mt-0.5 transition-all"
            style={{ background: withPlan ? '#7c3aed' : 'rgba(255,255,255,0.06)', border: withPlan ? 'none' : '1px solid rgba(255,255,255,0.2)' }}
          >
            {withPlan && (
              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-slate-300">{t('tools.script_with_plan')}</p>
            <p className="text-xs text-slate-500 mt-0.5">{t('tools.script_plan_hint')}</p>
          </div>
        </div>

        {/* Generate button */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-xl btn-gradient text-white transition-all disabled:opacity-60"
        >
          {isGenerating ? (
            <>
              <SpinnerIcon className="w-4 h-4 animate-spin" />
              {generating === 'plan' ? t('tools.script_generating_plan') : t('tools.script_generating')}
            </>
          ) : (
            <>
              {withPlan ? t('tools.script_gen_btn_plan') : t('tools.script_gen_btn')}
              {' · −'}{totalCost} {t('nav.credits_suffix')}
            </>
          )}
        </button>

        {error && (
          <p className="text-sm text-red-400 rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </p>
        )}

        {/* Result */}
        {resultScript && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-400">
                {t('tools.script_result_label')}
                {saving && <span className="ml-2 text-slate-600">{t('tools.saving')}</span>}
                {savedId && !saving && <span className="ml-2 text-green-500">{t('tools.saved')}</span>}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
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
              rows={16}
              value={resultScript}
              onChange={(e) => setResultScript(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm resize-y leading-relaxed"
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default function ScriptGenPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">Загрузка...</div>}>
      <ScriptGenContent />
    </Suspense>
  )
}
