'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Three-track fixed timeline bar — Step 5.
//
// Desktop (≥640px):
//   [HH:MM] [АНАЛИТИКА ████░░░░░] [СТУДИЯ ░░████░░░] [ИНСТРУМЕНТЫ ░░░░████]
//             playhead moves with scroll inside each track
//             active track highlighted; click → smooth scroll to section
//
// Mobile (<640px): single 3px progress bar, no labels.
//
// Scroll detection: IntersectionObserver + scroll event (passive).
// Only transform + opacity animated (prefers-reduced-motion safe).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import { useLangStore } from '@/lib/lang-store'
import { tv2 } from '@/lib/i18n-v2'
import { usePrefersReducedMotion } from '@/components/landing-v2/hooks/useMotion'

const SECTION_IDS   = ['lv2c-section-analytics', 'lv2c-section-studio', 'lv2c-section-tools'] as const
type SectionId = typeof SECTION_IDS[number]

const TRACK_KEY: Record<SectionId, string> = {
  'lv2c-section-analytics': 'v2.tl_analytics',
  'lv2c-section-studio':    'v2.tl_studio',
  'lv2c-section-tools':     'v2.tl_tools',
}

// Virtual total duration for timecode display (12 minutes)
const TOTAL_MINUTES = 12

interface TrackState {
  /** 0 = not yet, 0-1 = in progress, 1 = completed */
  progress: number
}

export default function TimelineBar() {
  const { lang } = useLangStore()
  const tv = useCallback((k: string) => tv2(k, lang), [lang])
  const reduced = usePrefersReducedMotion()

  const [tracks, setTracks]   = useState<TrackState[]>(SECTION_IDS.map(() => ({ progress: 0 })))
  const [overall, setOverall] = useState(0)   // 0-1: from analytics top to tools bottom

  useEffect(() => {
    function update() {
      const mid = window.scrollY + window.innerHeight * 0.5

      const els = SECTION_IDS.map(id => document.getElementById(id))
      const first = els[0]
      const last  = els[els.length - 1]

      // Overall progress (for timecode)
      if (first && last) {
        const overallTop    = first.getBoundingClientRect().top    + window.scrollY
        const overallBottom = last.getBoundingClientRect().bottom  + window.scrollY
        setOverall(Math.max(0, Math.min(1, (mid - overallTop) / (overallBottom - overallTop))))
      }

      // Per-section progress
      const nextTracks = els.map(el => {
        if (!el) return { progress: 0 }
        const top    = el.getBoundingClientRect().top    + window.scrollY
        const bottom = el.getBoundingClientRect().bottom + window.scrollY
        const p = Math.max(0, Math.min(1, (mid - top) / (bottom - top)))
        return { progress: p }
      })
      setTracks(nextTracks)
    }

    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update, { passive: true })
    update()
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  function scrollToSection(id: string) {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' })
  }

  // Timecode: maps overall 0→1 to 00:00→12:00
  const totalSec = Math.round(overall * TOTAL_MINUTES * 60)
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')
  const timecode = `${mm}:${ss}`

  return (
    <>
      {/* ── Mobile: single thin progress bar ──────────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          height: 3, zIndex: 200,
          background: 'rgba(255,255,255,0.08)',
        }}
        className="lv2c-tl-mobile"
      >
        <div style={{
          height: '100%',
          width: `${overall * 100}%`,
          background: 'var(--v2-accent)',
          transition: reduced ? 'none' : 'width 80ms linear',
        }} />
      </div>

      {/* ── Desktop: 3-track timeline ──────────────────────────────────── */}
      <nav
        aria-label="Page timeline"
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          zIndex: 200,
          background: 'rgba(10,10,10,0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          padding: '7px 16px 7px 12px',
          display: 'flex', alignItems: 'center', gap: 14,
        }}
        className="lv2c-timeline"
      >
        {/* Timecode */}
        <div style={{
          fontFamily: 'var(--font-geist-sans, monospace)',
          fontSize: 11, fontWeight: 500,
          color: 'var(--v2-text-sec)', letterSpacing: '0.06em',
          flexShrink: 0, width: 36, textAlign: 'right',
          userSelect: 'none',
        }}>
          {timecode}
        </div>

        {/* Three tracks */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {SECTION_IDS.map((id, i) => {
            const p       = tracks[i].progress
            const isActive = p > 0 && p < 1
            const isDone   = p >= 1

            return (
              <button
                key={id}
                onClick={() => scrollToSection(id)}
                aria-label={`${tv(TRACK_KEY[id])} — ${Math.round(p * 100)}%`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '0', width: '100%', textAlign: 'left',
                }}
              >
                {/* Track label */}
                <span style={{
                  fontSize: 10, fontWeight: isActive ? 600 : 400,
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: isActive ? 'var(--v2-accent)' : isDone ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.22)',
                  fontFamily: 'var(--font-geist-sans, sans-serif)',
                  flexShrink: 0, minWidth: 78,
                  transition: reduced ? 'none' : 'color 200ms ease',
                }}>
                  {tv(TRACK_KEY[id])}
                </span>

                {/* Track bar */}
                <div style={{
                  flex: 1, height: 2, borderRadius: 1,
                  background: 'rgba(255,255,255,0.07)',
                  position: 'relative', overflow: 'visible',
                }}>
                  {/* Fill (left side = done) */}
                  <div style={{
                    position: 'absolute', top: 0, left: 0, bottom: 0,
                    width: `${p * 100}%`,
                    borderRadius: 1,
                    background: isActive
                      ? 'var(--v2-accent)'
                      : isDone
                      ? 'rgba(232,160,32,0.4)'
                      : 'transparent',
                    transition: reduced ? 'none' : 'width 80ms linear',
                  }} />

                  {/* Playhead — only on active track */}
                  {isActive && (
                    <div style={{
                      position: 'absolute',
                      left: `${p * 100}%`,
                      top: -3, bottom: -3, width: 2,
                      background: 'var(--v2-accent)',
                      borderRadius: 1,
                      transform: 'translateX(-50%)',
                      boxShadow: '0 0 5px rgba(232,160,32,0.6)',
                      transition: reduced ? 'none' : 'left 80ms linear',
                    }} />
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </nav>
    </>
  )
}
