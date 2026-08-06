'use client'

import { useLangStore } from '@/lib/lang-store'
import { tv2 }          from '@/lib/i18n-v2'

const S: Record<string, React.CSSProperties> = {
  root: {
    background: 'var(--v2-surface)',
    borderTop: '1px solid var(--v2-border)',
    padding: '96px 24px 80px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
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
    fontSize: 'clamp(32px, 5vw, 64px)',
    fontWeight: 700,
    lineHeight: 1.05,
    color: 'var(--v2-text)',
    marginBottom: 16,
  },
  sub: {
    fontSize: 17,
    color: 'var(--v2-text-sec)',
    marginBottom: 40,
    fontFamily: 'var(--font-geist-sans, sans-serif)',
  },
  btn: {
    display: 'inline-block',
    background: 'var(--v2-accent)',
    color: '#0E0E0E',
    fontWeight: 700,
    fontSize: 17,
    padding: '16px 44px',
    borderRadius: 10,
    textDecoration: 'none',
    fontFamily: 'var(--font-geist-sans, sans-serif)',
    transition: 'opacity 150ms ease, transform 150ms ease',
    marginBottom: 28,
    cursor: 'pointer',
  },
  badges: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: '8px 24px',
  },
  badge: {
    fontSize: 13,
    color: 'var(--v2-text-sec)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: 'var(--font-geist-sans, sans-serif)',
  },
}

// Check icon SVG — no emoji
const CheckIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ color: 'var(--v2-accent)', flexShrink: 0 }}
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export default function CtaV2() {
  const { lang } = useLangStore()
  const t = (k: string) => tv2(k, lang)

  return (
    <section style={S.root}>
      <p style={S.tag}>{t('v2.cta_tag')}</p>
      <h2 style={S.title}>{t('v2.cta_title')}</h2>
      <p style={S.sub}>{t('v2.cta_sub')}</p>

      <a href="/auth/register" style={S.btn}>
        {t('v2.cta_btn')}
      </a>

      <div style={S.badges}>
        {(['v2.cta_badge1', 'v2.cta_badge2', 'v2.cta_badge3'] as const).map(k => (
          <span key={k} style={S.badge}>
            <CheckIcon />
            {t(k)}
          </span>
        ))}
      </div>
    </section>
  )
}
