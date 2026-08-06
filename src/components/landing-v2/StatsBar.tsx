'use client'

import { useLangStore }   from '@/lib/lang-store'
import { tv2 }            from '@/lib/i18n-v2'
import {
  STUDIO_STEP_COUNT,
  SCRIPT_LANGUAGE_COUNT,
  SV_VOICES_TOTAL,
} from '@/components/landing-v2/data'

const S: Record<string, React.CSSProperties> = {
  root: {
    background: 'var(--v2-surface)',
    borderTop:    '1px solid var(--v2-border)',
    borderBottom: '1px solid var(--v2-border)',
    padding: '40px 24px',
    display: 'flex',
    justifyContent: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: 800,
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 0,
  },
  cell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    padding: '0 24px',
    borderRight: '1px solid var(--v2-border)',
  },
  cellLast: {
    borderRight: 'none',
  },
  num: {
    fontFamily: 'var(--font-fraunces, serif)',
    fontSize: 52,
    fontWeight: 700,
    lineHeight: 1,
    color: 'var(--v2-text)',
    fontVariantNumeric: 'tabular-nums',
  },
  label: {
    fontSize: 13,
    color: 'var(--v2-text-sec)',
    textAlign: 'center',
    fontFamily: 'var(--font-geist-sans, sans-serif)',
  },
}

// Sources:
// STUDIO_STEP_COUNT  → src/lib/content-config.ts:113 (STUDIO_STEPS.length = 8)
// SCRIPT_LANGUAGE_COUNT → src/lib/languages.ts:3 (SCRIPT_LANGUAGES.length = 28)
// SV_VOICES_TOTAL → src/app/api/voices/secretvoicer/route.ts:47 (CATALOG.length = 101)
const stats = [
  { value: STUDIO_STEP_COUNT,        key: 'v2.stats_steps'  },
  { value: SCRIPT_LANGUAGE_COUNT,    key: 'v2.stats_langs'  },
  { value: SV_VOICES_TOTAL,          key: 'v2.stats_voices' },
] as const

export default function StatsBar() {
  const { lang } = useLangStore()
  const t = (k: string) => tv2(k, lang)

  return (
    <div style={S.root}>
      <div style={S.inner}>
        {stats.map(({ value, key }, i) => (
          <div
            key={key}
            style={i === stats.length - 1 ? { ...S.cell, ...S.cellLast } : S.cell}
          >
            <span style={S.num}>{value}</span>
            <span style={S.label}>{t(key)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
