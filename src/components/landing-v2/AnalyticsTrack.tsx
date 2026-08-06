'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Analytics section — placed BEFORE Studio.
//
// Landing page only renders VISIBLE_GROUPS (excludes 'История').
// Dashboard (src/app/analytics/**) reads ANALYTICS_GROUPS directly — unaffected.
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useEffect, useCallback } from 'react'
import { useLangStore } from '@/lib/lang-store'
import { tv2 } from '@/lib/i18n-v2'
import { t }  from '@/lib/i18n'
import { ANALYTICS_GROUPS } from '@/lib/content-config'
import { pluralize } from '@/components/landing-v2/data'
import { usePrefersReducedMotion } from '@/components/landing-v2/hooks/useMotion'

// Landing-page filter: hide 'История' group; dashboard is NOT affected.
const HIDDEN_GROUP_KEYS = ['analytics.group_history'] as const

export default function AnalyticsTrack() {
  const { lang } = useLangStore()
  const tv = useCallback((k: string) => tv2(k, lang), [lang])
  const tl = useCallback((k: string) => t(k, lang), [lang])
  const sectionRef = useRef<HTMLElement>(null)
  const reduced    = usePrefersReducedMotion()

  // Computed from filtered array — no manual numbers.
  const visibleGroups = ANALYTICS_GROUPS.filter(
    g => !HIDDEN_GROUP_KEYS.includes(g.groupKey as typeof HIDDEN_GROUP_KEYS[number])
  )
  const totalTabs = visibleGroups.reduce((s, g) => s + g.tabs.length, 0)

  const tabNoun = (n: number) => pluralize(n, lang,
    lang === 'ru' ? ['инструмент', 'инструмента', 'инструментов']
                  : ['tool', 'tools', 'tools']
  )

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    const cards = section.querySelectorAll<HTMLElement>('.lv2c-group-card')
    if (reduced) { cards.forEach(c => c.classList.add('lv2c-in')); return }
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('lv2c-in'); observer.unobserve(e.target) } }),
      { threshold: 0.1 },
    )
    cards.forEach(c => observer.observe(c))
    return () => observer.disconnect()
  }, [reduced])

  return (
    <section
      id="lv2c-section-analytics"
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
            {tv('v2.analytics_tag')}
          </p>
          <h2 style={{
            fontFamily: 'var(--font-fraunces, serif)',
            fontSize: 'clamp(24px, 3.5vw, 42px)',
            fontWeight: 700, color: 'var(--v2-text)',
            letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: 16,
          }}>
            {tv('v2.analytics_title')}
          </h2>
          <p style={{
            fontSize: 14, lineHeight: 1.7,
            color: 'var(--v2-text-sec)',
            fontFamily: 'var(--font-geist-sans, sans-serif)',
            maxWidth: 280,
          }}>
            {tv('v2.analytics_sub')}
          </p>
          {/* Group count badge — computed from visibleGroups, no manual number */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            marginTop: 24, padding: '6px 14px',
            border: '1px solid rgba(232,160,32,0.25)',
            borderRadius: 20,
          }}>
            <span style={{
              fontFamily: 'var(--font-fraunces, serif)',
              fontSize: 20, fontWeight: 700, color: 'var(--v2-accent)',
            }}>
              {totalTabs}
            </span>
            <span style={{
              fontSize: 12, color: 'var(--v2-text-sec)',
              fontFamily: 'var(--font-geist-sans, sans-serif)',
            }}>
              {tabNoun(totalTabs)}
            </span>
          </div>
        </div>

        {/* ── Right: group cards grid ───────────────────────────────────── */}
        {/* Iterates visibleGroups (ANALYTICS_GROUPS minus group_history) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 12,
          alignContent: 'start',
        }}>
          {visibleGroups.map((group, gi) => (
            <div
              key={group.groupKey}
              className="lv2c-group-card"
              style={{ transitionDelay: `${gi * 70}ms` }}
            >
              {/* Group header */}
              <div style={{
                borderRadius: '12px 12px 0 0',
                padding: '14px 18px 12px',
                background: group.accent
                  ? 'rgba(232,160,32,0.08)'
                  : 'rgba(255,255,255,0.04)',
                borderBottom: '1px solid var(--v2-border)',
              }}>
                <p style={{
                  fontSize: 13, fontWeight: 600,
                  color: group.accent ? 'var(--v2-accent)' : 'var(--v2-text)',
                  fontFamily: 'var(--font-geist-sans, sans-serif)',
                }}>
                  {tl(group.groupKey)}
                </p>
                <p style={{
                  fontSize: 11, color: 'var(--v2-text-sec)',
                  fontFamily: 'var(--font-geist-sans, sans-serif)',
                  marginTop: 2,
                }}>
                  {group.tabs.length} {tabNoun(group.tabs.length)}
                </p>
              </div>

              {/* Tabs — ALL tabs from this group, no truncation */}
              <div style={{
                borderRadius: '0 0 12px 12px',
                border: group.accent
                  ? '1px solid rgba(232,160,32,0.2)'
                  : '1px solid var(--v2-border)',
                borderTop: 'none',
                overflow: 'hidden',
                flex: 1,
              }}>
                {group.tabs.map((tab, ti) => (
                  <div
                    key={tab.id}
                    style={{
                      padding: '11px 18px',
                      borderBottom: ti < group.tabs.length - 1 ? '1px solid var(--v2-border)' : 'none',
                      display: 'flex', flexDirection: 'column', gap: 2,
                    }}
                  >
                    <p style={{
                      fontSize: 13, fontWeight: 500, color: 'var(--v2-text)',
                      fontFamily: 'var(--font-geist-sans, sans-serif)',
                    }}>
                      {tl(tab.labelKey)}
                    </p>
                    <p style={{
                      fontSize: 12, color: 'var(--v2-text-sec)', lineHeight: 1.5,
                      fontFamily: 'var(--font-geist-sans, sans-serif)',
                    }}>
                      {tl(tab.descKey)}
                    </p>
                    {tab.id === 'revenue' && (
                      <p style={{
                        fontSize: 11, color: 'rgba(232,160,32,0.7)', lineHeight: 1.4, marginTop: 3,
                        fontFamily: 'var(--font-geist-sans, sans-serif)',
                      }}>
                        {tv('v2.analytics_revenue_note')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
