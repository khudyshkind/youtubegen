'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useStudioStore } from '@/lib/studio-store'
import { CREDIT_COSTS } from '@/lib/types'

interface Props {
  initialShow: boolean
}

const PIPELINE_STEPS = [
  { icon: '📝', label: 'Тема' },
  { icon: '🤖', label: 'Сценарий' },
  { icon: '🎙', label: 'Озвучка' },
  { icon: '📄', label: 'Субтитры' },
  { icon: '🖼', label: 'Иллюстрации' },
  { icon: '🎬', label: 'Видео' },
  { icon: '📊', label: 'SEO' },
]

const CREDIT_ROWS = [
  { label: 'Сценарий (Sonnet)', cost: CREDIT_COSTS.script_sonnet },
  { label: 'Сценарий (Opus)', cost: CREDIT_COSTS.script_opus },
  { label: 'Озвучка', cost: CREDIT_COSTS.audio },
  { label: 'Субтитры', cost: CREDIT_COSTS.subtitles },
  { label: 'Иллюстрация (за шт.)', cost: CREDIT_COSTS.image },
  { label: 'Сборка видео', cost: CREDIT_COSTS.video },
  { label: 'SEO-описание', cost: CREDIT_COSTS.seo },
]

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

  if (!visible) return null

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

          {/* ── Шаг 1: Приветствие ── */}
          {step === 1 && (
            <div className="flex flex-col items-center text-center gap-5">
              <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center text-4xl">
                🎬
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  Добро пожаловать в YouTubeGen!
                </h2>
                <p className="text-gray-500 text-sm leading-relaxed">
                  Создавайте YouTube видео за 10 минут с помощью ИИ — от темы до готового MP4 с субтитрами и SEO
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full pt-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl text-sm transition-colors"
                >
                  Начать знакомство →
                </button>
                <button
                  type="button"
                  onClick={handleSkip}
                  className="w-full py-2 text-gray-400 hover:text-gray-600 text-xs transition-colors"
                >
                  Пропустить
                </button>
              </div>
            </div>
          )}

          {/* ── Шаг 2: Пайплайн ── */}
          {step === 2 && (
            <div className="flex flex-col gap-5">
              <div className="text-center">
                <p className="text-xs font-medium text-red-500 uppercase tracking-wide mb-1">Шаг 2 из 4</p>
                <h2 className="text-xl font-bold text-gray-900 mb-1">Как это работает</h2>
                <p className="text-sm text-gray-500">Просто опишите тему — ИИ сделает остальное</p>
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
                  Каждый шаг можно <strong>пропустить</strong> или заменить своими материалами
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors"
                >
                  ← Назад
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl text-sm transition-colors"
                >
                  Далее →
                </button>
              </div>
            </div>
          )}

          {/* ── Шаг 3: Кредиты ── */}
          {step === 3 && (
            <div className="flex flex-col gap-5">
              <div className="text-center">
                <p className="text-xs font-medium text-red-500 uppercase tracking-wide mb-1">Шаг 3 из 4</p>
                <h2 className="text-xl font-bold text-gray-900 mb-1">Система кредитов</h2>
                <p className="text-sm text-gray-500">Каждая операция списывает кредиты</p>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
                <p className="text-sm font-semibold text-amber-800">
                  🎁 У вас 20 бесплатных кредитов — хватит на несколько видео
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Операция</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Кредиты</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {CREDIT_ROWS.map((row) => (
                      <tr key={row.label}>
                        <td className="px-4 py-2.5 text-gray-700">{row.label}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{row.cost} кр.</td>
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
                  ← Назад
                </button>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl text-sm transition-colors"
                >
                  Далее →
                </button>
              </div>
            </div>
          )}

          {/* ── Шаг 4: Готово ── */}
          {step === 4 && (
            <div className="flex flex-col items-center text-center gap-5">
              <div className="w-20 h-20 bg-green-50 rounded-2xl flex items-center justify-center text-4xl">
                🚀
              </div>
              <div>
                <p className="text-xs font-medium text-red-500 uppercase tracking-wide mb-1">Шаг 4 из 4</p>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Всё готово!</h2>
                <p className="text-gray-500 text-sm leading-relaxed">
                  Создайте своё первое видео прямо сейчас — это займёт около 10 минут
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full pt-2">
                <button
                  type="button"
                  onClick={handleFinish}
                  className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl text-sm transition-colors"
                >
                  Создать первое видео →
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="w-full py-2 text-gray-400 hover:text-gray-600 text-xs transition-colors"
                >
                  ← Назад
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
