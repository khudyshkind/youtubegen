'use client'

import { useCallback }     from 'react'
import { useLangStore }    from '@/lib/lang-store'
import { tv2 }             from '@/lib/i18n-v2'
import {
  PLAN_PRICES_RUB,
  PLAN_CREDITS,
}                          from '@/lib/types'           // types.ts:130, :115
import {
  DISPLAY_PLANS,
  type DisplayPlan,
}                          from '@/components/landing-v2/data'
import { useInView, usePrefersReducedMotion } from '@/components/landing-v2/hooks/useMotion'

const POPULAR_PLAN: DisplayPlan = 'starter'

function formatCredits(n: number): string {
  return n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
    : n >= 1000
    ? `${(n / 1000).toFixed(0)}K`
    : String(n)
}

export default function PricingV2() {
  const { lang } = useLangStore()
  const tv = useCallback((k: string) => tv2(k, lang), [lang])
  const [sectionRef, inView] = useInView<HTMLElement>()
  const reduced = usePrefersReducedMotion()

  return (
    <section
      ref={sectionRef}
      style={{
        background: 'var(--v2-surface)',
        padding: 'clamp(64px, 8vw, 96px) clamp(20px, 4vw, 64px)',
        borderTop: '1px solid var(--v2-border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <p style={{
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--v2-accent)',
        marginBottom: 12,
        fontFamily: 'var(--font-geist-sans, sans-serif)',
      }}>
        {tv('v2.pricing_tag')}
      </p>
      <h2 style={{
        fontFamily: 'var(--font-fraunces, serif)',
        fontSize: 'clamp(28px, 4vw, 52px)',
        fontWeight: 700,
        color: 'var(--v2-text)',
        textAlign: 'center',
        marginBottom: 8,
        letterSpacing: '-0.02em',
      }}>
        {tv('v2.pricing_title')}
      </h2>
      <p style={{
        fontSize: 15,
        color: 'var(--v2-text-sec)',
        textAlign: 'center',
        marginBottom: 52,
        fontFamily: 'var(--font-geist-sans, sans-serif)',
      }}>
        {tv('v2.pricing_sub')}
      </p>

      {/* Pricing grid — PLAN_PRICES_RUB: types.ts:130; PLAN_CREDITS: types.ts:115 */}
      <div className="lv2-pricing-grid" style={{ width: '100%', maxWidth: 900 }}>
        {DISPLAY_PLANS.map((plan, i) => {
          const isFree    = plan === 'free'
          const isPopular = plan === POPULAR_PLAN
          const priceRub  = isFree ? null : PLAN_PRICES_RUB[plan as Exclude<DisplayPlan, 'free'>]
          const credits   = PLAN_CREDITS[plan]

          return (
            <div
              key={plan}
              style={{
                background: 'var(--v2-bg)',
                borderRadius: 14,
                border: isPopular ? '1px solid var(--v2-accent)' : '1px solid var(--v2-border)',
                ...(isPopular ? { background: 'rgba(232,160,32,0.04)' } : {}),
                padding: '28px 22px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                position: 'relative',
                opacity: inView ? 1 : 0,
                transform: inView ? 'translateY(0)' : 'translateY(16px)',
                transition: reduced
                  ? 'none'
                  : `opacity 340ms ease ${i * 70}ms, transform 340ms ease ${i * 70}ms`,
              }}
            >
              {isPopular && (
                <span style={{
                  position: 'absolute',
                  top: -12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'var(--v2-accent)',
                  color: '#0E0E0E',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 12px',
                  borderRadius: 20,
                  whiteSpace: 'nowrap',
                  fontFamily: 'var(--font-geist-sans, sans-serif)',
                }}>
                  {tv('v2.pricing_popular')}
                </span>
              )}

              <p style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--v2-text-sec)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontFamily: 'var(--font-geist-sans, sans-serif)',
                marginBottom: 4,
              }}>
                {isFree
                  ? tv('v2.pricing_free_name')
                  : plan.charAt(0).toUpperCase() + plan.slice(1)}
              </p>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                {isFree ? (
                  <span style={{
                    fontFamily: 'var(--font-fraunces, serif)',
                    fontSize: 36,
                    fontWeight: 700,
                    color: 'var(--v2-text)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {tv('v2.pricing_free_price')}
                  </span>
                ) : (
                  <>
                    <span style={{
                      fontFamily: 'var(--font-fraunces, serif)',
                      fontSize: 36,
                      fontWeight: 700,
                      lineHeight: 1,
                      color: 'var(--v2-text)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {priceRub?.toLocaleString('ru')} ₽
                    </span>
                    <span style={{
                      fontSize: 13,
                      color: 'var(--v2-text-sec)',
                      fontFamily: 'var(--font-geist-sans, sans-serif)',
                    }}>
                      {tv('v2.pricing_mo')}
                    </span>
                  </>
                )}
              </div>

              <p style={{
                fontSize: 13,
                color: 'var(--v2-text-sec)',
                fontFamily: 'var(--font-geist-sans, sans-serif)',
                marginTop: 4,
                marginBottom: 16,
              }}>
                {formatCredits(credits)}{' '}
                {isFree ? tv('v2.pricing_credits_once') : tv('v2.pricing_credits_mo')}
              </p>

              <a
                href="/auth/register"
                style={{
                  marginTop: 'auto',
                  display: 'block',
                  textAlign: 'center',
                  padding: '10px 0',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textDecoration: 'none',
                  fontFamily: 'var(--font-geist-sans, sans-serif)',
                  transition: 'opacity 150ms ease',
                  ...(isFree
                    ? { border: '1px solid var(--v2-border)', color: 'var(--v2-text)', background: 'transparent' }
                    : isPopular
                    ? { background: 'var(--v2-accent)', color: '#0E0E0E', border: 'none' }
                    : { border: '1px solid rgba(232,160,32,0.4)', color: 'var(--v2-accent)', background: 'transparent' }),
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
    </section>
  )
}
