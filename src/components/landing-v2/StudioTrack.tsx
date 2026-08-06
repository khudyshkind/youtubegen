'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Studio section — Step 2 (placed after Analytics).
// Renders ALL 8 STUDIO_STEPS — no manual items.
// STUDIO_STEPS.length = 8 (verified via script).
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useEffect, useCallback } from 'react'
import { useLangStore } from '@/lib/lang-store'
import { tv2 } from '@/lib/i18n-v2'
import { t }  from '@/lib/i18n'
import { STUDIO_STEPS } from '@/lib/content-config'
import { PIPE_DESC_KEYS, pluralize } from '@/components/landing-v2/data'
import { usePrefersReducedMotion } from '@/components/landing-v2/hooks/useMotion'

export default function StudioTrack() {
  const { lang } = useLangStore()
  const tv = useCallback((k: string) => tv2(k, lang), [lang])
  const tl = useCallback((k: string) => t(k, lang), [lang])
  const sectionRef = useRef<HTMLElement>(null)
  const reduced    = usePrefersReducedMotion()

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    const steps = section.querySelectorAll<HTMLElement>('.lv2c-studio-step')
    if (reduced) { steps.forEach(s => s.classList.add('lv2c-in')); return }
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('lv2c-in'); observer.unobserve(e.target) } }),
      { threshold: 0.12, rootMargin: '0px 0px -32px 0px' },
    )
    steps.forEach(s => observer.observe(s))
    return () => observer.disconnect()
  }, [reduced])

  return (
    <section
      id="lv2c-section-studio"
      ref={sectionRef}
      style={{
        background: 'var(--v2-surface)',
        borderTop: '1px solid var(--v2-border)',
        padding: 'var(--lv2-py-section) var(--lv2-px-content)',
      }}
    >
      <div className="lv2-asym">
        {/* ── Left: section label ───────────────────────────────────────── */}
        <div style={{ paddingTop: 4 }}>
          <p style={{
            fontSize: 11, fontWeight: 500, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--v2-accent)',
            fontFamily: 'var(--font-geist-sans, sans-serif)', marginBottom: 14,
          }}>
            {tv('v2.studio_tag')}
          </p>
          <h2 style={{
            fontFamily: 'var(--font-fraunces, serif)',
            fontSize: 'clamp(24px, 3.5vw, 42px)',
            fontWeight: 700, color: 'var(--v2-text)',
            letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: 16,
          }}>
            {tv('v2.studio_title')}
          </h2>
          <p style={{
            fontSize: 14, lineHeight: 1.7,
            color: 'var(--v2-text-sec)',
            fontFamily: 'var(--font-geist-sans, sans-serif)',
            maxWidth: 280,
          }}>
            {STUDIO_STEPS.length}{' '}
            {pluralize(STUDIO_STEPS.length, lang,
              lang === 'ru' ? ['шаг', 'шага', 'шагов'] : ['step', 'steps', 'steps']
            )}{' — '}
            {tv('v2.studio_sub')}
          </p>
          <a
            href="/auth/register"
            style={{
              display: 'inline-block', marginTop: 28,
              padding: '11px 24px', borderRadius: 9,
              border: '1px solid rgba(232,160,32,0.35)',
              color: 'var(--v2-accent)', fontSize: 14, fontWeight: 600,
              textDecoration: 'none',
              fontFamily: 'var(--font-geist-sans, sans-serif)',
              transition: 'opacity 150ms ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.7' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            {tv('v2.calc_cta')}
          </a>
        </div>

        {/* ── Right: compact 8-element grid — 4 cols desktop, 2 tablet, 1 mobile (4×2 = 8 cells, no orphans) */}
        <div className="lv2c-studio-grid">
          {STUDIO_STEPS.map((step, i) => (
            <div
              key={step.labelKey}
              className="lv2c-studio-step"
              style={{ transitionDelay: `${i * 45}ms` }}
            >
              <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">
                {step.icon}
              </span>
              <p style={{
                fontFamily: 'var(--font-fraunces, serif)',
                fontSize: 15, fontWeight: 700, color: 'var(--v2-text)',
                lineHeight: 1.25, margin: 0,
              }}>
                {tl(step.labelKey)}
              </p>
              <p style={{
                fontSize: 11, lineHeight: 1.5, color: 'var(--v2-text-sec)',
                fontFamily: 'var(--font-geist-sans, sans-serif)', margin: 0,
              }}>
                {tv(PIPE_DESC_KEYS[i])}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
