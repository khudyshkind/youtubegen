'use client'

import { useRef, useEffect, useCallback } from 'react'
import { useLangStore } from '@/lib/lang-store'
import { tv2 } from '@/lib/i18n-v2'
import { t } from '@/lib/i18n'
import { STUDIO_STEPS } from '@/lib/content-config'
import { PIPE_DESC_KEYS } from '@/components/landing-v2/data'
import { usePrefersReducedMotion } from '@/components/landing-v2/hooks/useMotion'

export default function PipelineTitles() {
  const { lang } = useLangStore()
  const tv = useCallback((k: string) => tv2(k, lang), [lang])
  const tl = useCallback((k: string) => t(k, lang), [lang])
  const sectionRef = useRef<HTMLElement>(null)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    const steps = section.querySelectorAll<HTMLElement>('.lv2c-pipe-step')

    if (reduced) {
      steps.forEach(el => el.classList.add('lv2c-in'))
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('lv2c-in')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    )

    steps.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [reduced])

  return (
    <section
      ref={sectionRef}
      style={{
        background: 'var(--v2-bg)',
        padding: 'clamp(64px, 8vw, 100px) clamp(20px, 4vw, 64px)',
        borderTop: '1px solid var(--v2-border)',
      }}
    >
      {/* Section header */}
      <div style={{ marginBottom: 'clamp(36px, 5vw, 60px)' }}>
        <p style={{
          fontSize: 11, fontWeight: 500, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--v2-accent)',
          marginBottom: 12, fontFamily: 'var(--font-geist-sans, sans-serif)',
        }}>
          {tv('v2.pipe_tag')}
        </p>
        <h2 style={{
          fontFamily: 'var(--font-fraunces, serif)',
          fontSize: 'clamp(28px, 4vw, 52px)', fontWeight: 700,
          color: 'var(--v2-text)', letterSpacing: '-0.02em', margin: 0,
        }}>
          {tv('v2.pipe_title')}
        </h2>
      </div>

      {/* Steps — large typography */}
      <div role="list">
        {STUDIO_STEPS.map((step, i) => (
          <div
            key={step.labelKey}
            role="listitem"
            className="lv2c-pipe-step"
            style={{ transitionDelay: `${i * 40}ms` }}
          >
            {/* Step number */}
            <span style={{
              fontSize: 12, fontWeight: 500, letterSpacing: '0.1em',
              color: 'var(--v2-accent)', fontFamily: 'var(--font-geist-sans, monospace)',
              flexShrink: 0, paddingTop: 8, minWidth: 28,
            }}>
              {String(i + 1).padStart(2, '0')}
            </span>

            {/* Step content */}
            <div style={{ flex: 1 }}>
              <h3 style={{
                fontFamily: 'var(--font-fraunces, serif)',
                fontSize: 'clamp(26px, 4.5vw, 56px)',
                fontWeight: 700, color: 'var(--v2-text)',
                letterSpacing: '-0.02em', lineHeight: 1.1, margin: '0 0 8px',
              }}>
                {tl(step.labelKey)}
              </h3>
              <p style={{
                fontSize: 14, lineHeight: 1.6,
                color: 'var(--v2-text-sec)',
                fontFamily: 'var(--font-geist-sans, sans-serif)',
              }}>
                {tv(PIPE_DESC_KEYS[i])}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
