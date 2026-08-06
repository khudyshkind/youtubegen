'use client'

import Image from 'next/image'
import { useCallback } from 'react'
import { useLangStore } from '@/lib/lang-store'
import { tv2 } from '@/lib/i18n-v2'
import { CTA_IMG } from '@/components/landing-v2/data'

const BADGE_KEYS = ['v2.cta_badge1', 'v2.cta_badge2', 'v2.cta_badge3'] as const

export default function CtaFinal() {
  const { lang } = useLangStore()
  const tv = useCallback((k: string) => tv2(k, lang), [lang])

  return (
    <section className="lv2c-cta">
      <div style={{ position: 'absolute', inset: 0 }}>
        <Image
          src={CTA_IMG.src}
          alt=""
          fill
          sizes="100vw"
          style={{ objectFit: 'cover' }}
        />
      </div>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.82) 100%)',
      }} />
      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22,
        padding: '0 clamp(20px, 6vw, 80px)',
        textAlign: 'center', maxWidth: 720, width: '100%',
      }}>
        <p style={{
          fontSize: 11, fontWeight: 500, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--v2-accent)',
          fontFamily: 'var(--font-geist-sans, sans-serif)',
        }}>
          {tv('v2.cta_tag')}
        </p>
        <h2 style={{
          fontFamily: 'var(--font-fraunces, serif)',
          fontSize: 'clamp(36px, 6vw, 72px)',
          fontWeight: 700, color: '#fff',
          letterSpacing: '-0.02em', lineHeight: 1.1, margin: 0,
        }}>
          {tv('v2.cta_title')}
        </h2>
        <p style={{
          fontSize: 'clamp(15px, 2vw, 18px)', color: 'rgba(255,255,255,0.72)',
          fontFamily: 'var(--font-geist-sans, sans-serif)', maxWidth: 480,
        }}>
          {tv('v2.cta_sub')}
        </p>
        <a
          href="/auth/register"
          style={{
            display: 'inline-block', padding: '15px 40px',
            background: 'var(--v2-accent)', color: '#0E0E0E',
            borderRadius: 10, fontSize: 16, fontWeight: 700,
            textDecoration: 'none', fontFamily: 'var(--font-geist-sans, sans-serif)',
            letterSpacing: '0.01em', transition: 'opacity 150ms ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.85' }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
        >
          {tv('v2.cta_btn')}
        </a>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          {BADGE_KEYS.map(k => (
            <span key={k} style={{
              fontSize: 13, color: 'rgba(255,255,255,0.55)',
              fontFamily: 'var(--font-geist-sans, sans-serif)',
              borderRadius: 20, border: '1px solid rgba(255,255,255,0.18)',
              padding: '4px 14px',
            }}>
              {tv(k)}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
