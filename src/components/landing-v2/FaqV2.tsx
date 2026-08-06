'use client'

import { useState }      from 'react'
import { useLangStore }  from '@/lib/lang-store'
import { tv2 }           from '@/lib/i18n-v2'

const FAQ_ITEMS = [
  { q: 'v2.faq_q1', a: 'v2.faq_a1' },
  { q: 'v2.faq_q2', a: 'v2.faq_a2' },
  { q: 'v2.faq_q3', a: 'v2.faq_a3' },
  { q: 'v2.faq_q4', a: 'v2.faq_a4' },
] as const

const S: Record<string, React.CSSProperties> = {
  root: {
    background: 'var(--v2-bg)',
    padding: 'var(--lv2-py-section) var(--lv2-px-content)',
    borderTop: '1px solid var(--v2-border)',
  },
  tag: {
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--v2-accent)',
    marginBottom: 16,
    fontFamily: 'var(--font-geist-sans, sans-serif)',
  },
  title: {
    fontFamily: 'var(--font-fraunces, serif)',
    fontSize: 'clamp(28px, 4vw, 48px)',
    fontWeight: 700,
    color: 'var(--v2-text)',
    textAlign: 'center',
    marginBottom: 48,
  },
  list: {
    width: '100%',
    maxWidth: 680,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  item: {
    borderRadius: 10,
    background: 'var(--v2-surface)',
    border: '1px solid var(--v2-border)',
    overflow: 'hidden',
  },
  question: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '18px 20px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    gap: 12,
  },
  questionText: {
    fontSize: 15,
    fontWeight: 500,
    color: 'var(--v2-text)',
    fontFamily: 'var(--font-geist-sans, sans-serif)',
  },
  chevron: {
    flexShrink: 0,
    color: 'var(--v2-text-sec)',
    transition: 'transform 200ms ease',
  },
  answer: {
    padding: '0 20px 18px',
    fontSize: 14,
    lineHeight: 1.65,
    color: 'var(--v2-text-sec)',
    fontFamily: 'var(--font-geist-sans, sans-serif)',
  },
}

export default function FaqV2() {
  const { lang } = useLangStore()
  const t = (k: string) => tv2(k, lang)

  const [open, setOpen] = useState<number | null>(null)

  const toggle = (i: number) => setOpen(prev => prev === i ? null : i)

  return (
    <section style={S.root}>
      <div className="lv2-asym">
        {/* Left: section label */}
        <div style={{ paddingTop: 4 }}>
          <p style={S.tag}>{t('v2.faq_tag')}</p>
          <h2 style={{ ...S.title, textAlign: 'left', marginBottom: 0 }}>{t('v2.faq_title')}</h2>
        </div>

        {/* Right: accordion */}
        <div className="lv2c-faq-list" role="list">
          {FAQ_ITEMS.map(({ q, a }, i) => {
            const isOpen = open === i
            return (
              <div key={q} style={S.item} role="listitem">
                <button
                  style={S.question}
                  onClick={() => toggle(i)}
                  aria-expanded={isOpen}
                >
                  <span style={S.questionText}>{t(q)}</span>
                  <svg
                    style={{
                      ...S.chevron,
                      transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {isOpen && (
                  <p style={S.answer}>{t(a)}</p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
