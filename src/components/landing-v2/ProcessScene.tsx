'use client'

import { useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { useLangStore } from '@/lib/lang-store'
import { tv2 } from '@/lib/i18n-v2'
import { PROCESS_LINE_KEYS, PROCESS_IMGS } from '@/components/landing-v2/data'
import { usePrefersReducedMotion } from '@/components/landing-v2/hooks/useMotion'

// ─────────────────────────────────────────────────────────────────────────────
// Section layout:
//   outer (300vh) ← gives scroll room for ScrollTrigger
//     sticky (100svh) ← stays fixed while user scrolls through outer
//       header | content-area (lines / grid / strip overlap)
//
// Phase 1 (t 0→2.5): 8 lines highlight one by one
// Phase 2 (t 2.5→4):  lines fade out, grid fades in
// Phase 3 (t 4→6):    images appear staggered in grid
// Phase 4 (t 7→9):    grid slides up + fades, strip fades in at bottom
//
// Mobile / reduced-motion: static version shown instead.
// ─────────────────────────────────────────────────────────────────────────────

export default function ProcessScene() {
  const { lang } = useLangStore()
  const tv = useCallback((k: string) => tv2(k, lang), [lang])
  const outerRef  = useRef<HTMLDivElement>(null)
  const stickyRef = useRef<HTMLDivElement>(null)
  const reduced   = usePrefersReducedMotion()

  useEffect(() => {
    if (reduced || typeof window === 'undefined' || window.innerWidth < 768) return

    let cleanupFn: (() => void) | undefined

    ;(async () => {
      const { gsap }          = await import('gsap')
      const { ScrollTrigger } = await import('gsap/ScrollTrigger')
      gsap.registerPlugin(ScrollTrigger)

      const outer  = outerRef.current
      const sticky = stickyRef.current
      if (!outer || !sticky) return

      const lines     = sticky.querySelectorAll<HTMLElement>('.lv2c-pline')
      const linesWrap = sticky.querySelector<HTMLElement>('.lv2c-plines-wrap')
      const pgrid     = sticky.querySelector<HTMLElement>('.lv2c-pgrid')
      const pimgs     = sticky.querySelectorAll<HTMLElement>('.lv2c-pimg-wrap')

      const ctx = gsap.context(() => {
        // Set initial hidden states (CSS backup also sets these for desktop)
        gsap.set(lines,     { opacity: 0.1 })
        gsap.set(pgrid,     { opacity: 0, y: 28 })
        gsap.set(pimgs,     { opacity: 0 })

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: outer,
            start:   'top top',
            end:     'bottom bottom',
            scrub:   1.5,
          },
        })

        // Phase 1 — highlight lines sequentially
        tl.to(lines, {
          opacity:  1,
          color:    '#F0F0F0',
          stagger:  0.2,
          duration: 0.25,
          ease:     'power1.out',
        }, 0)

        // Phase 2 — fade lines, then bring in grid.
        // '>' starts pgrid AFTER linesWrap finishes (2.8+0.35=3.15), preventing overlap.
        tl.to(linesWrap, { opacity: 0, y: -22, duration: 0.35, ease: 'power2.in' }, 2.8)
        tl.to(pgrid,     { opacity: 1, y: 0,   duration: 0.4,  ease: 'power2.out' }, '>')

        // Phase 3 — images appear in grid
        tl.to(pimgs, {
          opacity:  1,
          stagger:  0.12,
          duration: 0.25,
          ease:     'power1.out',
        }, 3.5)

        // Phase 3 ends here — image grid stays visible as final state
      })

      cleanupFn = () => ctx.revert()
    })()

    return () => cleanupFn?.()
  }, [reduced])

  // ── Static version (mobile + reduced-motion) ──────────────────────────────
  const StaticSection = (
    <section className="lv2c-process-static" style={{
      background: 'var(--v2-bg)',
      padding: 'clamp(56px, 7vw, 88px) clamp(24px, 4vw, 64px)',
      borderTop: '1px solid var(--v2-border)',
    }}>
      <p style={{
        fontSize: 11, fontWeight: 500, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: 'var(--v2-accent)',
        marginBottom: 12, fontFamily: 'var(--font-geist-sans, sans-serif)',
      }}>
        {tv('v2.process_tag')}
      </p>
      <h2 style={{
        fontFamily: 'var(--font-fraunces, serif)',
        fontSize: 'clamp(26px, 4vw, 48px)', fontWeight: 700,
        color: 'var(--v2-text)', letterSpacing: '-0.02em', marginBottom: 28,
      }}>
        {tv('v2.process_title')}
      </h2>

      {/* All lines visible */}
      <div style={{ marginBottom: 36 }}>
        {PROCESS_LINE_KEYS.map((k, i) => (
          <p key={k} style={{
            fontSize: 'clamp(15px, 2.2vw, 22px)',
            color: i < 2 ? 'var(--v2-text-sec)' : 'var(--v2-text)',
            lineHeight: 1.5, margin: '0 0 4px',
            fontFamily: 'var(--font-fraunces, serif)',
          }}>
            {tv(k)}
          </p>
        ))}
      </div>

      {/* Image grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 12,
      }}>
        {PROCESS_IMGS.map(img => (
          <div key={img.src} style={{
            position: 'relative', aspectRatio: '16/9',
            borderRadius: 10, overflow: 'hidden',
          }}>
            <Image
              src={img.src}
              alt={img.label}
              fill
              sizes="(max-width: 600px) 100vw, 33vw"
              style={{ objectFit: 'cover' }}
            />
          </div>
        ))}
      </div>
    </section>
  )

  // ── Animated version (desktop, non-reduced) ───────────────────────────────
  const AnimatedSection = (
    <div ref={outerRef} className="lv2c-process-outer" aria-hidden="true">
      <div ref={stickyRef} className="lv2c-process-sticky">
        {/* Header — always visible */}
        <div style={{ flexShrink: 0, marginBottom: 'clamp(20px, 3vh, 40px)' }}>
          <p style={{
            fontSize: 11, fontWeight: 500, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--v2-accent)',
            marginBottom: 10, fontFamily: 'var(--font-geist-sans, sans-serif)',
          }}>
            {tv('v2.process_tag')}
          </p>
          <h2 style={{
            fontFamily: 'var(--font-fraunces, serif)',
            fontSize: 'clamp(26px, 3.5vw, 46px)', fontWeight: 700,
            color: 'var(--v2-text)', letterSpacing: '-0.02em', margin: 0,
          }}>
            {tv('v2.process_title')}
          </h2>
        </div>

        {/* Overlapping content area */}
        <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>

          {/* Phase 1: script lines */}
          <div className="lv2c-plines-wrap">
            {PROCESS_LINE_KEYS.map((k, i) => (
              <p key={k} className="lv2c-pline" style={{
                fontSize: 'clamp(18px, 2.8vw, 34px)',
                fontFamily: 'var(--font-fraunces, serif)',
                lineHeight: 1.4, margin: 0,
                transition: 'color 0.1s',
              }}>
                {tv(k)}
              </p>
            ))}
          </div>

          {/* Phase 2+3: image grid */}
          <div className="lv2c-pgrid">
            {PROCESS_IMGS.map((img, i) => (
              <div key={img.src} className="lv2c-pimg-wrap" style={{
                position: 'relative', borderRadius: 10, overflow: 'hidden',
                minHeight: 0,
              }}>
                <Image
                  src={img.src}
                  alt={img.label}
                  fill
                  sizes="(max-width: 1200px) 50vw, 33vw"
                  style={{ objectFit: 'cover' }}
                />
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  )

  return (
    <>
      {StaticSection}
      {AnimatedSection}
    </>
  )
}
