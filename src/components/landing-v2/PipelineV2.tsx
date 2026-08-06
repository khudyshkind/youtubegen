'use client'

import { useCallback }      from 'react'
import { useLangStore }     from '@/lib/lang-store'
import { tv2 }              from '@/lib/i18n-v2'
import { t }                from '@/lib/i18n'
import { STUDIO_STEPS }     from '@/lib/content-config'
import { PIPE_DESC_KEYS }   from '@/components/landing-v2/data'
import { useInView, usePrefersReducedMotion } from '@/components/landing-v2/hooks/useMotion'

// SVG icons per step — no emoji (STUDIO_STEPS.icon is emoji, not used here)
const STEP_ICONS = [
  <svg key="1" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 5 11.95V17H7v-3.05A7 7 0 0 1 12 2z"/>
  </svg>,
  <svg key="2" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
    <circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>
  </svg>,
  <svg key="3" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/>
  </svg>,
  <svg key="4" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="11" rx="3"/>
    <path d="M5 10a7 7 0 0 0 14 0M12 19v3M9 22h6"/>
  </svg>,
  <svg key="5" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="2"/>
    <line x1="6" y1="11" x2="18" y2="11"/><line x1="6" y1="15" x2="12" y2="15"/>
  </svg>,
  <svg key="6" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="m3 15 5-5 4 4 3-3 5 4"/><circle cx="8.5" cy="8.5" r="1.5"/>
  </svg>,
  <svg key="7" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="2"/>
    <line x1="7" y1="5" x2="7" y2="19"/><line x1="17" y1="5" x2="17" y2="19"/>
    <line x1="2" y1="10" x2="22" y2="10"/><line x1="2" y1="15" x2="22" y2="15"/>
  </svg>,
  <svg key="8" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="7.5"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>
  </svg>,
]

export default function PipelineV2() {
  const { lang } = useLangStore()
  const tv = useCallback((k: string) => tv2(k, lang), [lang])
  const tl = useCallback((k: string) => t(k, lang), [lang])
  const [stepsRef, inView] = useInView<HTMLDivElement>()
  const reduced = usePrefersReducedMotion()

  return (
    <section style={{
      borderTop: '1px solid var(--v2-border)',
      background: 'var(--v2-surface)',
    }}>
      {/* Sticky section header */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: 'var(--v2-surface)',
        borderBottom: '1px solid var(--v2-border)',
        padding: 'clamp(18px, 2.5vw, 28px) clamp(20px, 4vw, 64px)',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        flexWrap: 'wrap',
      }}>
        <p style={{
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--v2-accent)',
          fontFamily: 'var(--font-geist-sans, sans-serif)',
          flexShrink: 0,
        }}>
          {tv('v2.pipe_tag')}
        </p>
        <h2 style={{
          fontFamily: 'var(--font-fraunces, serif)',
          fontSize: 'clamp(20px, 2.5vw, 32px)',
          fontWeight: 700,
          color: 'var(--v2-text)',
          margin: 0,
          letterSpacing: '-0.01em',
        }}>
          {tv('v2.pipe_title')}
        </h2>
        <p style={{
          fontSize: 13,
          color: 'var(--v2-text-sec)',
          fontFamily: 'var(--font-geist-sans, sans-serif)',
          marginLeft: 'auto',
        }}>
          {tv('v2.pipe_sub')}
        </p>
      </div>

      {/* Horizontal step strip */}
      <div
        ref={stepsRef}
        role="list"
        className="lv2-pipe-steps"
        style={{
          display: 'flex',
          overflowX: 'auto',
          padding: 'clamp(24px, 4vw, 40px) clamp(20px, 4vw, 64px)',
          gap: 0,
        }}
      >
        {STUDIO_STEPS.map((step, i) => {
          const descKey = PIPE_DESC_KEYS[i]
          const isLast = i === STUDIO_STEPS.length - 1

          return (
            <div
              key={step.labelKey}
              role="listitem"
              style={{
                flex: '0 0 auto',
                width: 'clamp(148px, 14vw, 190px)',
                paddingRight: isLast ? 0 : 'clamp(16px, 2vw, 24px)',
                marginRight: isLast ? 0 : 'clamp(16px, 2vw, 24px)',
                borderRight: isLast ? 'none' : '1px solid var(--v2-border)',
                opacity: inView ? 1 : 0,
                transform: inView ? 'translateY(0)' : 'translateY(14px)',
                transition: reduced
                  ? 'none'
                  : `opacity 320ms ease ${i * 55}ms, transform 320ms ease ${i * 55}ms`,
              }}
            >
              <p style={{
                fontSize: 11,
                color: 'var(--v2-accent)',
                fontFamily: 'var(--font-geist-sans, monospace)',
                letterSpacing: '0.08em',
                marginBottom: 10,
                fontWeight: 500,
              }}>
                {String(i + 1).padStart(2, '0')}
              </p>

              <div style={{ color: 'var(--v2-text-sec)', marginBottom: 12 }}>
                {STEP_ICONS[i]}
              </div>

              <p style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--v2-text)',
                fontFamily: 'var(--font-geist-sans, sans-serif)',
                marginBottom: 6,
                lineHeight: 1.3,
              }}>
                {tl(step.labelKey)}
              </p>

              <p style={{
                fontSize: 12,
                color: 'var(--v2-text-sec)',
                fontFamily: 'var(--font-geist-sans, sans-serif)',
                lineHeight: 1.55,
              }}>
                {tv(descKey)}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
