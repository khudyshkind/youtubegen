'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useStudioStore } from '@/lib/studio-store'
import { useLang } from '@/hooks/useLang'
import { CREDIT_COSTS } from '@/lib/types'

interface Props {
  initialShow: boolean
}

async function markOnboardingDone() {
  await fetch('/api/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ onboarding_completed: true }),
  })
}

export default function OnboardingModal({ initialShow }: Props) {
  const [visible, setVisible] = useState(initialShow)
  const [step, setStep] = useState(1)
  const router = useRouter()
  const reset = useStudioStore((s) => s.reset)
  const { t } = useLang()

  if (!visible) return null

  const PIPELINE_STEPS = [
    { icon: '📝', label: t('pipeline.topic') },
    { icon: '🤖', label: t('pipeline.script') },
    { icon: '🎙', label: t('pipeline.voice') },
    { icon: '📄', label: t('pipeline.subtitles') },
    { icon: '🖼', label: t('pipeline.images') },
    { icon: '🎬', label: t('pipeline.video') },
    { icon: '📊', label: t('pipeline.seo') },
  ]

  const CREDIT_ROWS = [
    { label: `${t('billing.op_script')} (Sonnet)`, cost: CREDIT_COSTS.script_sonnet },
    { label: `${t('billing.op_script')} (Opus)`,   cost: CREDIT_COSTS.script_opus },
    { label: t('billing.op_voice'),                 cost: `${CREDIT_COSTS.audio_secretvoicer_per_1000}–${CREDIT_COSTS.audio_elevenlabs_per_1000}/1к` },
    { label: `${t('billing.op_subtitles')}`,        cost: `${CREDIT_COSTS.subtitles_per_minute}/мин` },
    { label: t('billing.op_image'),                 cost: CREDIT_COSTS.image },
    { label: t('billing.op_video'),                 cost: `${CREDIT_COSTS.video}/мин` },
    { label: t('billing.op_seo'),                   cost: CREDIT_COSTS.seo },
  ]

  async function handleFinish() {
    await markOnboardingDone()
    setVisible(false)
    reset()
    router.push('/studio')
  }

  async function handleSkip() {
    await markOnboardingDone()
    setVisible(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">

        {/* Progress bar */}
        <div className="flex gap-1 p-4 pb-0">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                n <= step ? 'bg-red-500' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>

        <div className="p-8">

          {/* Step 1: Welcome */}
          {step === 1 && (
            <div className="flex flex-col items-center text-center gap-5">
              <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center text-4xl">
                🎬
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  {t('onboard.welcome')}
                </h2>
                <p className="text-gray-500 text-sm leading-relaxed">
                  {t('onboard.welcome_desc')}
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full pt-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl text-sm transition-colors"
                >
                  {t('onboard.start')}
                </button>
                <button
                  type="button"
                  onClick={handleSkip}
                  className="w-full py-2 text-gray-400 hover:text-gray-600 text-xs transition-colors"
                >
                  {t('onboard.skip')}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: How it works */}
          {step === 2 && (
            <div className="flex flex-col gap-5">
              <div className="text-center">
                <p className="text-xs font-medium text-red-500 uppercase tracking-wide mb-1">
                  {t('onboard.step')} 2 {t('onboard.step_of')} 4
                </p>
                <h2 className="text-xl font-bold text-gray-900 mb-1">{t('onboard.how_works')}</h2>
                <p className="text-sm text-gray-500">{t('onboard.how_works_desc')}</p>
              </div>

              <div className="flex items-center justify-between gap-1">
                {PIPELINE_STEPS.map((s, i) => (
                  <div key={s.label} className="flex items-center gap-1">
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-10 h-10 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-center text-lg">
                        {s.icon}
                      </div>
                      <span className="text-[10px] text-gray-500 font-medium text-center leading-tight w-12">
                        {s.label}
                      </span>
                    </div>
                    {i < PIPELINE_STEPS.length - 1 && (
                      <span className="text-gray-300 text-xs mb-4">→</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="bg-blue-50 rounded-xl px-4 py-3 text-center">
                <p className="text-sm text-blue-700">
                  {t('onboard.each_skippable')} <strong>{t('onboard.skippable_bold')}</strong> {t('onboard.skippable_end')}
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors"
                >
                  {t('onboard.back')}
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl text-sm transition-colors"
                >
                  {t('onboard.next')}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Credits */}
          {step === 3 && (
            <div className="flex flex-col gap-5">
              <div className="text-center">
                <p className="text-xs font-medium text-red-500 uppercase tracking-wide mb-1">
                  {t('onboard.step')} 3 {t('onboard.step_of')} 4
                </p>
                <h2 className="text-xl font-bold text-gray-900 mb-1">{t('onboard.credits_title')}</h2>
                <p className="text-sm text-gray-500">{t('onboard.credits_desc')}</p>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
                <p className="text-sm font-semibold text-amber-800">
                  {t('onboard.credits_gift')}
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('onboard.op')}</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('onboard.credits_col')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {CREDIT_ROWS.map((row) => (
                      <tr key={row.label}>
                        <td className="px-4 py-2.5 text-gray-700">{row.label}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{row.cost} {t('nav.credits_suffix')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors"
                >
                  {t('onboard.back')}
                </button>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl text-sm transition-colors"
                >
                  {t('onboard.next')}
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Done */}
          {step === 4 && (
            <div className="flex flex-col items-center text-center gap-5">
              <div className="w-20 h-20 bg-green-50 rounded-2xl flex items-center justify-center text-4xl">
                🚀
              </div>
              <div>
                <p className="text-xs font-medium text-red-500 uppercase tracking-wide mb-1">
                  {t('onboard.step')} 4 {t('onboard.step_of')} 4
                </p>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('onboard.all_ready')}</h2>
                <p className="text-gray-500 text-sm leading-relaxed">
                  {t('onboard.all_ready_desc')}
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full pt-2">
                <button
                  type="button"
                  onClick={handleFinish}
                  className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl text-sm transition-colors"
                >
                  {t('onboard.create_btn')}
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="w-full py-2 text-gray-400 hover:text-gray-600 text-xs transition-colors"
                >
                  {t('onboard.back')}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
