'use client'

import React from 'react'
import { useStudioStore } from '@/lib/studio-store'
import Step1Topic from './Step1Topic'
import Step2Script from './Step2Script'
import Step3Voice from './Step3Voice'
import Step4Images from './Step4Images'
import Step5Video from './Step5Video'
import Step6Seo from './Step6Seo'

const STEPS = [
  { n: 1 as const, label: 'Тема' },
  { n: 2 as const, label: 'Сценарий' },
  { n: 3 as const, label: 'Озвучка' },
  { n: 4 as const, label: 'Иллюстрации' },
  { n: 5 as const, label: 'Видео' },
  { n: 6 as const, label: 'SEO' },
]

export default function StepWizard() {
  const { currentStep, reset } = useStudioStore()

  return (
    <div>
      {/* Progress bar */}
      <div className="flex items-start mb-8">
        {STEPS.map((step, idx) => (
          <React.Fragment key={step.n}>
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  currentStep > step.n
                    ? 'bg-red-500 text-white'
                    : currentStep === step.n
                    ? 'bg-red-500 text-white ring-4 ring-red-100'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {currentStep > step.n ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  step.n
                )}
              </div>
              <span
                className={`hidden sm:block text-xs font-medium ${
                  currentStep >= step.n ? 'text-gray-700' : 'text-gray-400'
                }`}
              >
                {step.label}
              </span>
            </div>

            {idx < STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mt-4 mx-2 transition-all ${
                  currentStep > step.n ? 'bg-red-400' : 'bg-gray-200'
                }`}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step content */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        {currentStep === 1 && <Step1Topic />}
        {currentStep === 2 && <Step2Script />}
        {currentStep === 3 && <Step3Voice />}
        {currentStep === 4 && <Step4Images />}
        {currentStep === 5 && <Step5Video />}
        {currentStep === 6 && <Step6Seo />}
      </div>

      {/* Reset button (not on step 1) */}
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
