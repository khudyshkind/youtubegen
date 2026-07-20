'use client'

import { type FormEvent, useRef, useState, useEffect } from 'react'
import { useStudioStore } from '@/lib/studio-store'
import { useLang } from '@/hooks/useLang'
import ScriptSettingsForm, { LanguageSelect } from '@/components/shared/ScriptSettingsForm'
import type { ScriptLanguage } from '@/lib/types'

interface Step1TopicProps {
  onRegisterSubmit?: (fn: () => void) => void
}

export default function Step1Topic({ onRegisterSubmit }: Step1TopicProps) {
  const { scriptParams, setScriptParams, setStep, setProjectId, projectId, ownScript, setOwnScript: setStoreOwnScript } = useStudioStore()
  const { t } = useLang()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const submitCoreRef = useRef<() => void>(() => {})

  useEffect(() => {
    onRegisterSubmit?.(() => { void submitCoreRef.current() })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmitCore() {
    if (!ownScript && !scriptParams.topic.trim()) { setError(t('step1.err_topic')); return }
    setStoreOwnScript(ownScript)
    if (projectId) { setStep(2); return }
    setError('')
    setLoading(true)
    // SENTINEL 'Свой текст': НЕ локализовать и НЕ менять — по нему loadProject инферит ownScript.
    const topic = scriptParams.topic.trim() || 'Свой текст'
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, duration_minutes: scriptParams.duration_minutes }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? t('step1.err_create'))
      setProjectId(json.data.project.id)
      if (!scriptParams.topic.trim()) setScriptParams({ topic })
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('step1.err_general'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    await handleSubmitCore()
  }

  const canSubmit = ownScript || !!scriptParams.topic.trim()
  submitCoreRef.current = handleSubmitCore

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">{t('step1.title')}</h2>
        <p className="text-sm text-slate-500">{t('step1.subtitle')}</p>
      </div>

      {/* Own script toggle */}
      <div
        className="flex items-center justify-between rounded-xl px-4 py-3"
        style={ownScript
          ? { background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)' }
          : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }
        }
      >
        <div>
          <p className="text-sm font-medium text-slate-300">{t('step1.own_script')}</p>
          <p className="text-xs text-slate-500 mt-0.5">{ownScript ? t('step1.own_script_on') : t('step1.own_script_off')}</p>
        </div>
        <button
          type="button"
          onClick={() => { setStoreOwnScript(!ownScript); if (ownScript) setScriptParams({ topic: '' }) }}
          className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0"
          style={{ background: ownScript ? '#7C3AED' : 'rgba(255,255,255,0.1)' }}
        >
          <span className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform" style={{ transform: ownScript ? 'translateX(24px)' : 'translateX(4px)' }} />
        </button>
      </div>

      {/* Topic input (hidden in ownScript mode) */}
      {!ownScript && (
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1.5">
            {t('step1.topic_label')} <span className="text-violet-400">*</span>
          </label>
          <textarea
            rows={3}
            value={scriptParams.topic}
            onChange={e => setScriptParams({ topic: e.target.value })}
            placeholder={t('step1.topic_placeholder')}
            className="w-full px-4 py-3 rounded-xl text-sm resize-none"
          />
        </div>
      )}

      {/* In ownScript mode: show only language selector; otherwise show full settings */}
      {ownScript ? (
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1.5">{t('step1.language')}</label>
          <LanguageSelect
            value={scriptParams.language}
            onChange={v => setScriptParams({ language: v as ScriptLanguage })}
          />
        </div>
      ) : (
        <ScriptSettingsForm
          value={scriptParams}
          onChange={patch => setScriptParams(patch)}
        />
      )}

      {error && (
        <p className="text-sm text-red-400 rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading || !canSubmit}
        className="w-full py-3 btn-gradient text-white font-semibold rounded-xl text-sm disabled:opacity-50"
      >
        {loading ? '...' : t('step1.next')}
      </button>
    </form>
  )
}
