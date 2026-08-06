'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { useLangStore } from '@/lib/lang-store'
import { tv2 } from '@/lib/i18n-v2'
import {
  HERO_IMG,
  SAMPLE_SCRIPT,
  DEFAULT_IMAGE_INTERVAL_SEC,
  IMAGE_COUNT_MAX,
} from '@/components/landing-v2/data'
import { CREDIT_COSTS } from '@/lib/types'
import { usePrefersReducedMotion } from '@/components/landing-v2/hooks/useMotion'

// ── Calculator helpers ─────────────────────────────────────────────────────────
function useDebounce<T>(v: T, ms: number): T {
  const [d, setD] = useState(v)
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms)
    return () => clearTimeout(id)
  }, [v, ms])
  return d
}

// Duration formula — Step2Script.tsx:326
function calcDuration(text: string): number {
  const w = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(w / 130))
}

// Image count formula — StepWizard.tsx:63
function calcImages(dur: number): number {
  return Math.min(IMAGE_COUNT_MAX, Math.max(1, Math.ceil((dur * 60) / DEFAULT_IMAGE_INTERVAL_SEC)))
}

function calcCredits(dur: number, imgs: number): number {
  return (
    CREDIT_COSTS.script_sonnet +
    CREDIT_COSTS.seo +
    Math.round(dur * CREDIT_COSTS.video) +
    imgs * CREDIT_COSTS.image_flux_schnell
  )
}
// ──────────────────────────────────────────────────────────────────────────────

export default function HeroCinema() {
  const { lang } = useLangStore()
  const tv = useCallback((k: string) => tv2(k, lang), [lang])
  const reduced = usePrefersReducedMotion()

  const [text, setText] = useState(SAMPLE_SCRIPT)
  const debounced = useDebounce(text, 300)

  const words    = debounced.trim().split(/\s+/).filter(Boolean).length
  const hasText  = words > 0
  const dur      = hasText ? calcDuration(debounced) : 0
  const imgs     = hasText ? calcImages(dur) : 0
  const credits  = hasText ? calcCredits(dur, imgs) : 0

  // Title line reveal — CSS animation, triggered after mount
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const titleLines = [tv('v2.hero_h1_a'), tv('v2.hero_h1_b')]

  const statItems = hasText
    ? [
        { val: `${dur} ${tv('v2.calc_duration')}`, label: '' },
        { val: String(imgs), label: tv('v2.calc_images_label') },
        { val: credits.toLocaleString('ru'), label: tv('v2.calc_credits_label') },
      ]
    : []

  return (
    <section className="lv2c-hero">
      {/* Background — slow scale zoom (CSS only) */}
      <div className={`lv2c-hero-bg${reduced ? ' lv2c-hero-bg-static' : ''}`}>
        <Image
          src={HERO_IMG.src}
          alt=""
          fill
          priority
          sizes="100vw"
          style={{ objectFit: 'cover' }}
        />
      </div>

      {/* Directional gradient — darker on left where glass panel sits */}
      <div className="lv2c-hero-overlay" />

      {/* Content wrapper */}
      <div className="lv2c-hero-inner">
        <div className="lv2c-glass">
          {/* Eyebrow */}
          <p style={{
            fontSize: 11, fontWeight: 500, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--v2-accent)',
            fontFamily: 'var(--font-geist-sans, sans-serif)',
          }}>
            {tv('v2.hero_eyebrow')}
          </p>

          {/* Headline — lines reveal from bottom */}
          <h1 style={{
            fontFamily: 'var(--font-fraunces, serif)',
            fontSize: 'clamp(34px, 4.5vw, 62px)',
            fontWeight: 700, letterSpacing: '-0.02em',
            lineHeight: 1.1, color: '#fff', margin: 0,
          }}>
            {titleLines.map((line, i) => (
              <span
                key={i}
                style={{
                  display: 'block',
                  opacity: reduced ? 1 : (ready ? 1 : 0),
                  transform: reduced ? 'none' : (ready ? 'translateY(0)' : 'translateY(18px)'),
                  transition: reduced
                    ? 'none'
                    : `opacity 480ms ease ${i * 110 + 60}ms, transform 480ms ease ${i * 110 + 60}ms`,
                }}
              >
                {line}
              </span>
            ))}
          </h1>

          {/* Subtext */}
          <p style={{
            fontSize: 14, lineHeight: 1.7, color: 'rgba(255,255,255,0.62)',
            fontFamily: 'var(--font-geist-sans, sans-serif)',
            opacity: reduced ? 1 : (ready ? 1 : 0),
            transition: reduced ? 'none' : 'opacity 480ms ease 320ms',
          }}>
            {tv('v2.hero_sub')}
          </p>

          {/* Textarea calculator — height and scroll via .lv2c-calc-textarea in LandingV2.tsx */}
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={8}
            placeholder={tv('v2.calc_placeholder')}
            className="lv2c-calc-textarea"
          />

          {/* Stats */}
          {hasText ? (
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {statItems.map(({ val, label }, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{
                    fontFamily: 'var(--font-fraunces, serif)',
                    fontSize: 'clamp(26px, 3.5vw, 36px)', fontWeight: 700, color: '#fff',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {val}
                  </span>
                  {label && (
                    <span style={{
                      fontSize: 11, color: 'rgba(255,255,255,0.45)',
                      fontFamily: 'var(--font-geist-sans, sans-serif)',
                    }}>
                      {label}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p style={{
              fontSize: 13, color: 'rgba(255,255,255,0.38)',
              fontFamily: 'var(--font-geist-sans, sans-serif)',
            }}>
              {tv('v2.calc_empty')}
            </p>
          )}

          {/* CTA block */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <a
              href="/auth/register"
              style={{
                display: 'block', textAlign: 'center', padding: '13px 0',
                borderRadius: 10, background: 'var(--v2-accent)', color: '#0E0E0E',
                fontSize: 15, fontWeight: 700, textDecoration: 'none',
                fontFamily: 'var(--font-geist-sans, sans-serif)',
                transition: 'opacity 150ms ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.85' }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
            >
              {tv('v2.calc_cta')}
            </a>
            <p style={{
              fontSize: 11, textAlign: 'center',
              color: 'rgba(255,255,255,0.38)',
              fontFamily: 'var(--font-geist-sans, sans-serif)',
            }}>
              {tv('v2.calc_hint')}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
