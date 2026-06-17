'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { PLAN_CREDITS } from '@/lib/types'
import { useLang } from '@/hooks/useLang'
import type { Profile, Plan } from '@/lib/types'

export default function BillingPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const supabase = createClient()
  const { t } = useLang()

  const PLANS = [
    {
      id: 'free' as Plan,
      name: 'Free',
      price: '$0',
      period: '',
      highlight: false,
      features: [t('billing.f_credits_once'), t('billing.f_all_tools')],
    },
    {
      id: 'starter' as Plan,
      name: 'Starter',
      price: '$19',
      period: t('billing.period'),
      highlight: false,
      features: [t('billing.f_credits_100'), t('billing.f_videos_5_9'), t('billing.f_all_tools'), t('billing.f_email_support')],
    },
    {
      id: 'pro' as Plan,
      name: 'Pro',
      price: '$39',
      period: t('billing.period'),
      highlight: true,
      features: [t('billing.f_credits_300'), t('billing.f_videos_15_25'), t('billing.f_all_tools'), t('billing.f_priority_support')],
    },
    {
      id: 'agency' as Plan,
      name: 'Agency',
      price: '$99',
      period: t('billing.period'),
      highlight: false,
      features: [t('billing.f_credits_1000'), t('billing.f_videos_55_90'), t('billing.f_all_tools'), t('billing.f_dedicated_support'), t('billing.f_api_access')],
    },
  ]

  const CREDIT_COST_INFO = [
    { operation: t('billing.op_script'),    credits: 1,     icon: '✍️' },
    { operation: t('billing.op_voice'),     credits: '1–3', icon: '🎙' },
    { operation: t('billing.op_subtitles'), credits: 1,     icon: '📋' },
    { operation: t('billing.op_image'),     credits: 1,     icon: '🎨' },
    { operation: t('billing.op_video'),     credits: 2,     icon: '🎬' },
    { operation: t('billing.op_seo'),       credits: 1,     icon: '🔍' },
  ]

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
      const res = await fetch('/api/paddle/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      })
      const json = await res.json()

      if (!json.ok) {
        setError(json.error ?? t('billing.err_session'))
        return
      }

      window.location.href = json.data.url
    } catch {
      setError(t('billing.err_conn'))
    } finally {
      setLoadingPlan(null)
    }
  }

  const currentPlan = profile?.plan ?? 'free'

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">{t('billing.title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('billing.subtitle')}</p>
      </div>

      {/* Current balance */}
      <div
        className="rounded-2xl p-6 mb-8"
        style={{
          background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(37,99,235,0.08))',
          border: '1px solid rgba(124,58,237,0.25)',
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-violet-400 mb-1">{t('billing.balance')}</p>
            <div className="flex items-end gap-2">
              <span className="text-5xl font-extrabold text-slate-100">
                {profile?.credits ?? '—'}
              </span>
              <span className="text-lg text-slate-400 mb-1">{t('billing.credits_unit')}</span>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              {t('billing.plan_label')}{' '}
              <span className="font-semibold capitalize text-violet-300">
                {currentPlan} · {PLAN_CREDITS[currentPlan]} {t('billing.credits_unit')}{currentPlan !== 'free' ? t('billing.period') : ''}
              </span>
            </p>
          </div>
          <div className="flex flex-col gap-1 text-sm text-slate-400">
            <p className="font-medium text-slate-300">{t('billing.ops_title')}</p>
            {CREDIT_COST_INFO.map((item) => (
              <p key={item.operation}>
                {item.icon} {item.operation} — <strong className="text-slate-200">{item.credits} {t('nav.credits_suffix')}</strong>
              </p>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <p className="mb-6 text-sm text-red-400 rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </p>
      )}

      {/* Plans grid */}
      <h2 className="text-lg font-semibold text-slate-200 mb-4">{t('billing.choose_plan')}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlan
          const isDowngrade =
            ['free', 'starter', 'pro', 'agency'].indexOf(plan.id) <
            ['free', 'starter', 'pro', 'agency'].indexOf(currentPlan)

          return (
            <div
              key={plan.id}
              className={`relative rounded-2xl p-5 flex flex-col gap-4 transition-all ${
                plan.highlight ? 'pro-card-glow' : 'card-dark'
              } ${isCurrent ? 'border-violet-500/60' : ''}`}
            >
              {plan.highlight && !isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="btn-gradient text-white text-xs font-bold px-3 py-1 rounded-full">
                    {t('billing.popular')}
                  </span>
                </div>
              )}
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span
                    className="text-violet-300 text-xs font-bold px-3 py-1 rounded-full"
                    style={{ background: 'rgba(124,58,237,0.3)', border: '1px solid rgba(124,58,237,0.5)' }}
                  >
                    {t('billing.current_plan')}
                  </span>
                </div>
              )}

              <div>
                <p className="text-sm font-medium text-slate-400">{plan.name}</p>
                <div className="flex items-end gap-1 mt-1">
                  <span className="text-3xl font-extrabold text-slate-100">{plan.price}</span>
                  <span className="text-slate-500 mb-0.5">{plan.period}</span>
                </div>
                <p className="text-sm font-medium text-violet-400 mt-1">
                  {PLAN_CREDITS[plan.id]} {t('billing.credits_unit')}
                </p>
              </div>

              <ul className="flex flex-col gap-2 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-400">
                    <svg className="w-4 h-4 text-green-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleUpgrade(plan.id)}
                disabled={isCurrent || plan.id === 'free' || isDowngrade || loadingPlan !== null}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  isCurrent
                    ? 'text-violet-300 cursor-default'
                    : plan.id === 'free' || isDowngrade
                    ? 'text-slate-600 cursor-not-allowed'
                    : plan.highlight
                    ? 'btn-gradient text-white disabled:opacity-50'
                    : 'text-slate-200 disabled:opacity-50'
                }`}
                style={
                  isCurrent
                    ? { background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }
                    : plan.id === 'free' || isDowngrade
                    ? { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }
                    : plan.highlight
                    ? {}
                    : { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }
                }
              >
                {isCurrent
                  ? t('billing.current_plan')
                  : isDowngrade
                  ? t('billing.downgrade')
                  : plan.id === 'free'
                  ? t('billing.free_btn')
                  : loadingPlan === plan.id
                  ? t('billing.loading')
                  : t('billing.upgrade')}
              </button>
            </div>
          )
        })}
      </div>

      <p className="text-sm text-slate-600 mt-6 text-center">
        {t('billing.paddle_note')}
      </p>

      {/* Russia payment block */}
      <div
        className="mt-8 rounded-2xl p-6"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">🇷🇺</span>
          <h3 className="text-lg font-semibold text-slate-100">{t('billing.russia_title')}</h3>
        </div>
        <p className="text-sm text-slate-400 mb-4">{t('billing.russia_desc')}</p>
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div
            className="flex-1 rounded-xl px-4 py-3 flex items-center gap-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <span className="text-xl">💳</span>
            <div>
              <p className="text-sm font-medium text-slate-200">{t('billing.russia_mir')}</p>
              <p className="text-xs text-slate-500">{t('billing.russia_mir_desc')}</p>
            </div>
          </div>
          <div
            className="flex-1 rounded-xl px-4 py-3 flex items-center gap-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <span className="text-xl">₿</span>
            <div>
              <p className="text-sm font-medium text-slate-200">{t('billing.russia_crypto')}</p>
              <p className="text-xs text-slate-500">{t('billing.russia_crypto_desc')}</p>
            </div>
          </div>
        </div>
        <a
          href="https://t.me/youtubegenai_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.9), rgba(37,99,235,0.9))', border: '1px solid rgba(124,58,237,0.4)' }}
        >
          {t('billing.russia_btn')}
        </a>
      </div>
    </div>
  )
}
