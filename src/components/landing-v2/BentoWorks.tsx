'use client'

import { useState, useCallback }       from 'react'
import { useLangStore }                 from '@/lib/lang-store'
import { tv2 }                          from '@/lib/i18n-v2'
import { BENTO_ITEMS }                  from '@/components/landing-v2/data'
import { useInView, usePrefersReducedMotion } from '@/components/landing-v2/hooks/useMotion'

const SIZE_CLASS: Record<string, string> = {
  large:  'lv2-bento-large',
  medium: 'lv2-bento-medium',
  small:  'lv2-bento-small',
}

// Simple SVG icons per bento item (no emoji)
const ICONS = [
  // Studio pipeline
  <svg key="studio" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
  </svg>,
  // Voice / microphone
  <svg key="voice" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="11" rx="3"/>
    <path d="M5 10a7 7 0 0 0 14 0M12 19v3M9 22h6"/>
  </svg>,
  // SEO / target
  <svg key="seo" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>
    <line x1="12" y1="3" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21"/>
    <line x1="3" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21" y2="12"/>
  </svg>,
  // Subtitles / captions
  <svg key="subs" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="2"/>
    <line x1="6" y1="11" x2="18" y2="11"/><line x1="6" y1="15" x2="14" y2="15"/>
  </svg>,
  // Images / photo
  <svg key="imgs" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="m3 15 5-5 4 4 3-3 5 4"/><circle cx="8.5" cy="8.5" r="1.5"/>
  </svg>,
]

export default function BentoWorks() {
  const { lang } = useLangStore()
  const tv = useCallback((k: string) => tv2(k, lang), [lang])
  const [hovered, setHovered] = useState<number | null>(null)
  const [sectionRef, inView] = useInView<HTMLElement>()
  const reduced = usePrefersReducedMotion()

  return (
    <section
      ref={sectionRef}
      style={{
        padding: 'clamp(64px, 8vw, 96px) clamp(20px, 4vw, 64px)',
        borderTop: '1px solid var(--v2-border)',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <p style={{
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--v2-accent)',
          marginBottom: 12,
          fontFamily: 'var(--font-geist-sans, sans-serif)',
        }}>
          {tv('v2.works_tag')}
        </p>
        <h2 style={{
          fontFamily: 'var(--font-fraunces, serif)',
          fontSize: 'clamp(28px, 4vw, 52px)',
          fontWeight: 700,
          lineHeight: 1.1,
          color: 'var(--v2-text)',
          margin: 0,
          letterSpacing: '-0.02em',
        }}>
          {tv('v2.works_title')}
        </h2>
      </div>

      {/* Bento grid */}
      <div className="lv2-bento-grid">
        {BENTO_ITEMS.map(({ size, nameKey, descKey, hue }, i) => {
          const isHovered = hovered === i
          const isVisible = inView
          const delay = i * 80

          return (
            <div
              key={i}
              className={SIZE_CLASS[size]}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{
                borderRadius: 14,
                background: `hsl(${hue} 10% 11%)`,
                border: '1px solid var(--v2-border)',
                padding: size === 'large' ? '32px' : '24px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                cursor: 'default',
                overflow: 'hidden',
                position: 'relative',
                opacity: isVisible ? 1 : 0,
                transform: isVisible
                  ? isHovered
                    ? 'scale(1.02) translateY(-4px)'
                    : 'translateY(0) scale(1)'
                  : 'translateY(20px)',
                transition: reduced
                  ? 'none'
                  : isVisible
                  ? `opacity 350ms ease ${delay}ms, transform 250ms ease`
                  : `opacity 350ms ease ${delay}ms, transform 350ms ease ${delay}ms`,
              }}
            >
              {/* Subtle radial glow at top-right */}
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  width: '60%',
                  height: '60%',
                  background: `radial-gradient(ellipse at 100% 0%, hsl(${hue} 50% 25% / 0.18) 0%, transparent 70%)`,
                  pointerEvents: 'none',
                }}
              />

              {/* Icon */}
              <div style={{
                position: 'absolute',
                top: size === 'large' ? 32 : 20,
                right: size === 'large' ? 32 : 20,
                color: `hsl(${hue} 60% 60%)`,
                opacity: 0.7,
              }}>
                {ICONS[i]}
              </div>

              {/* Text */}
              <div style={{ position: 'relative', zIndex: 1 }}>
                <p style={{
                  fontSize: size === 'large' ? 22 : 16,
                  fontWeight: 600,
                  color: 'var(--v2-text)',
                  fontFamily: 'var(--font-geist-sans, sans-serif)',
                  marginBottom: 4,
                  lineHeight: 1.25,
                }}>
                  {tv(nameKey)}
                </p>
                <p style={{
                  fontSize: 13,
                  color: 'var(--v2-text-sec)',
                  fontFamily: 'var(--font-geist-sans, sans-serif)',
                  lineHeight: 1.5,
                }}>
                  {tv(descKey)}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
