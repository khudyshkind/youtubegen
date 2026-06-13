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

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7

const STEPS = [
  { n: 1 as Step, label: 'Тема' },
  { n: 2 as Step, label: 'Сценарий' },
  { n: 3 as Step, label: 'Озвучка' },
  { n: 4 as Step, label: 'Субтитры' },
  { n: 5 as Step, label: 'Картинки' },
  { n: 6 as Step, label: 'Видео' },
  { n: 7 as Step, label: 'SEO' },
]

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

  const [restoring, setRestoring] = useState(!!projectParam)
  const [restoreError, setRestoreError] = useState('')

  // Single effect handles both cases: no param → reset; param → load project.
  // Uses a cancellation flag so navigating A→B cancels the in-flight A request,
  // and React StrictMode double-invocation doesn't produce duplicate loads.
  useEffect(() => {
    if (!projectParam) {
      reset()
      setRestoring(false)
      setRestoreError('')
      return
    }

    let cancelled = false
    setRestoring(true)
    setRestoreError('')

    async function loadProject() {
      try {
        const res = await fetch(`/api/projects/${projectParam}`)
        if (cancelled) return
        const json = await res.json()

        if (!json.ok) {
          setRestoreError('Проект не найден')
          return
        }

        const p: Project = json.data.project
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
          <svg className="w-8 h-8 animate-spin text-red-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-sm text-gray-500">Загрузка проекта...</p>
        </div>
      </div>
    )
  }

  if (restoreError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <p className="text-red-500 font-medium">{restoreError}</p>
        <button
          onClick={reset}
          className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl text-sm transition-colors"
        >
          Создать новый проект
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Progress bar */}
      <div className="flex items-start mb-8 overflow-x-auto pb-1">
        {STEPS.map((step, idx) => {
          const done = currentStep > step.n
          const active = currentStep === step.n
          const reachable = step.n < currentStep
          return (
            <React.Fragment key={step.n}>
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => reachable ? setStep(step.n) : undefined}
                  disabled={!reachable}
                  title={reachable ? `Перейти к шагу ${step.n}: ${step.label}` : undefined}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    done
                      ? 'bg-red-500 text-white hover:bg-red-600 cursor-pointer'
                      : active
                      ? 'bg-red-500 text-white ring-4 ring-red-100 cursor-default'
                      : 'bg-gray-100 text-gray-400 cursor-default'
                  }`}
                >
                  {done ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    step.n
                  )}
                </button>
                <span
                  className={`hidden sm:block text-xs font-medium whitespace-nowrap ${
                    currentStep >= step.n ? 'text-gray-700' : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {idx < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mt-4 mx-1 transition-all min-w-[8px] ${
                    currentStep > step.n ? 'bg-red-400' : 'bg-gray-200'
                  }`}
                />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* Step content */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
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
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            ↺ Начать заново
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
        <svg className="w-8 h-8 animate-spin text-red-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </div>
    }>
      <StepWizardInner />
    </Suspense>
  )
}
