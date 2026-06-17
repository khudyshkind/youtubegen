'use client'

import React, { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useStudioStore } from '@/lib/studio-store'
import type { Project } from '@/lib/types'
import Step1Topic from './Step1Topic'
import Step2Script from './Step2Script'
import Step3Voice from './Step3Voice'
import Step4Subtitles from './Step4Subtitles'
import Step5Images from './Step5Images'
import Step6Video from './Step6Video'
import Step7Seo from './Step7Seo'
import { useLang } from '@/hooks/useLang'

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7

const STEP_KEYS = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'step7'] as const

function inferStep(p: Project): Step {
  if (p.seo) return 7
  if (p.video_url) return 7
  if (p.scene_images && p.scene_images.length > 0) return 6
  if (p.subtitle_blocks && p.subtitle_blocks.length > 0) return 5
  if (p.audio_url) return 4
  if (p.script) return 3
  return 2
}

function StepWizardInner() {
  const searchParams = useSearchParams()
  const projectParam = searchParams.get('project')

  const { currentStep, reset, setStep, setProjectId, setScriptParams, setScript,
    setVoiceId, setAudioUrl, setSubtitleBlocks, setSceneImages, setVideoUrl, setSeo,
    setImageInterval, setThumbnailUrl, setThumbnailBgUrl } = useStudioStore()

  const { t } = useLang()
  const [restoring, setRestoring] = useState(!!projectParam)
  const [restoreError, setRestoreError] = useState('')

  useEffect(() => {
    if (!projectParam) {
      reset()
      setRestoring(false)
      setRestoreError('')
      return
    }

    let cancelled = false
    reset()  // clear stale data from any previously loaded project
    setRestoring(true)
    setRestoreError('')

    async function loadProject() {
      try {
        console.log('[studio] loading project:', projectParam)
        const res = await fetch(`/api/projects/${projectParam}`)
        if (cancelled) return
        const json = await res.json()

        if (!json.ok) {
          setRestoreError('Проект не найден')
          return
        }

        const p: Project = json.data.project
        console.log('[studio] loaded data:', p.topic)
        setProjectId(p.id)
        setScriptParams({ topic: p.topic, duration_minutes: p.duration_minutes })
        if (p.script) setScript(p.script)
        if (p.voice_id) setVoiceId(p.voice_id)
        if (p.audio_url) setAudioUrl(p.audio_url)
        if (p.subtitle_blocks) setSubtitleBlocks(p.subtitle_blocks)
        if (p.scene_images) setSceneImages(p.scene_images)
        if (p.image_interval) setImageInterval(p.image_interval)
        if (p.video_url) setVideoUrl(p.video_url)
        if (p.seo) setSeo(p.seo)
        setThumbnailUrl(p.thumbnail_url ?? null)
        setThumbnailBgUrl(null)
        setStep(inferStep(p))
      } catch {
        if (!cancelled) setRestoreError('Ошибка загрузки проекта')
      } finally {
        if (!cancelled) setRestoring(false)
      }
    }

    loadProject()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectParam])

  if (restoring) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-3">
          <svg className="w-8 h-8 animate-spin text-violet-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-sm text-slate-500">{t('studio.loading')}</p>
        </div>
      </div>
    )
  }

  if (restoreError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <p className="text-red-400 font-medium">{restoreError}</p>
        <button
          onClick={reset}
          className="px-5 py-2.5 btn-gradient text-white font-semibold rounded-xl text-sm"
        >
          {t('studio.new_project')}
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Step indicator */}
      <div className="flex items-start mb-8 overflow-x-auto pb-1">
        {STEP_KEYS.map((key, idx) => {
          const stepN = (idx + 1) as Step
          const done = currentStep > stepN
          const active = currentStep === stepN
          const reachable = stepN < currentStep
          return (
            <React.Fragment key={stepN}>
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => reachable ? setStep(stepN) : undefined}
                  disabled={!reachable}
                  title={reachable ? `${t('studio.go_to_step')} ${stepN}: ${t(`studio.${key}`)}` : undefined}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    done
                      ? 'step-done text-white cursor-pointer hover:opacity-90'
                      : active
                      ? 'step-active text-white cursor-default'
                      : 'step-future text-slate-500 cursor-default'
                  }`}
                >
                  {done ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    stepN
                  )}
                </button>
                <span
                  className={`hidden sm:block text-xs font-medium whitespace-nowrap transition-colors ${
                    done ? 'text-green-400' : active ? 'text-violet-400' : 'text-slate-600'
                  }`}
                >
                  {t(`studio.${key}`)}
                </span>
              </div>

              {idx < STEP_KEYS.length - 1 && (
                <div
                  className="flex-1 h-0.5 mt-4 mx-1 transition-all min-w-[8px]"
                  style={{
                    background: currentStep > stepN
                      ? 'linear-gradient(90deg, #10B981, #059669)'
                      : 'rgba(255,255,255,0.08)',
                  }}
                />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* Step content */}
      <div
        className="rounded-2xl p-6"
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {currentStep === 1 && <Step1Topic />}
        {currentStep === 2 && <Step2Script />}
        {currentStep === 3 && <Step3Voice />}
        {currentStep === 4 && <Step4Subtitles />}
        {currentStep === 5 && <Step5Images />}
        {currentStep === 6 && <Step6Video />}
        {currentStep === 7 && <Step7Seo />}
      </div>

      {currentStep > 1 && (
        <div className="text-center mt-4">
          <button
            onClick={reset}
            className="text-sm text-slate-600 hover:text-slate-400 transition-colors"
          >
            {t('studio.restart')}
          </button>
        </div>
      )}
    </div>
  )
}

export default function StepWizard() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-24">
        <svg className="w-8 h-8 animate-spin text-violet-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </div>
    }>
      <StepWizardInner />
    </Suspense>
  )
}
