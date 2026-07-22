'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { CREDIT_COSTS, PLAN_CREDITS, TOPUP_PACKAGES } from '@/lib/types'
import { useLang } from '@/hooks/useLang'
import type { Profile, Plan } from '@/lib/types'

function PaidBanner() {
  const searchParams = useSearchParams()
  const { t } = useLang()
  if (searchParams.get('paid') !== '1') return null
  return (
    <div
      className="mb-6 rounded-2xl px-5 py-4 flex items-center gap-3"
      style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}
    >
      <span className="text-2xl">✅</span>
      <div>
        <p className="text-sm font-semibold text-green-400">{t('billing.paid_success_title')}</p>
        <p className="text-xs text-slate-400 mt-0.5">{t('billing.paid_success_desc')}</p>
      </div>
    </div>
  )
}

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? 'lefiro_bot'

function tgPayUrl(startParam: string) {
  return `https://t.me/${BOT_USERNAME}?start=${startParam}`
}

export default function BillingPage() {
  const router        = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error,   setError]   = useState('')
  const [paying,  setPaying]  = useState<string | null>(null)
  // paying key format: `${baseKey}_sbp` | `${baseKey}_def`
  // baseKey = plan.id for plans, `topup_${i}` for topups
  const [currency, setCurrency] = useState<'rub' | 'usd'>('rub')
  const supabase = createClient()
  const { t } = useLang()

  const planPriceRub: Record<string, string> = { free: '0 ₽', basic: '790 ₽', starter: '1 490 ₽', pro: '3 990 ₽', agency: '11 900 ₽' }
  const planPriceUsd: Record<string, string> = { free: '$0', basic: '$9', starter: '$19', pro: '$39', agency: '$99' }
  const planPrice = (id: string) => currency === 'rub' ? planPriceRub[id] : planPriceUsd[id]

  const PLANS = [
    {
      id: 'free' as Plan,
      name: 'Free',
      price: planPrice('free'),
      period: '',
      highlight: false,
      features: [t('billing.f_credits_once'), t('billing.f_all_tools'), t('billing.f_no_analytics')],
    },
    {
      id: 'basic' as Plan,
      name: 'Basic',
      price: planPrice('basic'),
      period: t('billing.period'),
      highlight: false,
      features: [t('billing.f_credits_basic'), t('billing.f_all_tools'), t('billing.f_email_support')],
    },
    {
      id: 'starter' as Plan,
      name: 'Starter',
      price: planPrice('starter'),
      period: t('billing.period'),
      highlight: false,
      features: [t('billing.f_credits_100'), t('billing.f_all_tools'), t('billing.f_email_support')],
    },
    {
      id: 'pro' as Plan,
      name: 'Pro',
      price: planPrice('pro'),
      period: t('billing.period'),
      highlight: true,
      features: [t('billing.f_credits_300'), t('billing.f_all_tools'), t('billing.f_priority_support')],
    },
    {
      id: 'agency' as Plan,
      name: 'Agency',
      price: planPrice('agency'),
      period: t('billing.period'),
      highlight: false,
      features: [t('billing.f_credits_1000'), t('billing.f_all_tools'), t('billing.f_dedicated_support'), t('billing.f_api_access')],
    },
  ]

  const CREDIT_COST_INFO = [
    { operation: t('billing.op_script'),    credits: `${CREDIT_COSTS.script_sonnet}–${CREDIT_COSTS.script_opus}`,                                icon: '✍️' },
    { operation: t('billing.op_voice'),     credits: `${CREDIT_COSTS.audio_secretvoicer_per_1000}–${CREDIT_COSTS.audio_elevenlabs_per_1000}/1к`, icon: '🎙' },
    { operation: t('billing.op_subtitles'), credits: `${CREDIT_COSTS.subtitles_per_minute}/мин`,                                                 icon: '📋' },
    { operation: t('billing.op_image'),     credits: CREDIT_COSTS.image,                                                                         icon: '🎨' },
    { operation: t('billing.op_video'),     credits: `${CREDIT_COSTS.video}/мин`,                                                                icon: '🎬' },
    { operation: t('billing.op_seo'),       credits: CREDIT_COSTS.seo,                                                                           icon: '🔍' },
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

  async function payWithYookassa(plan?: string, topupIndex?: number, sbp = false) {
    const baseKey = plan ?? `topup_${topupIndex}`
    const key = `${baseKey}_${sbp ? 'sbp' : 'def'}`
    setPaying(key)
    setError('')
    try {
      const res = await fetch('/api/payments/yookassa/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          plan !== undefined ? { plan, sbp } : { topup_index: topupIndex, sbp },
        ),
      })
      const data = await res.json() as { confirmation_url?: string; error?: string }
      if (data.confirmation_url) {
        window.location.href = data.confirmation_url
      } else {
        setError(data.error ?? t('billing.err_conn'))
      }
    } catch {
      setError(t('billing.err_conn'))
    } finally {
      setPaying(null)
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

      {/* Payment success banner */}
      <Suspense>
        <PaidBanner />
      </Suspense>

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
            {/* Wallet breakdown (paid plans) */}
            {profile && currentPlan !== 'free' && (
              <p className="text-xs text-slate-300 mt-2 flex flex-wrap gap-x-2">
                <span>
                  {t('billing.wallet_plan')}: <span className="text-violet-300 font-semibold">{(profile.plan_credits ?? 0).toLocaleString()}</span>
                  {profile.plan_expires_at && (
                    <span className="text-slate-400 ml-1">
                      ({t('billing.expires_on')} {new Date(profile.plan_expires_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })})
                    </span>
                  )}
                </span>
                <span className="text-slate-500">·</span>
                <span>
                  {t('billing.wallet_purchased')}: <span className="text-green-400 font-semibold">{(profile.purchased_credits ?? 0).toLocaleString()}</span>
                </span>
              </p>
            )}
          </div>
          <div className="flex flex-col gap-0.5 text-slate-400">
            <p className="text-sm font-medium text-slate-300 mb-0.5">{t('billing.ops_title')}</p>
            {CREDIT_COST_INFO.map((item) => (
              <p key={item.operation} className="text-xs whitespace-nowrap">
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
      <div id="plans" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-slate-200">{t('billing.choose_plan')}</h2>
        {/* Currency switcher */}
        <div className="flex items-center gap-1 p-1 rounded-xl w-fit" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            onClick={() => setCurrency('rub')}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${currency === 'rub' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            ₽ RUB
          </button>
          <button
            onClick={() => setCurrency('usd')}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${currency === 'usd' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            $ USD
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-4">{t('billing.subscription_note')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 pt-4">
        {PLANS.map((plan) => {
          const isCurrent    = plan.id === currentPlan
          const sbpKey       = `${plan.id}_sbp`
          const defKey       = `${plan.id}_def`
          const isSbpLoading = paying === sbpKey
          const isDefLoading = paying === defKey
          const isAnyLoading = isSbpLoading || isDefLoading

          return (
            <div key={plan.id} className="relative pt-4 flex flex-col">
              {plan.highlight && !isCurrent && (
                <div className="absolute top-0 left-0 right-0 flex justify-center z-10">
                  <span className="btn-gradient text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                    {t('billing.popular')}
                  </span>
                </div>
              )}
              {isCurrent && (
                <div className="absolute top-0 left-0 right-0 flex justify-center z-10">
                  <span
                    className="text-violet-300 text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap"
                    style={{ background: 'rgba(124,58,237,0.3)', border: '1px solid rgba(124,58,237,0.5)' }}
                  >
                    {t('billing.current_plan')}
                  </span>
                </div>
              )}
              <div
                className={`relative rounded-2xl p-5 flex flex-col gap-4 h-full transition-all ${
                  plan.highlight ? 'pro-card-glow' : 'card-dark'
                } ${isCurrent ? 'border-violet-500/60' : ''}`}
              >
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

              {plan.id === 'free' ? (
                <div
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-center mt-auto"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(100,116,139,1)' }}
                >
                  {t('billing.free_btn')}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 mt-auto">
                  {currency === 'rub' && (
                    <>
                      {/* Primary: SBP */}
                      <button
                        onClick={() => payWithYookassa(plan.id, undefined, true)}
                        disabled={isAnyLoading}
                        className={`w-full py-2.5 rounded-xl text-sm font-semibold text-center transition-all disabled:opacity-60 disabled:cursor-wait ${
                          plan.highlight ? 'btn-gradient text-white' : 'text-white hover:opacity-90'
                        }`}
                        style={plan.highlight ? {} : { background: 'linear-gradient(135deg, rgba(124,58,237,0.85), rgba(37,99,235,0.85))', border: '1px solid rgba(124,58,237,0.4)' }}
                      >
                        {isSbpLoading ? t('billing.loading') : t('billing.pay_sbp')}
                      </button>
                      {/* Secondary: other YK methods */}
                      <button
                        onClick={() => payWithYookassa(plan.id, undefined, false)}
                        disabled={isAnyLoading}
                        className="w-full py-2 rounded-xl text-xs font-medium text-slate-400 text-center transition-all hover:text-slate-200 disabled:opacity-60 disabled:cursor-wait"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                      >
                        {isDefLoading ? t('billing.loading') : t('billing.pay_other')}
                      </button>
                      <p className="text-center text-xs text-slate-400">{t('billing.methods_note')}</p>
                    </>
                  )}
                  <a
                    href={tgPayUrl(`pay_${plan.id}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2 rounded-xl text-xs font-medium text-slate-500 text-center transition-all hover:text-slate-300 block"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    💬 {t('billing.tg_pay_btn')}
                  </a>
                </div>
              )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-slate-600 mt-3 text-center">{t('billing.tg_pay_note')}</p>

      {/* Topup section */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold text-slate-200 mb-1">{t('billing.topup_title')}</h2>
        <p className="text-sm text-slate-400 mb-1">{t('billing.topup_desc')}</p>
        <p className="text-xs text-slate-400 mb-4">{t('billing.subscription_note')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {TOPUP_PACKAGES.map((pkg, i) => {
            const topupKeys    = ['pay_topup_500', 'pay_topup_2000', 'pay_topup_5000'] as const
            const sbpKey       = `topup_${i}_sbp`
            const defKey       = `topup_${i}_def`
            const isSbpLoading = paying === sbpKey
            const isDefLoading = paying === defKey
            const isAnyLoading = isSbpLoading || isDefLoading
            return (
              <div
                key={pkg.credits}
                className="card-dark rounded-2xl p-5 flex flex-col gap-3"
              >
                <div>
                  <p className="text-2xl font-extrabold text-slate-100">{pkg.credits.toLocaleString('ru-RU')}</p>
                  <p className="text-sm text-slate-400">{t('billing.credits_unit')}</p>
                </div>
                <p className="text-xl font-bold text-violet-300">
                  {currency === 'rub' ? `${pkg.priceRub.toLocaleString('ru-RU')} ₽` : `$${pkg.price}`}
                </p>
                <div className="flex flex-col gap-1.5">
                  {currency === 'rub' && (
                    <>
                      {/* Primary: SBP */}
                      <button
                        onClick={() => payWithYookassa(undefined, i, true)}
                        disabled={isAnyLoading}
                        className="w-full py-2.5 rounded-xl text-sm font-semibold text-white text-center transition-all hover:opacity-90 disabled:opacity-60 disabled:cursor-wait"
                        style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.85), rgba(37,99,235,0.85))', border: '1px solid rgba(124,58,237,0.4)' }}
                      >
                        {isSbpLoading ? t('billing.loading') : t('billing.pay_sbp')}
                      </button>
                      {/* Secondary: other YK methods */}
                      <button
                        onClick={() => payWithYookassa(undefined, i, false)}
                        disabled={isAnyLoading}
                        className="w-full py-2 rounded-xl text-xs font-medium text-slate-400 text-center transition-all hover:text-slate-200 disabled:opacity-60 disabled:cursor-wait"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                      >
                        {isDefLoading ? t('billing.loading') : t('billing.pay_other')}
                      </button>
                      <p className="text-center text-xs text-slate-400">{t('billing.methods_note')}</p>
                    </>
                  )}
                  {/* Tertiary: Telegram */}
                  <a
                    href={tgPayUrl(topupKeys[i])}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2 rounded-xl text-xs font-medium text-slate-500 text-center transition-all hover:text-slate-300 block"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    💬 {t('billing.topup_btn')}
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* How to receive order */}
      <div
        className="mt-8 rounded-2xl p-6"
        style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.18)' }}
      >
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">🎁</span>
          <h3 className="text-lg font-semibold text-slate-100">Как получить заказ</h3>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 text-sm text-slate-400">
          <div className="flex-1 flex gap-2.5">
            <span className="text-violet-400 mt-0.5 shrink-0">⚡</span>
            <span>После оплаты кредиты зачисляются на ваш баланс автоматически — обычно в течение нескольких минут.</span>
          </div>
          <div className="flex-1 flex gap-2.5">
            <span className="text-violet-400 mt-0.5 shrink-0">📁</span>
            <span>Результаты генерации (тексты, аудио, изображения, видео) доступны в личном кабинете для просмотра и скачивания.</span>
          </div>
          <div className="flex-1 flex gap-2.5">
            <span className="text-violet-400 mt-0.5 shrink-0">⏱</span>
            <span>Медиафайлы хранятся не менее 72 часов с момента создания — скачайте их своевременно.</span>
          </div>
        </div>
      </div>

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
              <p className="text-xs text-slate-500">{t('billing.methods_note')}</p>
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
          href="#plans"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.9), rgba(37,99,235,0.9))', border: '1px solid rgba(124,58,237,0.4)' }}
        >
          {t('billing.russia_btn_plans')}
        </a>
      </div>
    </div>
  )
}
