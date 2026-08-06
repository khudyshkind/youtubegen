'use client'

import { useState, useEffect, useCallback }   from 'react'
import { useLangStore }                         from '@/lib/lang-store'
import { tv2 }                                  from '@/lib/i18n-v2'
import { CREDIT_COSTS, IMAGE_COUNT_MAX }        from '@/lib/types'
import {
  SAMPLE_SCRIPT,
  PREVIEW_IMAGES,
  DEFAULT_IMAGE_INTERVAL_SEC,
}                                               from '@/components/landing-v2/data'
import { usePrefersReducedMotion }              from '@/components/landing-v2/hooks/useMotion'

// Duration: src/components/studio/Step2Script.tsx:326
function calcDuration(words: number): number {
  return Math.max(1, Math.round(words / 130))
}
// Image count: src/components/studio/StepWizard.tsx:63; interval: src/lib/studio-store.ts:159
function calcImages(durationMin: number): number {
  return Math.min(IMAGE_COUNT_MAX, Math.max(1, Math.ceil((durationMin * 60) / DEFAULT_IMAGE_INTERVAL_SEC)))
}
// Credit estimate — CREDIT_COSTS from src/lib/types.ts
function calcCredits(durationMin: number, imgCount: number): number {
  return (
    CREDIT_COSTS.script_sonnet
    + CREDIT_COSTS.image_flux_schnell * imgCount
    + CREDIT_COSTS.video * durationMin
    + CREDIT_COSTS.seo
  )
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

const MAX_VISIBLE_FRAMES = 12
const FRAME_RATIOS = ['16/9', '4/3', '3/2', '16/9', '3/2', '4/3']

function AnimatedTitle({
  lineA, lineB, reduced,
}: { lineA: string; lineB: string; reduced: boolean }) {
  return (
    <h1 style={{
      fontFamily: 'var(--font-fraunces, serif)',
      fontSize: 'clamp(36px, 5.5vw, 72px)',
      fontWeight: 700,
      lineHeight: 1.05,
      color: 'var(--v2-text)',
      margin: '0 0 16px',
      letterSpacing: '-0.02em',
    }}>
      <span aria-label={lineA} style={{ display: 'block' }}>
        {lineA.split('').map((ch, i) => (
          <span
            key={i}
            aria-hidden="true"
            style={reduced ? { display: 'inline-block' } : {
              display: 'inline-block',
              animation: `lv2CharIn 300ms ease both`,
              animationDelay: `${i * 22}ms`,
            }}
          >
            {ch}
          </span>
        ))}
      </span>
      <span aria-label={lineB} style={{ display: 'block', color: 'var(--v2-accent)' }}>
        {lineB.split('').map((ch, i) => (
          <span
            key={i}
            aria-hidden="true"
            style={reduced ? { display: 'inline-block' } : {
              display: 'inline-block',
              animation: `lv2CharIn 300ms ease both`,
              animationDelay: `${lineA.length * 22 + 120 + i * 22}ms`,
            }}
          >
            {ch}
          </span>
        ))}
      </span>
    </h1>
  )
}

function ImageFrame({ index, visible, reduced }: { index: number; visible: boolean; reduced: boolean }) {
  const ar = FRAME_RATIOS[index % FRAME_RATIOS.length]
  const imgUrl = PREVIEW_IMAGES[index] ?? null
  const hue = (index * 43 + 170) % 360

  return (
    <div style={{
      aspectRatio: ar,
      borderRadius: 8,
      overflow: 'hidden',
      background: 'var(--v2-surface)',
      border: '1px solid var(--v2-border)',
      position: 'relative',
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(10px)',
      transition: reduced
        ? 'none'
        : `opacity 280ms ease ${index * 65}ms, transform 280ms ease ${index * 65}ms`,
    }}>
      {imgUrl ? (
        <img
          src={imgUrl}
          alt=""
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: `hsl(${hue} 10% 13%)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{
            fontSize: 10,
            color: `hsl(${hue} 25% 45%)`,
            fontFamily: 'var(--font-geist-sans, monospace)',
            letterSpacing: '0.06em',
            fontWeight: 500,
          }}>
            {String(index + 1).padStart(2, '0')}
          </span>
        </div>
      )}
    </div>
  )
}

export default function HeroCalc() {
  const { lang } = useLangStore()
  const tv = useCallback((k: string) => tv2(k, lang), [lang])
  const reduced = usePrefersReducedMotion()

  const [text, setText] = useState(SAMPLE_SCRIPT)
  const debouncedText = useDebounce(text, 300)

  const words    = countWords(debouncedText)
  const isEmpty  = words === 0
  const duration = isEmpty ? 0 : calcDuration(words)
  const imgCount = isEmpty ? 0 : calcImages(duration)
  const credits  = isEmpty ? 0 : calcCredits(duration, imgCount)
  const visibleFrames = isEmpty ? 0 : Math.min(MAX_VISIBLE_FRAMES, imgCount)

  const statNum: React.CSSProperties = {
    fontFamily: 'var(--font-fraunces, serif)',
    fontSize: 28,
    fontWeight: 700,
    color: 'var(--v2-accent)',
    fontVariantNumeric: 'tabular-nums',
  }
  const statLabel: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--v2-text-sec)',
    fontFamily: 'var(--font-geist-sans, sans-serif)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    marginTop: 2,
  }

  return (
    <section style={{ padding: 'clamp(72px, 10vw, 120px) clamp(20px, 4vw, 64px) clamp(48px, 7vw, 96px)' }}>
      <div className="lv2-hero-grid">

        {/* ── LEFT 55% ── */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <p style={{
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--v2-accent)',
            marginBottom: 20,
            fontFamily: 'var(--font-geist-sans, sans-serif)',
          }}>
            {tv('v2.hero_eyebrow')}
          </p>

          <AnimatedTitle
            lineA={tv('v2.hero_h1_a')}
            lineB={tv('v2.hero_h1_b')}
            reduced={reduced}
          />

          <p style={{
            fontSize: 16,
            lineHeight: 1.6,
            color: 'var(--v2-text-sec)',
            fontFamily: 'var(--font-geist-sans, sans-serif)',
            marginBottom: 24,
            maxWidth: 480,
          }}>
            {tv('v2.hero_sub')}
          </p>

          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={6}
            placeholder={tv('v2.calc_placeholder')}
            aria-label={tv('v2.calc_placeholder')}
            style={{
              width: '100%',
              background: 'var(--v2-surface)',
              border: '1px solid var(--v2-border)',
              borderRadius: 10,
              padding: '14px 16px',
              fontSize: 14,
              lineHeight: 1.65,
              color: 'var(--v2-text)',
              fontFamily: 'var(--font-geist-sans, sans-serif)',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 200ms ease',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = 'rgba(232,160,32,0.45)' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--v2-border)' }}
          />

          {/* Live calc */}
          <div style={{ display: 'flex', gap: 28, marginTop: 20, marginBottom: 28, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {isEmpty ? (
              <p style={{ fontSize: 13, color: 'var(--v2-text-sec)', fontFamily: 'var(--font-geist-sans, sans-serif)' }}>
                {tv('v2.calc_empty')}
              </p>
            ) : (
              <>
                <div>
                  <div style={statNum}>{duration}</div>
                  <div style={statLabel}>{tv('v2.calc_duration')}</div>
                </div>
                <div style={{ width: 1, background: 'var(--v2-border)', height: 36, alignSelf: 'center' }} aria-hidden="true" />
                <div>
                  <div style={statNum}>{imgCount}</div>
                  <div style={statLabel}>{tv('v2.calc_images_label')}</div>
                </div>
                <div style={{ width: 1, background: 'var(--v2-border)', height: 36, alignSelf: 'center' }} aria-hidden="true" />
                <div>
                  <div style={statNum}>{credits.toLocaleString('ru')}</div>
                  <div style={statLabel}>{tv('v2.calc_credits_label')}</div>
                </div>
              </>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
            <a
              href="/auth/register"
              style={{
                display: 'inline-block',
                background: 'var(--v2-accent)',
                color: '#0E0E0E',
                fontWeight: 700,
                fontSize: 16,
                padding: '14px 36px',
                borderRadius: 10,
                textDecoration: 'none',
                fontFamily: 'var(--font-geist-sans, sans-serif)',
                transition: 'opacity 150ms ease, transform 150ms ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.opacity = '0.88'
                e.currentTarget.style.transform = 'translateY(-1px)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.opacity = '1'
                e.currentTarget.style.transform = 'translateY(0)'
              }}
            >
              {tv('v2.calc_cta')}
            </a>
            <p style={{ fontSize: 12, color: 'var(--v2-text-sec)', fontFamily: 'var(--font-geist-sans, sans-serif)' }}>
              {tv('v2.calc_hint')}
            </p>
          </div>
        </div>

        {/* ── RIGHT 45% ── */}
        <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!isEmpty && (
            <p style={{
              fontSize: 11,
              color: 'var(--v2-text-sec)',
              fontFamily: 'var(--font-geist-sans, sans-serif)',
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}>
              {imgCount} {tv('v2.calc_images_label')}
            </p>
          )}
          <div className="lv2-frame-grid">
            {Array.from({ length: MAX_VISIBLE_FRAMES }, (_, i) => (
              <ImageFrame
                key={i}
                index={i}
                visible={i < visibleFrames}
                reduced={reduced}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
