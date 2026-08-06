'use client'

import { useCallback } from 'react'
import { useLangStore } from '@/lib/lang-store'
import { tv2 } from '@/lib/i18n-v2'
import { PLAN_PRICES_RUB, PLAN_CREDITS } from '@/lib/types'
import { DISPLAY_PLANS, type DisplayPlan } from '@/components/landing-v2/data'
import { useInView, usePrefersReducedMotion } from '@/components/landing-v2/hooks/useMotion'

const POPULAR: DisplayPlan = 'starter'

function fmtCredits(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export default function PricingGlass() {
  const { lang } = useLangStore()
  const tv = useCallback((k: string) => tv2(k, lang), [lang])
  const [sectionRef, inView] = useInView<HTMLElement>()
  const reduced = usePrefersReducedMotion()

  return (
    <section
      ref={sectionRef}
      style={{
        background: 'var(--v2-bg)',
        padding: 'var(--lv2-py-section) var(--lv2-px-content)',
        borderTop: '1px solid var(--v2-border)',
      }}
    >
      <div className="lv2-asym">
        {/* ── Left: section label ─────────────────────────────────────── */}
        <div style={{ paddingTop: 4 }}>
          <p style={{
            fontSize: 11, fontWeight: 500, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--v2-accent)', marginBottom: 14,
            fontFamily: 'var(--font-geist-sans, sans-serif)',
          }}>
            {tv('v2.pricing_tag')}
          </p>
          <h2 style={{
            fontFamily: 'var(--font-fraunces, serif)',
            fontSize: 'clamp(24px, 3.5vw, 42px)', fontWeight: 700,
            color: 'var(--v2-text)', marginBottom: 12, letterSpacing: '-0.02em', lineHeight: 1.2,
          }}>
            {tv('v2.pricing_title')}
          </h2>
          <p style={{
            fontSize: 14, color: 'var(--v2-text-sec)', lineHeight: 1.7,
            fontFamily: 'var(--font-geist-sans, sans-serif)', maxWidth: 280,
          }}>
            {tv('v2.pricing_sub')}
          </p>
        </div>

        {/* ── Right: pricing cards ─────────────────────────────────────── */}
        <div>
      <div className="lv2-pricing-grid">
        {DISPLAY_PLANS.map((plan, i) => {
          const isFree    = plan === 'free'
          const isPopular = plan === POPULAR
          const priceRub  = isFree ? null : PLAN_PRICES_RUB[plan as Exclude<DisplayPlan, 'free'>]
          const credits   = PLAN_CREDITS[plan]

          return (
            <div
              key={plan}
              style={{
                position: 'relative',
                borderRadius: 16,
                border: isPopular
                  ? '1px solid rgba(232,160,32,0.55)'
                  : '1px solid var(--v2-border)',
                backdropFilter: 'blur(14px) saturate(1.2)',
                WebkitBackdropFilter: 'blur(14px) saturate(1.2)',
                background: isPopular
                  ? 'rgba(232,160,32,0.07)'
                  : 'rgba(255,255,255,0.03)',
                padding: '30px 24px',
                display: 'flex', flexDirection: 'column', gap: 8,
                opacity: inView ? 1 : 0,
                transform: inView ? 'translateY(0)' : 'translateY(22px)',
                transition: reduced
                  ? 'none'
                  : `opacity 400ms ease ${i * 80}ms, transform 400ms ease ${i * 80}ms`,
              }}
            >
              {isPopular && (
                <span style={{
                  position: 'absolute', top: -13, left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'var(--v2-accent)', color: '#0E0E0E',
                  fontSize: 11, fontWeight: 700, padding: '3px 14px',
                  borderRadius: 20, whiteSpace: 'nowrap',
                  fontFamily: 'var(--font-geist-sans, sans-serif)',
                }}>
                  {tv('v2.pricing_popular')}
                </span>
              )}

              <p style={{
                fontSize: 12, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--v2-text-sec)',
                fontFamily: 'var(--font-geist-sans, sans-serif)',
              }}>
                {isFree
                  ? tv('v2.pricing_free_name')
                  : plan.charAt(0).toUpperCase() + plan.slice(1)}
              </p>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 4, flexWrap: 'nowrap' }}>
                {isFree ? (
                  <span style={{
                    fontFamily: 'var(--font-fraunces, serif)',
                    fontSize: 36, fontWeight: 700, color: 'var(--v2-text)',
                  }}>
                    {tv('v2.pricing_free_price')}
                  </span>
                ) : (
                  <>
                    <span style={{
                      fontFamily: 'var(--font-fraunces, serif)',
                      fontSize: 36, fontWeight: 700, lineHeight: 1,
                      color: 'var(--v2-text)', fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}>
                      {priceRub?.toLocaleString('ru')} ₽
                    </span>
                    <span style={{
                      fontSize: 13, color: 'var(--v2-text-sec)',
                      fontFamily: 'var(--font-geist-sans, sans-serif)',
                      whiteSpace: 'nowrap',
                    }}>
                      {tv('v2.pricing_mo')}
                    </span>
                  </>
                )}
              </div>

              <p style={{
                fontSize: 13, color: 'var(--v2-text-sec)',
                fontFamily: 'var(--font-geist-sans, sans-serif)',
                marginTop: 4, marginBottom: 18,
              }}>
                {fmtCredits(credits)}{' '}
                {isFree ? tv('v2.pricing_credits_once') : tv('v2.pricing_credits_mo')}
              </p>

              <a
                href="/auth/register"
                style={{
                  marginTop: 'auto', display: 'block', textAlign: 'center',
                  padding: '11px 0', borderRadius: 10,
                  fontSize: 14, fontWeight: 600,
                  textDecoration: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-geist-sans, sans-serif)',
                  transition: 'opacity 150ms ease',
                  ...(isFree
                    ? { border: '1px solid var(--v2-border)', color: 'var(--v2-text)', background: 'transparent' }
                    : isPopular
                    ? { background: 'var(--v2-accent)', color: '#0E0E0E', border: 'none' }
                    : { border: '1px solid rgba(232,160,32,0.38)', color: 'var(--v2-accent)', background: 'transparent' }),
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.8' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
              >
                {isFree ? tv('v2.pricing_cta_free') : tv('v2.pricing_cta_paid')}
              </a>
            </div>
          )
        })}
      </div>
        </div>  {/* right col */}
      </div>  {/* lv2-asym */}
    </section>
  )
}
