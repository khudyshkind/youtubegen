'use client'

import { useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { useLangStore } from '@/lib/lang-store'
import { tv2 } from '@/lib/i18n-v2'
import { REEL_IMGS } from '@/components/landing-v2/data'
import { usePrefersReducedMotion } from '@/components/landing-v2/hooks/useMotion'

// Bento layout: 12-col grid, 3 rows, 6 images with varied proportions
// Row 1: [p0: 8 cols wide] [p1: 4 cols tall, spans rows 1-2]
// Row 2: [p2: 4 cols] [p3: 4 cols] [p1 cont.]
// Row 3: [p4: 6 cols] [p5: 6 cols]
const REEL_SIZES = [
  '(max-width: 767px) 50vw, 66vw',  // p0: 2/3 of grid
  '(max-width: 767px) 50vw, 33vw',  // p1: 1/3 of grid
  '(max-width: 767px) 50vw, 33vw',  // p2: 1/3
  '(max-width: 767px) 50vw, 33vw',  // p3: 1/3
  '(max-width: 767px) 50vw, 50vw',  // p4: 1/2
  '(max-width: 767px) 50vw, 50vw',  // p5: 1/2
] as const

export default function ShowcaseReel() {
  const { lang } = useLangStore()
  const tv = useCallback((k: string) => tv2(k, lang), [lang])
  const sectionRef = useRef<HTMLElement>(null)
  const trackRef   = useRef<HTMLDivElement>(null)
  const reduced    = usePrefersReducedMotion()

  useEffect(() => {
    if (reduced) return

    let cleanupFn: (() => void) | undefined

    ;(async () => {
      const { gsap }          = await import('gsap')
      const { ScrollTrigger } = await import('gsap/ScrollTrigger')
      gsap.registerPlugin(ScrollTrigger)

      if (!sectionRef.current || !trackRef.current) return

      const items = trackRef.current.querySelectorAll<HTMLElement>('[data-reel-item]')

      const ctx = gsap.context(() => {
        // Vertical parallax: each item drifts at a different speed as it scrolls through view
        items.forEach((item, i) => {
          const sign = i % 2 === 0 ? 1 : -1
          const py   = (i + 1) * 8   // 8, 16, 24, 32, 40, 48 px

          gsap.fromTo(
            item,
            { y: sign * -py },
            {
              y: sign * py,
              ease: 'none',
              scrollTrigger: {
                trigger: sectionRef.current,
                start: 'top bottom',
                end:   'bottom top',
                scrub: 1.2,
              },
            },
          )
        })
      })

      cleanupFn = () => ctx.revert()
    })()

    return () => cleanupFn?.()
  }, [reduced])

  return (
    <section
      ref={sectionRef}
      style={{
        overflow: 'hidden',
        borderTop: '1px solid var(--v2-border)',
        padding: 'clamp(56px, 7vw, 88px) 0',
        background: 'var(--v2-bg)',
      }}
    >
      {/* Header */}
      <div style={{ padding: '0 clamp(20px, 4vw, 64px)', marginBottom: 36 }}>
        <p style={{
          fontSize: 11, fontWeight: 500, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--v2-accent)',
          marginBottom: 10, fontFamily: 'var(--font-geist-sans, sans-serif)',
        }}>
          {tv('v2.reel_tag')}
        </p>
        <h2 style={{
          fontFamily: 'var(--font-fraunces, serif)',
          fontSize: 'clamp(26px, 3.5vw, 44px)', fontWeight: 700,
          color: 'var(--v2-text)', letterSpacing: '-0.02em', margin: 0,
        }}>
          {tv('v2.reel_title')}
        </h2>
      </div>

      {/* Bento grid — CSS classes control placement, see LandingV2.tsx */}
      <div
        ref={trackRef}
        className="lv2c-reel-grid"
        style={{ padding: '0 clamp(20px, 4vw, 64px)' }}
      >
        {REEL_IMGS.map((img, i) => (
          <div
            key={img.src}
            data-reel-item
            className={`lv2c-reel-p${i}`}
            style={{ position: 'relative', overflow: 'hidden', borderRadius: 12 }}
          >
            <Image
              src={img.src}
              alt={img.label}
              fill
              sizes={REEL_SIZES[i]}
              style={{ objectFit: 'cover' }}
            />
            <div style={{
              position: 'absolute', bottom: 10, left: 10,
              background: 'rgba(0,0,0,0.52)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              borderRadius: 5, padding: '3px 9px',
              fontSize: 11, fontWeight: 500,
              color: 'rgba(255,255,255,0.72)',
              fontFamily: 'var(--font-geist-sans, sans-serif)',
            }}>
              {tv('v2.reel_ai_generated')}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
