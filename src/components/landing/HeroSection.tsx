'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import AnimatedCounter from './AnimatedCounter'
import { useLang } from '@/hooks/useLang'

export default function HeroSection() {
  const { t, lang } = useLang()

  const PHRASES = [
    t('landing.phrase1'),
    t('landing.phrase2'),
    t('landing.phrase3'),
    t('landing.phrase4'),
    t('landing.phrase5'),
  ]

  /* ── Typewriter ─────────────────────────────────────── */
  const [text, setText] = useState('')
  const [phraseIdx, setPhraseIdx] = useState(0)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const phrase = PHRASES[phraseIdx]
    let t: ReturnType<typeof setTimeout>
    if (!deleting) {
      if (text.length < phrase.length) {
        t = setTimeout(() => setText(phrase.slice(0, text.length + 1)), 65)
      } else {
        t = setTimeout(() => setDeleting(true), 2200)
      }
    } else {
      if (text.length > 0) {
        t = setTimeout(() => setText(phrase.slice(0, text.length - 1)), 38)
      } else {
        setDeleting(false)
        setPhraseIdx((i) => (i + 1) % PHRASES.length)
      }
    }
    return () => clearTimeout(t)
  }, [text, phraseIdx, deleting])

  /* ── Mouse parallax for blobs ───────────────────────── */
  const blob1 = useRef<HTMLDivElement>(null)
  const blob2 = useRef<HTMLDivElement>(null)
  const blob3 = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if ('ontouchstart' in window) return

    const onMove = (e: MouseEvent) => {
      const x = e.clientX / window.innerWidth - 0.5
      const y = e.clientY / window.innerHeight - 0.5
      if (blob1.current)
        blob1.current.style.transform = `translate(${x * 45}px, ${y * 40}px)`
      if (blob2.current)
        blob2.current.style.transform = `translate(${-x * 30}px, ${-y * 28}px)`
      if (blob3.current)
        blob3.current.style.transform = `translate(${x * 20}px, ${-y * 35}px)`
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return (
    <section className="relative overflow-hidden bg-[#0A0A0F] min-h-screen flex items-center">

      {/* ── Gradient blobs: outer = parallax, inner = CSS animation ── */}
      <div
        ref={blob1}
        className="absolute top-1/4 left-[15%] pointer-events-none"
        style={{ willChange: 'transform', transition: 'transform 0.2s ease-out' }}
      >
        <div className="animate-blob w-[520px] h-[520px] bg-violet-700/25 rounded-full filter blur-3xl" />
      </div>
      <div
        ref={blob2}
        className="absolute top-1/2 right-[15%] pointer-events-none"
        style={{ willChange: 'transform', transition: 'transform 0.2s ease-out' }}
      >
        <div className="animate-blob animation-delay-2000 w-[420px] h-[420px] bg-blue-700/20 rounded-full filter blur-3xl" />
      </div>
      <div
        ref={blob3}
        className="absolute bottom-1/4 left-1/3 pointer-events-none"
        style={{ willChange: 'transform', transition: 'transform 0.2s ease-out' }}
      >
        <div className="animate-blob animation-delay-4000 w-[360px] h-[360px] bg-pink-700/15 rounded-full filter blur-3xl" />
      </div>

      {/* Dot grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.18) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      />

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-32 text-center">

        {/* Badge */}
        <div className="inline-flex items-center gap-2 border border-violet-500/30 bg-violet-500/10 text-violet-300 text-sm font-medium rounded-full px-4 py-1.5 mb-8 backdrop-blur-sm">
          <span className="w-2 h-2 bg-violet-400 rounded-full animate-pulse" />
          {t('landing.hero_badge2')}
        </div>

        {/* Heading */}
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold leading-tight tracking-tight mb-8">
          <span className="text-slate-100">{t('landing.hero_h1_pre')}</span>
          <br />
          <span className="gradient-text">{t('landing.hero_h1_mid')}</span>
          <br />
          <span className="text-slate-100">{t('landing.hero_h1_post')}</span>
        </h1>

        {/* Typewriter */}
        <div className="max-w-xl mx-auto mb-12">
          <p className="text-xl text-slate-400 mb-1">{t('landing.hero_typewriter_pre')}</p>
          <div className="h-8 flex items-center justify-center">
            <span className="text-xl font-medium text-violet-400">{text}</span>
            <span className="ml-0.5 inline-block w-0.5 h-6 bg-violet-400 animate-pulse" />
          </div>
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
          <Link href="/auth/register" className="btn-gradient w-full sm:w-auto px-8 py-4 text-white font-semibold rounded-2xl text-lg">
            {t('landing.hero_cta')}
          </Link>
          <a href="#how-it-works" className="btn-ghost-dark w-full sm:w-auto px-8 py-4 rounded-2xl text-lg font-semibold backdrop-blur-sm">
            {t('landing.hero_cta_watch')}
          </a>
        </div>

        {/* Stats — animated counters */}
        <div className="flex flex-wrap items-stretch justify-center">
          {[
            { to: 321, suffix: '', label: t('landing.hero_stat1') },
            { to: 28,  suffix: '', label: t('landing.hero_stat2') },
            { to: 7,   suffix: '', label: t('landing.hero_stat3') },
            { to: 10,  suffix: lang === 'en' ? ' min' : ' мин', label: t('landing.hero_stat4') },
          ].map((s, i) => (
            <div key={s.label} className={`px-8 py-2 text-center ${i > 0 ? 'border-l border-white/10' : ''}`}>
              <div className="text-3xl font-extrabold text-slate-100">
                <AnimatedCounter to={s.to} suffix={s.suffix} duration={1400} />
              </div>
              <div className="text-sm text-slate-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
