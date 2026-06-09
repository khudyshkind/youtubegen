'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { PLAN_CREDITS } from '@/lib/types'
import type { Profile, Plan } from '@/lib/types'

const PLANS: Array<{
  id: Plan
  name: string
  price: string
  period: string
  highlight: boolean
  features: string[]
}> = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '',
    highlight: false,
    features: ['5 кредитов (один раз)', 'Все инструменты генерации'],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$9',
    period: '/мес',
    highlight: false,
    features: ['50 кредитов в месяц', 'Все инструменты генерации', 'Email-поддержка'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$19',
    period: '/мес',
    highlight: true,
    features: ['200 кредитов в месяц', 'Все инструменты генерации', 'Приоритетная поддержка'],
  },
  {
    id: 'agency',
    name: 'Agency',
    price: '$49',
    period: '/мес',
    highlight: false,
    features: ['1000 кредитов в месяц', 'Все инструменты генерации', 'Выделенная поддержка', 'API-доступ'],
  },
]

const CREDIT_COST_INFO = [
  { operation: 'Генерация сценария', credits: 10, icon: '✍️' },
  { operation: 'Озвучка', credits: '5 / мин', icon: '🎙' },
  { operation: 'Субтитры', credits: 3, icon: '📋' },
  { operation: 'Иллюстрация', credits: 8, icon: '🎨' },
  { operation: 'SEO-оптимизация', credits: 5, icon: '🔍' },
]

export default function BillingPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const supabase = createClient()

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/login'); return }

      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      setProfile(data as Profile | null)
    }
    loadProfile()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpgrade(planId: Plan) {
    if (planId === 'free') return
    setError('')
    setLoadingPlan(planId)

    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      })
      const json = await res.json()

      if (!json.ok) {
        setError(json.error ?? 'Ошибка создания сессии оплаты')
        return
      }

      window.location.href = json.data.url
    } catch {
      setError('Ошибка соединения с сервером')
    } finally {
      setLoadingPlan(null)
    }
  }

  const currentPlan = profile?.plan ?? 'free'

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Тарифы и кредиты</h1>
        <p className="text-gray-500 text-sm mt-1">Управляйте подпиской и балансом кредитов</p>
      </div>

      {/* Current balance */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-6 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-amber-700 mb-1">Текущий баланс</p>
            <div className="flex items-end gap-2">
              <span className="text-5xl font-extrabold text-gray-900">
                {profile?.credits ?? '—'}
              </span>
              <span className="text-lg text-gray-600 mb-1">кредитов</span>
            </div>
            <p className="text-sm text-amber-700 mt-1">
              Тариф:{' '}
              <span className="font-semibold capitalize">
                {currentPlan} · {PLAN_CREDITS[currentPlan]} кредитов/мес
              </span>
            </p>
          </div>
          <div className="flex flex-col gap-1 text-sm text-amber-800">
            <p className="font-medium">Стоимость операций:</p>
            {CREDIT_COST_INFO.map((item) => (
              <p key={item.operation}>
                {item.icon} {item.operation} — <strong>{item.credits} кр.</strong>
              </p>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <p className="mb-6 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3 border border-red-200">
          {error}
        </p>
      )}

      {/* Plans grid */}
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Выберите тариф</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlan
          const isDowngrade =
            ['free', 'starter', 'pro', 'agency'].indexOf(plan.id) <
            ['free', 'starter', 'pro', 'agency'].indexOf(currentPlan)

          return (
            <div
              key={plan.id}
              className={`relative bg-white rounded-2xl border-2 p-5 flex flex-col gap-4 ${
                isCurrent
                  ? 'border-amber-400 shadow-lg shadow-amber-100'
                  : plan.highlight
                  ? 'border-red-400 shadow-lg shadow-red-100'
                  : 'border-gray-200'
              }`}
            >
              {plan.highlight && !isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                    Популярный
                  </span>
                </div>
              )}
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-amber-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                    Ваш тариф
                  </span>
                </div>
              )}

              <div>
                <p className="text-sm font-medium text-gray-500">{plan.name}</p>
                <div className="flex items-end gap-1 mt-1">
                  <span className="text-3xl font-extrabold text-gray-900">{plan.price}</span>
                  <span className="text-gray-500 mb-0.5">{plan.period}</span>
                </div>
                <p className="text-sm font-medium text-amber-600 mt-1">
                  {PLAN_CREDITS[plan.id]} кредитов
                </p>
              </div>

              <ul className="flex flex-col gap-2 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleUpgrade(plan.id)}
                disabled={isCurrent || plan.id === 'free' || isDowngrade || loadingPlan !== null}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  isCurrent
                    ? 'bg-amber-100 text-amber-700 cursor-default'
                    : plan.id === 'free' || isDowngrade
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : plan.highlight
                    ? 'bg-red-500 hover:bg-red-600 text-white disabled:opacity-50'
                    : 'bg-gray-900 hover:bg-gray-700 text-white disabled:opacity-50'
                }`}
              >
                {isCurrent
                  ? 'Текущий тариф'
                  : isDowngrade
                  ? 'Понижение'
                  : plan.id === 'free'
                  ? 'Бесплатный'
                  : loadingPlan === plan.id
                  ? 'Загрузка...'
                  : 'Перейти'}
              </button>
            </div>
          )
        })}
      </div>

      <p className="text-sm text-gray-500 mt-6 text-center">
        Оплата через Stripe · Отменить подписку можно в любое время · Кредиты начисляются сразу после оплаты
      </p>
    </div>
  )
}
