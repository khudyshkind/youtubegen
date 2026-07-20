'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useLang } from '@/hooks/useLang'
import { useStudioStore } from '@/lib/studio-store'
import { refreshCredits } from '@/lib/refresh-credits'
import { CREDIT_COSTS } from '@/lib/types'
import type { PlanSection } from '@/lib/types'
import ScriptSettingsForm, { DEFAULT_SCRIPT_SETTINGS } from '@/components/shared/ScriptSettingsForm'
import type { ScriptSettings } from '@/components/shared/ScriptSettingsForm'

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function ScriptGenContent() {
  const { t } = useLang()
  const router = useRouter()
  const searchParams = useSearchParams()
  const runId = searchParams.get('run')

  // Form state
  const [topic, setTopic] = useState('')
  const [settings, setSettings] = useState<ScriptSettings>(DEFAULT_SCRIPT_SETTINGS)
  const [withPlan, setWithPlan] = useState(false)

  // Plan phase
  const [planSections, setPlanSections] = useState<PlanSection[] | null>(null)

  // Result
  const [resultScript, setResultScript] = useState('')
  const [resultPlanSections, setResultPlanSections] = useState<PlanSection[] | null>(null)

  // Generation state
  const [generating, setGenerating] = useState<'plan' | 'script' | null>(null)

  // Save state
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // UI state
  const [error, setError] = useState('')
  const [lastAction, setLastAction] = useState<'plan' | 'script' | null>(null)
  const [copied, setCopied] = useState(false)
  const [usingStudio, setUsingStudio] = useState(false)

  const PLAN_MIN_DURATION = 5

  // Load ?run= from dashboard
  useEffect(() => {
    if (!runId) return
    fetch(`/api/projects/${runId}`)
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data?.script) {
          setResultScript(json.data.script)
          setTopic(json.data.topic ?? '')
          setSavedId(runId)
          if (json.data.plan_sections) {
            setResultPlanSections(json.data.plan_sections as PlanSection[])
          }
        }
      })
      .catch(() => {})
  }, [runId])

  // Auto-enable plan when duration crosses threshold
  useEffect(() => {
    if (settings.duration_minutes >= PLAN_MIN_DURATION && !withPlan) {
      setWithPlan(true)
    }
  }, [settings.duration_minutes]) // eslint-disable-line react-hooks/exhaustive-deps

  function scriptCost() {
    if (settings.model === 'claude-opus') return CREDIT_COSTS.script_opus
    if (settings.model === 'gpt-4o') return CREDIT_COSTS.script_gpt
    return CREDIT_COSTS.script_sonnet
  }

  const isGenerating = generating !== null
  const hasPlan = planSections !== null && planSections.length > 0

  // Phase A: generate plan only
  async function handleGeneratePlan() {
    if (!topic.trim()) { setError(t('tools.err_empty')); return }
    setError('')
    setLastAction('plan')
    setPlanSections(null)
    setResultScript('')
    setSavedId(null)
    setSaveError('')
    setGenerating('plan')

    try {
      const res = await fetch('/api/generate/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          duration_minutes: settings.duration_minutes,
          language: settings.language,
          narrative_style: settings.narrative_style,
          tone: settings.tone,
        }),
      })
      const json: { ok: boolean; data?: { sections: PlanSection[] }; error?: string; code?: string } = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') { setError(t('tools.err_credits')); return }
        throw new Error(json.error ?? t('tools.err_gen'))
      }
      setPlanSections(json.data!.sections)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tools.err_gen'))
    } finally {
      setGenerating(null)
    }
  }

  // Phase B or direct: generate script (with or without plan)
  async function handleGenerateScript() {
    if (!topic.trim()) { setError(t('tools.err_empty')); return }
    setError('')
    setLastAction('script')
    setResultScript('')
    setSavedId(null)
    setSaveError('')
    setGenerating('script')

    const usedPlanSections = hasPlan ? planSections : undefined

    try {
      const res = await fetch('/api/generate/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          duration_minutes: settings.duration_minutes,
          language: settings.language,
          model: settings.model,
          narrative_style: settings.narrative_style,
          tone: settings.tone,
          target_audience: settings.target_audience,
          hook: settings.hook,
          hook_type: settings.hook_type,
          cta: settings.cta,
          scene_markers: settings.scene_markers,
          pauses: settings.pauses,
          plan_sections: usedPlanSections,
        }),
      })
      if (res.status === 504 || res.status === 524) throw new Error(t('tools.err_timeout'))
      const json: { ok: boolean; data?: { script: string }; error?: string; code?: string } = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') { setError(t('tools.err_credits')); return }
        throw new Error(json.error ?? t('tools.err_gen'))
      }

      const script = json.data!.script
      setResultScript(script)
      setResultPlanSections(usedPlanSections ?? null)
      void refreshCredits()
      await saveRun(topic, script, scriptCost() + (hasPlan ? CREDIT_COSTS.plan : 0), settings.language, usedPlanSections ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tools.err_gen'))
    } finally {
      setGenerating(null)
    }
  }

  async function saveRun(inputTopic: string, script: string, credits: number, lang: string, sections: PlanSection[] | null) {
    setSaving(true)
    setSaveError('')
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
      const json: { ok: boolean; data?: { project_id: string }; error?: string } = await res.json()
      if (!json.ok) {
        setSaveError(t('tools.save_fail'))
      } else {
        setSavedId(json.data!.project_id)
      }
    } catch {
      setSaveError(t('tools.save_fail'))
    } finally {
      setSaving(false)
    }
  }

  async function handleUseInStudio() {
    if (!resultScript.trim()) return
    setUsingStudio(true)
    try {
      const res = await fetch('/api/projects/from-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic || t('tools.card_script'),
          duration_minutes: settings.duration_minutes,
          language: settings.language,
          script: resultScript,
          plan_sections: resultPlanSections ?? undefined,
          credits_spent: scriptCost() + (resultPlanSections ? CREDIT_COSTS.plan : 0),
        }),
      })
      const json: { ok: boolean; data?: { project: { id: string } }; error?: string } = await res.json()
      if (!json.ok) throw new Error(json.error)
      const projectId = json.data!.project.id

      // Pre-populate studio store so ?from=tools path picks it up without resetting
      const store = useStudioStore.getState()
      store.reset()
      store.setProjectId(projectId)
      store.setScriptParams({
        topic: topic || t('tools.card_script'),
        duration_minutes: settings.duration_minutes,
        language: settings.language,
        model: settings.model,
        narrative_style: settings.narrative_style,
        tone: settings.tone,
        target_audience: settings.target_audience,
        hook: settings.hook,
        hook_type: settings.hook_type,
        cta: settings.cta,
        scene_markers: settings.scene_markers,
        pauses: settings.pauses,
      })
      if (resultPlanSections) store.setPlanSections(resultPlanSections)
      store.setScript(resultScript)
      store.setStep(3)

      router.push(`/studio?from=tools`)
    } catch {
      setError('Ошибка открытия студии — попробуй ещё раз')
      setUsingStudio(false)
    }
  }

  async function handleCopy() {
    if (!resultScript) return
    await navigator.clipboard.writeText(resultScript)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/tools" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">{t('tools.back_to_tools')}</Link>
        <h1 className="text-2xl font-bold text-slate-100 mt-2">{t('tools.script_title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.script_subtitle')}</p>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6 lg:items-start">
        {/* Left: form */}
        <div className="rounded-2xl p-6 flex flex-col gap-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
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

          {/* Full settings from shared component */}
          <ScriptSettingsForm value={settings} onChange={patch => setSettings(s => ({ ...s, ...patch }))} />

          {/* Plan toggle */}
          <div
            className="flex items-start gap-3 rounded-xl px-4 py-3 cursor-pointer"
            style={{ background: withPlan ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${withPlan ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.08)'}` }}
            onClick={() => { setWithPlan(!withPlan); if (withPlan) setPlanSections(null) }}
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

          {/* Action buttons */}
          {withPlan && !hasPlan ? (
            // Phase A: generate plan
            <button
              type="button"
              onClick={handleGeneratePlan}
              disabled={isGenerating}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-xl btn-gradient text-white transition-all disabled:opacity-60"
            >
              {generating === 'plan' ? (
                <><SpinnerIcon className="w-4 h-4 animate-spin" />{t('tools.script_generating_plan')}</>
              ) : (
                <>{t('tools.script_gen_plan_btn')} · −{CREDIT_COSTS.plan} {t('nav.credits_suffix')}</>
              )}
            </button>
          ) : hasPlan ? (
            // Phase B: generate script from plan
            <button
              type="button"
              onClick={handleGenerateScript}
              disabled={isGenerating}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-xl btn-gradient text-white transition-all disabled:opacity-60"
            >
              {generating === 'script' ? (
                <><SpinnerIcon className="w-4 h-4 animate-spin" />{t('tools.script_generating')}</>
              ) : (
                <>{t('tools.script_gen_from_plan_btn')} · −{scriptCost()} {t('nav.credits_suffix')}</>
              )}
            </button>
          ) : (
            // Direct: generate script without plan
            <button
              type="button"
              onClick={handleGenerateScript}
              disabled={isGenerating}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-xl btn-gradient text-white transition-all disabled:opacity-60"
            >
              {generating === 'script' ? (
                <><SpinnerIcon className="w-4 h-4 animate-spin" />{t('tools.script_generating')}</>
              ) : (
                <>{t('tools.script_gen_btn')} · −{scriptCost()} {t('nav.credits_suffix')}</>
              )}
            </button>
          )}

          {error && (
            <div className="rounded-xl px-4 py-3 flex items-center justify-between gap-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="text-sm text-red-400">{error}</p>
              {lastAction && (
                <button
                  type="button"
                  onClick={() => lastAction === 'plan' ? handleGeneratePlan() : handleGenerateScript()}
                  className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                  style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171' }}
                >
                  {t('tools.retry')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right: plan + result */}
        <div className="flex flex-col gap-4 mt-4 lg:mt-0">
          {/* Editable plan (Phase B) */}
          {hasPlan && !resultScript && (
            <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-300">{t('tools.script_plan_label')}</p>
                <p className="text-xs text-slate-500">{t('tools.script_plan_edit_hint')}</p>
              </div>
              {planSections!.map((section, i) => (
                <div key={i} className="rounded-xl p-3 flex flex-col gap-2" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-violet-400 shrink-0">{i + 1}</span>
                    <input
                      value={section.title}
                      onChange={e => {
                        const updated = planSections!.map((s, j) => j === i ? { ...s, title: e.target.value } : s)
                        setPlanSections(updated)
                      }}
                      className="flex-1 px-2 py-1 rounded-lg text-xs font-semibold text-slate-200 bg-transparent outline-none"
                      style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                    />
                  </div>
                  <textarea
                    rows={2}
                    value={section.description}
                    onChange={e => {
                      const updated = planSections!.map((s, j) => j === i ? { ...s, description: e.target.value } : s)
                      setPlanSections(updated)
                    }}
                    className="w-full px-2 py-1 rounded-lg text-xs text-slate-400 bg-transparent resize-none outline-none"
                    style={{ border: '1px solid rgba(255,255,255,0.07)' }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Script result */}
          {resultScript && (
            <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">
                  {t('tools.script_result_label')}
                  {saving && <span className="ml-2 text-slate-600">{t('tools.saving')}</span>}
                  {savedId && !saving && <span className="ml-2 text-green-500">{t('tools.saved')}</span>}
                  {saveError && !saving && <span className="ml-2 text-red-400">{saveError}</span>}
                </span>
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
                    disabled={usingStudio}
                    className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-all disabled:opacity-60"
                    style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)', color: '#a78bfa' }}
                  >
                    {usingStudio ? t('tools.use_studio_creating') : t('tools.use_studio')}
                  </button>
                </div>
              </div>
              <textarea
                rows={20}
                value={resultScript}
                onChange={(e) => setResultScript(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm resize-y leading-relaxed"
              />
            </div>
          )}
        </div>
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
