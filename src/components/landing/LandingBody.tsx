'use client'

import Link from 'next/link'
import HeroSection from './HeroSection'
import RevealInit from './RevealInit'
import TiltInit from './TiltInit'
import CursorGlow from './CursorGlow'
import ScrollProgress from './ScrollProgress'
import AnimatedCounter from './AnimatedCounter'
import FaqAccordion from './FaqAccordion'
import { useLang } from '@/hooks/useLang'
import { PLAN_CREDITS, PLAN_PRICES, PLAN_PRICES_RUB } from '@/lib/types'

const BG = '#0A0A0F'
const DIV_LINE = '1px solid rgba(255,255,255,0.05)'

export default function LandingBody() {
  const { t, lang } = useLang()

  const STEPS = [
    { n: '01', icon: '💡', title: t('landing.step1_title'), desc: t('landing.step1_desc') },
    { n: '02', icon: '🗂️', title: t('landing.step2_title'), desc: t('landing.step2_desc') },
    { n: '03', icon: '✍️', title: t('landing.step3_title'), desc: t('landing.step3_desc') },
    { n: '04', icon: '🎙️', title: t('landing.step4_title'), desc: t('landing.step4_desc') },
    { n: '05', icon: '📋', title: t('landing.step5_title'), desc: t('landing.step5_desc') },
    { n: '06', icon: '🖼️', title: t('landing.step6_title'), desc: t('landing.step6_desc') },
    { n: '07', icon: '🎬', title: t('landing.step7_title'), desc: t('landing.step7_desc') },
    { n: '08', icon: '🔍', title: t('landing.step8_title'), desc: t('landing.step8_desc') },
  ]

  const BENEFITS = [
    { icon: '⚡', title: t('landing.benefit1_title'), desc: t('landing.benefit1_desc') },
    { icon: '🌍', title: t('landing.benefit2_title'), desc: t('landing.benefit2_desc') },
    { icon: '🎙️', title: t('landing.benefit3_title'), desc: t('landing.benefit3_desc') },
    { icon: '🖼️', title: t('landing.benefit4_title'), desc: t('landing.benefit4_desc') },
    { icon: '📊', title: t('landing.benefit5_title'), desc: t('landing.benefit5_desc') },
    { icon: '💰', title: t('landing.benefit6_title'), desc: t('landing.benefit6_desc') },
  ]

  const BOT = `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME ?? 'lefiro_bot'}`
  const tgPlan = (id: string) => `${BOT}?start=plan_${id}`
  // Set to true when the demo video is ready
  const SHOW_DEMO_SECTION = false

  const PLANS = [
    {
      name: 'Free',
      isFree: true,
      credits: PLAN_CREDITS['free'],
      features: [t('billing.f_script'), t('billing.f_voice_openai'), t('billing.f_2_images'), t('billing.f_all_tools')],
      cta: t('landing.plan_cta_free'),
      href: '/auth/register',
      highlight: false,
    },
    {
      name: 'Basic',
      isFree: false,
      priceUsd: PLAN_PRICES['basic'],
      priceRub: PLAN_PRICES_RUB['basic'],
      credits: PLAN_CREDITS['basic'],
      features: [t('billing.f_credits_basic'), t('billing.f_all_tools'), t('billing.f_voices_3')],
      cta: t('landing.plan_cta_basic'),
      href: tgPlan('basic'),
      highlight: false,
    },
    {
      name: 'Starter',
      isFree: false,
      priceUsd: PLAN_PRICES['starter'],
      priceRub: PLAN_PRICES_RUB['starter'],
      credits: PLAN_CREDITS['starter'],
      features: [t('billing.f_credits_100'), t('billing.f_all_tools'), t('billing.f_analytics')],
      cta: t('landing.plan_cta_starter'),
      href: tgPlan('starter'),
      highlight: true,
    },
    {
      name: 'Pro',
      isFree: false,
      priceUsd: PLAN_PRICES['pro'],
      priceRub: PLAN_PRICES_RUB['pro'],
      credits: PLAN_CREDITS['pro'],
      features: [t('billing.f_credits_300'), t('billing.f_all_tools'), t('billing.f_priority_support')],
      cta: t('landing.plan_cta_pro'),
      href: tgPlan('pro'),
      highlight: false,
    },
    {
      name: 'Agency',
      isFree: false,
      priceUsd: PLAN_PRICES['agency'],
      priceRub: PLAN_PRICES_RUB['agency'],
      credits: PLAN_CREDITS['agency'],
      features: [t('billing.f_credits_1000'), t('billing.f_all_tools'), t('billing.f_dedicated_support')],
      cta: t('landing.plan_cta_agency'),
      href: tgPlan('agency'),
      highlight: false,
    },
  ]

  const TESTIMONIALS = [
    { text: t('landing.review1_text'), name: t('landing.review1_name'), role: t('landing.review1_role') },
    { text: t('landing.review2_text'), name: t('landing.review2_name'), role: t('landing.review2_role') },
    { text: t('landing.review3_text'), name: t('landing.review3_name'), role: t('landing.review3_role') },
  ]

  return (
    <div className="flex flex-col" style={{ background: BG }}>

      <RevealInit />
      <TiltInit />
      <CursorGlow />
      <ScrollProgress />

      {/* ── Hero ──────────────────────────────────────────── */}
      <HeroSection />

      {/* ── How it works ──────────────────────────────────── */}
      <section id="how-it-works" className="py-28 relative" style={{ background: BG }}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 reveal">
            <p className="text-violet-400 text-sm font-semibold uppercase tracking-widest mb-3">{t('landing.pipeline_tag')}</p>
            <h2 className="text-5xl font-extrabold gradient-text mb-4">{t('landing.pipeline_h2')}</h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">{t('landing.pipeline_sub')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {STEPS.map((step, i) => (
              <div
                key={step.n}
                data-tilt
                className="card-dark rounded-2xl p-6 reveal-left"
                style={{ transitionDelay: `${i * 70}ms` }}
              >
                <div className="flex items-start justify-between mb-4">
                  <span className="text-3xl">{step.icon}</span>
                  <span className="text-4xl font-black leading-none select-none" style={{ color: 'rgba(124,58,237,0.2)' }}>
                    {step.n}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-slate-100 mb-2">{step.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-12 reveal">
            <Link href="/auth/register" className="btn-gradient inline-block px-8 py-3.5 text-white font-semibold rounded-xl">
              {t('landing.cta_btn')}
            </Link>
          </div>
        </div>
      </section>

      {/* ── Benefits ──────────────────────────────────────── */}
      <section className="py-28 relative" style={{ background: 'linear-gradient(to bottom, #0A0A0F, #0D0B16, #0A0A0F)' }}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-px bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 reveal">
            <p className="text-blue-400 text-sm font-semibold uppercase tracking-widest mb-3">{t('landing.benefits_tag')}</p>
            <h2 className="text-5xl font-extrabold gradient-text mb-4">{t('landing.benefits_why')}</h2>
            <p className="text-xl text-slate-400">{t('landing.benefits_why_sub')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {BENEFITS.map((b, i) => (
              <div
                key={b.icon}
                data-tilt
                className="card-dark rounded-2xl p-7 reveal"
                style={{ transitionDelay: `${i * 90}ms` }}
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4"
                  style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)' }}
                >
                  {b.icon}
                </div>
                <h3 className="text-lg font-semibold text-slate-100 mb-2">{b.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Demo ──────────────────────────────────────────── */}
      {SHOW_DEMO_SECTION && <section className="py-28" style={{ background: BG }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10 reveal">
            <p className="text-pink-400 text-sm font-semibold uppercase tracking-widest mb-3">{t('landing.demo_tag')}</p>
            <h2 className="text-5xl font-extrabold gradient-text mb-4">{t('landing.demo_h2')}</h2>
            <p className="text-xl text-slate-400">{t('landing.demo_sub')}</p>
          </div>

          <div
            className="reveal rounded-3xl overflow-hidden aspect-video flex items-center justify-center mb-4"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 0 80px rgba(124,58,237,0.1)' }}
          >
            <div className="text-center px-4">
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)' }}>
                <svg className="w-10 h-10 text-violet-400 ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <p className="text-slate-300 font-medium text-lg mb-1">{t('landing.demo_coming')}</p>
              <p className="text-slate-600 text-sm">{t('landing.demo_hint')}</p>
              <Link href="/auth/register" className="btn-gradient inline-block mt-5 px-6 py-2.5 text-white text-sm font-semibold rounded-xl">
                {t('landing.demo_cta')}
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-8 gap-2 reveal">
            {STEPS.map((step) => (
              <div key={step.n} className="card-dark rounded-xl p-2 sm:p-3 text-center">
                <div className="text-lg sm:text-2xl mb-1">{step.icon}</div>
                <div className="text-xs text-slate-600 font-medium leading-tight hidden sm:block">{step.title}</div>
              </div>
            ))}
          </div>
        </div>
      </section>}

      {/* ── Analytics ────────────────────────────────────── */}
      <section className="py-28 relative" style={{ background: 'linear-gradient(to bottom, #0A0A0F, #0D0B16, #0A0A0F)' }}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 reveal">
            <p className="text-emerald-400 text-sm font-semibold uppercase tracking-widest mb-3">{t('landing.analytics_tag')}</p>
            <h2 className="text-5xl font-extrabold gradient-text mb-4">{t('landing.analytics_h2')}</h2>
            <p className="text-xl text-slate-400">{t('landing.analytics_sub')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { icon: '🎯', title: t('landing.analytics_card1_title'), desc: t('landing.analytics_card1_desc') },
              { icon: '🚀', title: t('landing.analytics_card2_title'), desc: t('landing.analytics_card2_desc') },
              { icon: '📈', title: t('landing.analytics_card3_title'), desc: t('landing.analytics_card3_desc') },
              { icon: '📊', title: t('landing.analytics_card4_title'), desc: t('landing.analytics_card4_desc') },
              { icon: '⭐', title: t('landing.analytics_card5_title'), desc: t('landing.analytics_card5_desc') },
            ].map((card, i) => (
              <div
                key={card.icon}
                data-tilt
                className="card-dark rounded-2xl p-6 reveal"
                style={{ transitionDelay: `${i * 80}ms` }}
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4"
                  style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.2)' }}
                >
                  {card.icon}
                </div>
                <h3 className="text-lg font-semibold text-slate-100 mb-2">{card.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{card.desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-12 reveal">
            <Link href="/auth/register" className="btn-ghost-dark inline-block px-8 py-3.5 text-sm font-semibold rounded-xl">
              {t('landing.cta_btn')}
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stats bar ─────────────────────────────────────── */}
      <div
        className="py-14"
        style={{ background: 'rgba(124,58,237,0.05)', borderTop: '1px solid rgba(124,58,237,0.15)', borderBottom: '1px solid rgba(124,58,237,0.15)' }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-white/[0.06] text-center reveal">
            {[
              { to: 100, suffix: '+', label: t('landing.stats_users_label') },
              { to: 500, suffix: '+', label: t('landing.stats_videos_label') },
              { to: 28,  suffix: '',  label: t('landing.stats_langs') },
              { to: 10,  suffix: t('landing.stats_avg_sfx'), label: t('landing.stats_avg') },
            ].map((s) => (
              <div key={s.to} className="px-6 py-2">
                <div className="text-4xl font-extrabold text-slate-100">
                  <AnimatedCounter to={s.to} suffix={s.suffix} duration={1200} />
                </div>
                <div className="text-sm text-slate-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Testimonials ──────────────────────────────────── */}
      <section className="py-28" style={{ background: BG }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14 reveal">
            <h2 className="text-5xl font-extrabold gradient-text mb-3">{t('landing.testimonials_h2b')}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {TESTIMONIALS.map((rev, i) => (
              <div
                key={i}
                data-tilt
                className="card-dark rounded-2xl p-6 flex flex-col gap-4 reveal"
                style={{ transitionDelay: `${i * 110}ms` }}
              >
                <div className="flex gap-1">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <svg key={j} className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
                <p className="text-slate-400 text-sm leading-relaxed flex-1">&ldquo;{rev.text}&rdquo;</p>
                <div>
                  <p className="text-sm font-semibold text-slate-200">{rev.name}</p>
                  <p className="text-xs text-slate-600">{rev.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────── */}
      <section id="pricing" className="py-28 relative" style={{ background: 'linear-gradient(to bottom, #0A0A0F, #0D0B18, #0A0A0F)' }}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 reveal">
            <p className="text-violet-400 text-sm font-semibold uppercase tracking-widest mb-3">{t('landing.pricing_tag')}</p>
            <h2 className="text-5xl font-extrabold gradient-text mb-4">{t('landing.pricing_h2')}</h2>
            <p className="text-xl text-slate-400">{t('landing.pricing_sub')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-start pt-5">
            {PLANS.map((plan, i) => (
              <div key={plan.name} className="relative pt-4">
                {plan.highlight && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10">
                    <span className="text-white text-xs font-bold px-4 py-1.5 rounded-full whitespace-nowrap" style={{ background: 'linear-gradient(135deg, #7C3AED, #2563EB)' }}>
                      {t('landing.plan_popular')}
                    </span>
                  </div>
                )}
                <div
                  data-tilt
                  className={`relative rounded-2xl p-6 flex flex-col gap-5 reveal ${plan.highlight ? 'pro-card-glow' : 'card-dark'}`}
                  style={{
                    transitionDelay: `${i * 80}ms`,
                    ...(plan.highlight ? { background: 'rgba(124,58,237,0.08)' } : {}),
                  }}
                >
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{plan.name}</p>
                  {plan.isFree ? (
                    <div className="flex items-end gap-1">
                      <span className="text-3xl font-extrabold text-slate-100">
                        {t('landing.plan_free_price')}
                      </span>
                    </div>
                  ) : lang === 'ru' ? (
                    <div className="flex items-end gap-1">
                      <span className="text-4xl font-extrabold text-slate-100">{(plan.priceRub ?? 0).toLocaleString('ru-RU')} ₽</span>
                      <span className="text-slate-500 mb-1 text-sm">{t('landing.period')}</span>
                    </div>
                  ) : (
                    <div className="flex items-end gap-1">
                      <span className="text-4xl font-extrabold text-slate-100">${plan.priceUsd}</span>
                      <span className="text-slate-500 mb-1 text-sm">{t('landing.period')}</span>
                    </div>
                  )}
                  <p className="text-xs text-violet-400 font-semibold mt-1">
                    {plan.credits.toLocaleString('ru-RU')} {plan.isFree ? t('landing.plan_credits_once') : t('landing.plan_credits_mo')}
                  </p>
                </div>
                <ul className="flex flex-col gap-2 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-xs text-slate-400">
                      <svg className="w-3.5 h-3.5 text-violet-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                {plan.highlight ? (
                  <Link href={plan.href} className="btn-gradient mt-auto w-full py-3 rounded-xl text-xs font-semibold text-center text-white">
                    {plan.cta}
                  </Link>
                ) : (
                  <Link href={plan.href} className="btn-ghost-dark mt-auto w-full py-3 rounded-xl text-xs font-semibold text-center">
                    {plan.cta}
                  </Link>
                )}
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-10 space-y-2 reveal">
            <p className="text-slate-300 font-medium">
              🎁 <span className="text-violet-400 font-semibold">{t('landing.free_credits')}</span> {t('landing.free_credits_suffix')}
            </p>
            <p className="text-sm text-slate-600">{t('landing.credits_note')}</p>
          </div>

          {/* How to receive order — public delivery info */}
          <div
            className="mt-10 rounded-2xl p-6 reveal"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">📦</span>
              <h3 className="text-xl font-semibold text-slate-100">
                {lang === 'ru' ? 'Как получить заказ' : 'How to receive your order'}
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-start gap-3">
                <span className="text-xl mt-0.5">💻</span>
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    {lang === 'ru' ? 'Всё цифровое' : 'Fully digital'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {lang === 'ru'
                      ? 'Результаты доступны сразу в личном кабинете — физическая доставка не требуется'
                      : 'Results appear instantly in your account — no physical delivery required'}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-xl mt-0.5">⬇️</span>
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    {lang === 'ru' ? 'Скачивание файлов' : 'Download files'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {lang === 'ru'
                      ? 'Аудио, видео и изображения можно скачать прямо из интерфейса'
                      : 'Audio, video and images can be downloaded directly from the interface'}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-xl mt-0.5">⏱️</span>
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    {lang === 'ru' ? 'Срок хранения' : 'Storage period'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {lang === 'ru'
                      ? 'Медиафайлы хранятся 72 часа — сохраняйте результаты сразу после создания'
                      : 'Media files are stored for 72 hours — save your results right after creation'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Russia payment block — RU locale only */}
          {lang === 'ru' && <div
            className="mt-10 rounded-2xl p-6 reveal"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">🇷🇺</span>
              <h3 className="text-xl font-semibold text-slate-100">{t('billing.russia_title')}</h3>
            </div>
            <p className="text-sm text-slate-400 mb-5">{t('billing.russia_desc')}</p>
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div
                className="flex-1 rounded-xl px-5 py-4 flex items-center gap-3"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                <span className="text-2xl">💳</span>
                <div>
                  <p className="text-sm font-medium text-slate-200">{t('billing.russia_mir')}</p>
                  <p className="text-xs text-slate-500">{t('billing.russia_mir_desc')}</p>
                </div>
              </div>
              <div
                className="flex-1 rounded-xl px-5 py-4 flex items-center gap-3"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                <span className="text-2xl">₿</span>
                <div>
                  <p className="text-sm font-medium text-slate-200">{t('billing.russia_crypto')}</p>
                  <p className="text-xs text-slate-500">{t('billing.russia_crypto_desc')}</p>
                </div>
              </div>
            </div>
            <a
              href="https://t.me/lefiro_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.9), rgba(37,99,235,0.9))', border: '1px solid rgba(124,58,237,0.4)' }}
            >
              {t('billing.russia_btn')}
            </a>
          </div>}
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────── */}
      <section id="faq" className="py-28" style={{ background: BG }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 reveal">
            <p className="text-blue-400 text-sm font-semibold uppercase tracking-widest mb-3">{t('landing.faq_tag')}</p>
            <h2 className="text-5xl font-extrabold gradient-text mb-4">{t('landing.faq_h2')}</h2>
          </div>
          <div className="reveal">
            <FaqAccordion />
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────── */}
      <section className="py-28 relative overflow-hidden" style={{ background: 'linear-gradient(to bottom, #0A0A0F, #0F0A1E)' }}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-violet-700/15 rounded-full filter blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[300px] bg-blue-700/10 rounded-full filter blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center reveal">
          <h2 className="text-4xl sm:text-5xl font-extrabold text-slate-100 mb-4 leading-tight">
            {t('landing.cta_h2_pre')}{' '}
            <span className="gradient-text">{t('landing.cta_gradient')}</span>
          </h2>
          <p className="text-xl text-slate-400 mb-10">{t('landing.cta_sub2')}</p>
          <Link href="/auth/register" className="btn-gradient inline-block px-10 py-4 text-white font-semibold rounded-2xl text-lg">
            {t('landing.cta_btn')}
          </Link>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-sm">
            <span className="text-slate-500">{t('landing.cta_free_badge')}</span>
            <span className="hidden sm:block w-px h-4 bg-white/10" />
            <span className="text-slate-500">{t('landing.cta_no_card')}</span>
            <span className="hidden sm:block w-px h-4 bg-white/10" />
            <span className="text-slate-500">{t('landing.cta_cancel')}</span>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────── */}
      <footer style={{ background: '#060608', borderTop: DIV_LINE }} className="py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 mb-8">
            <div>
              <div className="flex items-center gap-2 font-bold text-xl mb-1">
                <span className="text-slate-100">Lefiro</span>
              </div>
              <p className="text-slate-600 text-sm">{t('landing.footer_tagline')}</p>
            </div>
            <nav className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-slate-600">
                <a href="#how-it-works" className="hover:text-slate-300 transition-colors">{t('nav.how_it_works')}</a>
                <a href="#pricing"      className="hover:text-slate-300 transition-colors">{t('nav.pricing')}</a>
                <a href="#faq"          className="hover:text-slate-300 transition-colors">{t('nav.faq')}</a>
                <Link href="/auth/login"    className="hover:text-slate-300 transition-colors">{t('nav.login')}</Link>
                <Link href="/auth/register" className="hover:text-slate-300 transition-colors">{t('nav.register')}</Link>
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-slate-700">
                <Link href="/offer"   className="hover:text-slate-500 transition-colors">{t('nav.offer')}</Link>
                <Link href="/terms"   className="hover:text-slate-500 transition-colors">{t('nav.terms')}</Link>
                <Link href="/privacy" className="hover:text-slate-500 transition-colors">{t('nav.privacy')}</Link>
                <Link href="/refund"  className="hover:text-slate-500 transition-colors">{t('nav.refund')}</Link>
                <a href="mailto:support@lefiro.co" className="hover:text-slate-500 transition-colors">support@lefiro.co</a>
              </div>
            </nav>
          </div>
          <div className="pt-6" style={{ borderTop: DIV_LINE }}>
            <p className="text-slate-700 text-sm text-center">© 2026 Lefiro. {t('landing.footer_rights')}.</p>
          </div>
        </div>
      </footer>

    </div>
  )
}
