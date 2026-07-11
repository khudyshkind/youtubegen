'use client'

import { useState } from 'react'
import { useStudioStore } from '@/lib/studio-store'
import type { PlanSection } from '@/lib/types'
import { refreshCredits } from '@/lib/refresh-credits'
import { useLang } from '@/hooks/useLang'

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

export default function Step2Plan() {
  const { scriptParams, projectId, planSections, setPlanSections, setStep, ownScript } = useStudioStore()
  const { t } = useLang()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleGenerate() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/generate/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: scriptParams.topic,
          duration_minutes: scriptParams.duration_minutes,
          language: scriptParams.language,
          narrative_style: scriptParams.narrative_style,
          tone: scriptParams.tone,
          project_id: projectId,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        if (json.code === 'NO_CREDITS') { setError(t('plan.err_credits')); return }
        throw new Error(json.error)
      }
      setPlanSections(json.data.sections as PlanSection[])
      void refreshCredits()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plan.err_gen'))
    } finally {
      setLoading(false)
    }
  }

  function handleMoveUp(idx: number) {
    if (idx === 0) return
    const s = [...planSections]
    ;[s[idx - 1], s[idx]] = [s[idx], s[idx - 1]]
    setPlanSections(s)
  }

  function handleMoveDown(idx: number) {
    if (idx === planSections.length - 1) return
    const s = [...planSections]
    ;[s[idx], s[idx + 1]] = [s[idx + 1], s[idx]]
    setPlanSections(s)
  }

  function handleDelete(idx: number) {
    setPlanSections(planSections.filter((_, i) => i !== idx))
  }

  function handleAddSection() {
    setPlanSections([
      ...planSections,
      { title: t('plan.new_section_title'), description: t('plan.new_section_desc') },
    ])
  }

  function handleUpdateTitle(idx: number, title: string) {
    const s = [...planSections]
    s[idx] = { ...s[idx], title }
    setPlanSections(s)
  }

  function handleUpdateDesc(idx: number, description: string) {
    const s = [...planSections]
    s[idx] = { ...s[idx], description }
    setPlanSections(s)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">{t('plan.title')}</h2>
        {scriptParams.topic && (
          <p className="text-sm text-slate-500">
            {t('step2.topic_prefix')} <span className="font-medium text-slate-300">«{scriptParams.topic}»</span>
          </p>
        )}
      </div>

      {ownScript ? (
        <div
          className="flex items-start gap-2 rounded-xl px-4 py-3"
          style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.18)' }}
        >
          <svg className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-slate-400">{t('plan.hint_own')}</p>
        </div>
      ) : (
        <>
          {/* Info hint */}
          <div
            className="flex items-start gap-2 rounded-xl px-4 py-3"
            style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.18)' }}
          >
            <svg className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-slate-400">{t('plan.hint')}</p>
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || !scriptParams.topic.trim()}
            className="w-full py-3 btn-gradient text-white font-semibold rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <SpinnerIcon className="w-4 h-4 animate-spin" />
                {t('plan.generating')}
              </>
            ) : planSections.length > 0 ? (
              t('plan.regenerate_btn')
            ) : (
              t('plan.generate_btn')
            )}
          </button>
        </>
      )}

      {/* Section cards */}
      {planSections.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            {planSections.length} {t('plan.sections_count')}
          </p>

          {planSections.map((section, idx) => (
            <div
              key={idx}
              className="rounded-xl p-4"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {/* Card header row */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex flex-col gap-px shrink-0">
                  <button
                    type="button"
                    onClick={() => handleMoveUp(idx)}
                    disabled={idx === 0}
                    className="text-slate-600 hover:text-slate-300 disabled:opacity-20 text-xs leading-none transition-colors px-0.5"
                    title={t('plan.move_up')}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveDown(idx)}
                    disabled={idx === planSections.length - 1}
                    className="text-slate-600 hover:text-slate-300 disabled:opacity-20 text-xs leading-none transition-colors px-0.5"
                    title={t('plan.move_down')}
                  >
                    ▼
                  </button>
                </div>
                <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">
                  {t('plan.section_n')} {idx + 1}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(idx)}
                  className="ml-auto text-slate-600 hover:text-red-400 transition-colors text-sm leading-none w-5 h-5 flex items-center justify-center rounded"
                  title={t('plan.delete_section')}
                >
                  ✕
                </button>
              </div>

              {/* Title */}
              <input
                type="text"
                value={section.title}
                onChange={(e) => handleUpdateTitle(idx, e.target.value)}
                placeholder={t('plan.section_title_ph')}
                className="w-full px-3 py-2 rounded-lg text-sm mb-2 font-medium"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#F8FAFC', outline: 'none' }}
              />

              {/* Description */}
              <textarea
                rows={2}
                value={section.description}
                onChange={(e) => handleUpdateDesc(idx, e.target.value)}
                placeholder={t('plan.section_desc_ph')}
                className="w-full px-3 py-2 rounded-lg text-sm resize-none"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: '#CBD5E1', outline: 'none' }}
              />
            </div>
          ))}

          {/* Add section */}
          <button
            type="button"
            onClick={handleAddSection}
            className="w-full py-2.5 text-sm font-medium text-slate-500 hover:text-slate-300 rounded-xl transition-colors"
            style={{ border: '1px dashed rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.01)' }}
          >
            {t('plan.add_section')}
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 rounded-xl px-4 py-3"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </p>
      )}

      {/* Navigation */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(1)}
          className="px-5 py-3 btn-ghost-dark font-medium rounded-xl text-sm"
        >
          {t('plan.back')}
        </button>
        <button
          type="button"
          onClick={() => setStep(3)}
          className="flex-1 py-3 btn-gradient text-white font-semibold rounded-xl text-sm"
        >
          {t('plan.next')}
        </button>
      </div>

      {/* Skip — only shown when no plan generated yet (own-text already has its own skip button above) */}
      {!ownScript && planSections.length === 0 && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => { if (window.confirm(t('plan.skip_confirm'))) setStep(3) }}
            className="text-sm text-slate-600 hover:text-slate-400 transition-colors"
          >
            {t('plan.skip')}
          </button>
        </div>
      )}
    </div>
  )
}
