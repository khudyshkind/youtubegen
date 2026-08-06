'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Tools section — third track.
// Renders ALL 9 TOOL_CARDS — no manual items.
// TOOL_CARDS.length = 9 (verified via script).
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useEffect, useCallback } from 'react'
import { useLangStore } from '@/lib/lang-store'
import { tv2 } from '@/lib/i18n-v2'
import { t }  from '@/lib/i18n'
import { TOOL_CARDS } from '@/lib/content-config'
import { pluralize } from '@/components/landing-v2/data'
import { usePrefersReducedMotion } from '@/components/landing-v2/hooks/useMotion'

export default function ToolsTrack() {
  const { lang } = useLangStore()
  const tv = useCallback((k: string) => tv2(k, lang), [lang])
  const tl = useCallback((k: string) => t(k, lang), [lang])
  const sectionRef = useRef<HTMLElement>(null)
  const reduced    = usePrefersReducedMotion()

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    const cards = section.querySelectorAll<HTMLElement>('.lv2c-tool-card')
    if (reduced) { cards.forEach(c => c.classList.add('lv2c-in')); return }
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('lv2c-in'); observer.unobserve(e.target) } }),
      { threshold: 0.08 },
    )
    cards.forEach(c => observer.observe(c))
    return () => observer.disconnect()
  }, [reduced])

  return (
    <section
      id="lv2c-section-tools"
      ref={sectionRef}
      style={{
        background: 'var(--v2-bg)',
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
            {tv('v2.tools_tag')}
          </p>
          <h2 style={{
            fontFamily: 'var(--font-fraunces, serif)',
            fontSize: 'clamp(24px, 3.5vw, 42px)',
            fontWeight: 700, color: 'var(--v2-text)',
            letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: 16,
          }}>
            {tv('v2.tools_title')}
          </h2>
          <p style={{
            fontSize: 14, lineHeight: 1.7,
            color: 'var(--v2-text-sec)',
            fontFamily: 'var(--font-geist-sans, sans-serif)',
            maxWidth: 280,
          }}>
            {TOOL_CARDS.length}{' '}
            {pluralize(TOOL_CARDS.length, lang,
              lang === 'ru' ? ['AI-инструмент', 'AI-инструмента', 'AI-инструментов']
                            : ['AI tool', 'AI tools', 'AI tools']
            )}{' '}
            {tv('v2.tools_sub')}
          </p>
        </div>

        {/* ── Right: tool cards grid ────────────────────────────────────── */}
        {/* Iterates ALL TOOL_CARDS (length = 9) — no manual items */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 10,
          alignContent: 'start',
        }}>
          {TOOL_CARDS.map((card, i) => (
            <a
              key={card.slug}
              href={`/tools/${card.slug}`}
              className="lv2c-tool-card"
              style={{
                transitionDelay: `${i * 40}ms`,
                textDecoration: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '18px 20px',
                borderRadius: 14,
                border: `1px solid ${card.accent.border}`,
                background: card.accent.bg,
                transition: reduced
                  ? 'none'
                  : `opacity 350ms ease ${i * 40}ms, transform 350ms ease ${i * 40}ms, border-color 180ms ease`,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = card.accent.hover
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = card.accent.border
              }}
            >
              <p style={{
                fontSize: 14, fontWeight: 600, color: 'var(--v2-text)',
                fontFamily: 'var(--font-geist-sans, sans-serif)',
              }}>
                {tl(card.titleKey)}
              </p>
              <p style={{
                fontSize: 12, lineHeight: 1.6, color: 'var(--v2-text-sec)',
                fontFamily: 'var(--font-geist-sans, sans-serif)',
              }}>
                {tl(card.descKey)}
              </p>
              <span style={{
                marginTop: 4,
                fontSize: 12, fontWeight: 500,
                color: card.accent.color,
                fontFamily: 'var(--font-geist-sans, sans-serif)',
              }}>
                →
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
