'use client'

import React, { Suspense, useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useStudioStore } from '@/lib/studio-store'
import type { Project } from '@/lib/types'
import { CREDIT_COSTS } from '@/lib/types'
import Step1Topic from './Step1Topic'
import Step2Plan from './Step2Plan'
import Step2Script from './Step2Script'
import Step3Voice from './Step3Voice'
import Step4Subtitles from './Step4Subtitles'
import Step5Images from './Step5Images'
import Step6Video from './Step6Video'
import Step7Seo from './Step7Seo'
import StickyActionPanel from './StickyActionPanel'
import { useLang } from '@/hooks/useLang'

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

const STEP_KEYS = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'step7', 'step8'] as const

function inferStep(p: Project): Step {
  if (p.status === 'generating_video') return 7   // render in progress → stay on video step
  if (p.seo) return 8
  if (p.video_url) return 8
  if (p.scene_images && p.scene_images.length > 0) return 7
  if (p.subtitle_blocks && p.subtitle_blocks.length > 0) return 6
  if (p.audio_url) return 5
  if (p.script) return 4
  if (p.plan_sections && p.plan_sections.length > 0) return 3
  return 2
}

function StepWizardInner() {
  const searchParams = useSearchParams()
  const projectParam = searchParams.get('project')

  const { currentStep, reset, setStep, setProjectId, setScriptParams, setPlanSections, setScript,
    setVoiceId, setAudioUrl, setSubtitleBlocks, sceneImages, setSceneImages, setVideoUrl, setSeo,
    setImageInterval, setImageStyle, setThumbnailUrl, setThumbnailBgUrl, setThumbnailTextMode,
    setRenderJobId, setProjectStatus,
    script, scriptParams, subtitleBlocks, audioUrl, seo, projectId, ownScript,
    imageEngine, imageInterval, audioCostEstimate } = useStudioStore()

  const { t } = useLang()
  const router = useRouter()
  const step1SubmitRef = useRef<(() => void) | null>(null)
  const registerStep1Submit = useCallback((fn: () => void) => { step1SubmitRef.current = fn }, [])
  const step3NextRef = useRef<(() => void) | null>(null)
  const registerStep3Next = useCallback((fn: () => void) => { step3NextRef.current = fn }, [])
  const seoFinishRef = useRef<(() => void) | null>(null)
  const registerSeoFinish = useCallback((fn: () => void) => { seoFinishRef.current = fn }, [])

  // ── Panel computed values ─────────────────────────────────────────────────
  const scriptCost = scriptParams.model === 'claude-opus' ? CREDIT_COSTS.script_opus
    : scriptParams.model === 'gpt-4o' ? CREDIT_COSTS.script_gpt
    : CREDIT_COSTS.script_sonnet
  const durationSec = subtitleBlocks.length > 0
    ? Math.ceil(subtitleBlocks[subtitleBlocks.length - 1].end)
    : scriptParams.duration_minutes * 60
  const imgCount = Math.max(1, Math.ceil(durationSec / imageInterval))
  const costPerImg = imageEngine === 'gpt_mini' ? CREDIT_COSTS.image_gpt_mini
    : imageEngine === 'flux_schnell' ? CREDIT_COSTS.image_flux_schnell
    : CREDIT_COSTS.image_flux
  const totalImgCost = imgCount * costPerImg
  const validImgCount = sceneImages.filter((img) => !!img.url).length
  const videoSec = subtitleBlocks.length > 0
    ? subtitleBlocks[subtitleBlocks.length - 1].end
    : validImgCount * imageInterval
  const videoCost = Math.max(1, Math.ceil(videoSec / 60)) * CREDIT_COSTS.video
  // ─────────────────────────────────────────────────────────────────────────

  const [restoring, setRestoring] = useState(!!projectParam)
  const [restoreError, setRestoreError] = useState('')

  const fromParam = searchParams.get('from')

  useEffect(() => {
    if (!projectParam) {
      if (fromParam === 'plan') {
        // Analytics → new project: always reset stale state from any previous
        // project, but preserve the topic that analytics injected into the store
        // before navigation (goToStudio calls setScriptParams({ topic }) first).
        const injectedTopic = useStudioStore.getState().scriptParams.topic
        reset()
        if (injectedTopic) setScriptParams({ topic: injectedTopic })
      } else if (fromParam !== 'tools') {
        // Normal new project (dashboard, etc.): full reset.
        // from=tools is intentionally kept as-is: the tools page sets the
        // processed script into the store and continues the same project.
        reset()
      }
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
        setScriptParams({ topic: p.topic, duration_minutes: p.duration_minutes, ...(p.language ? { language: p.language as import('@/lib/types').ScriptLanguage } : {}) })
        if (p.plan_sections) setPlanSections(p.plan_sections)
        if (p.script) setScript(p.script)
        if (p.voice_id) setVoiceId(p.voice_id)
        if (p.audio_url) setAudioUrl(p.audio_url)
        if (p.subtitle_blocks) setSubtitleBlocks(p.subtitle_blocks)
        if (p.scene_images) setSceneImages(p.scene_images)
        if (p.image_interval) setImageInterval(p.image_interval)
        setImageStyle(p.image_style ?? null)
        if (p.video_url) setVideoUrl(p.video_url)
        if (p.seo) setSeo(p.seo)
        setThumbnailUrl(p.thumbnail_url ?? null)
        setThumbnailBgUrl(null)
        if (p.thumbnail_text_mode === 'ai' || p.thumbnail_text_mode === 'none') {
          setThumbnailTextMode(p.thumbnail_text_mode)
        }

        // If project is in 'generating_video' state, try to find the active job and
        // resume polling. Using status (not !video_url) handles re-render correctly:
        // render/route.ts resets video_url=null + status='generating_video' on each render start.
        if (p.status === 'generating_video') {
          try {
            const jobRes = await fetch(`/api/generate/video/status?project_id=${p.id}`)
            if (!cancelled && jobRes.ok) {
              const jobJson = await jobRes.json() as { ok: boolean; job_id?: string; status?: string }
              if (jobJson.ok && jobJson.job_id && (jobJson.status === 'pending' || jobJson.status === 'processing')) {
                setRenderJobId(jobJson.job_id)
              }
            }
          } catch { /* non-fatal — Step6Video will show idle state */ }
        }

        setProjectStatus(p.status)
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
      <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-6 lg:items-start">
        <div
          className="rounded-2xl p-6"
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {currentStep === 1 && <Step1Topic onRegisterSubmit={registerStep1Submit} />}
          {currentStep === 2 && <Step2Plan />}
          {currentStep === 3 && <Step2Script onRegisterNext={registerStep3Next} />}
          {currentStep === 4 && <Step3Voice />}
          {currentStep === 5 && <Step4Subtitles />}
          {currentStep === 6 && <Step5Images />}
          {currentStep === 7 && <Step6Video />}
          {currentStep === 8 && <Step7Seo onRegisterFinish={registerSeoFinish} />}
        </div>
        <div className="hidden lg:block">
          {currentStep === 1 && (
            <StickyActionPanel
              stepLabel={t('studio.step1')}
              costLine={ownScript ? undefined : `Генерация сценария: −${scriptCost} кр.`}
              primaryLabel={t('step1.next')}
              primaryDisabled={!(ownScript || !!scriptParams.topic.trim())}
              onPrimary={() => step1SubmitRef.current?.()}
            />
          )}
          {currentStep === 2 && (
            <StickyActionPanel
              stepLabel={t('studio.step2')}
              costLine={ownScript ? undefined : `План: −${CREDIT_COSTS.plan} кр.`}
              primaryLabel={t('plan.next')}
              onPrimary={() => setStep(3)}
              secondaryLabel={t('plan.back')}
              onSecondary={() => setStep(1)}
            />
          )}
          {currentStep === 3 && (
            <StickyActionPanel
              stepLabel={t('studio.step3')}
              costLine={`Перегенерация: −${scriptCost} кр.`}
              primaryLabel={t('step2.next')}
              primaryDisabled={!script?.trim()}
              onPrimary={() => step3NextRef.current?.()}
              secondaryLabel={t('step2.back')}
              onSecondary={() => setStep(2)}
            />
          )}
          {currentStep === 4 && (
            <StickyActionPanel
              stepLabel={t('studio.step4')}
              costLine={audioCostEstimate ? `Озвучка: ${audioCostEstimate} кр.` : undefined}
              primaryLabel={t('step3.next')}
              primaryDisabled={!audioUrl}
              onPrimary={() => setStep(5)}
              secondaryLabel={t('step3.back')}
              onSecondary={() => setStep(3)}
            />
          )}
          {currentStep === 5 && (
            <StickyActionPanel
              stepLabel={t('studio.step5')}
              primaryLabel={t('step4.next')}
              primaryDisabled={subtitleBlocks.length === 0}
              onPrimary={() => setStep(6)}
              secondaryLabel={t('step4.back')}
              onSecondary={() => setStep(4)}
            />
          )}
          {currentStep === 6 && (
            <StickyActionPanel
              stepLabel={t('studio.step6')}
              costLine={`Итого: ${totalImgCost} кр.`}
              primaryLabel={t('step5.next')}
              primaryDisabled={sceneImages.length === 0 || sceneImages.some((img) => !img.url)}
              onPrimary={() => setStep(7)}
              secondaryLabel={t('step5.back')}
              onSecondary={() => setStep(5)}
            />
          )}
          {currentStep === 7 && (
            <StickyActionPanel
              stepLabel={t('studio.step7')}
              costLine={`Сборка: ~${videoCost} кр.`}
              primaryLabel={t('step6.next')}
              onPrimary={() => setStep(8)}
              secondaryLabel={t('step6.back')}
              onSecondary={() => setStep(6)}
            />
          )}
          {currentStep === 8 && (
            <StickyActionPanel
              stepLabel={t('studio.step8')}
              costLine={`SEO: −${CREDIT_COSTS.seo} кр.`}
              primaryLabel={t('step7.finish')}
              primaryDisabled={!seo}
              onPrimary={() => seoFinishRef.current?.()}
              secondaryLabel={t('step7.back')}
              onSecondary={() => setStep(7)}
            />
          )}
        </div>
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
