'use client'
// TEMPORARY DESIGN PREVIEW — удалить после выбора темы

import { useEffect, useState } from 'react'

type ThemeId = 'current' | 'theme-a' | 'theme-b' | 'theme-c'

const THEMES: { id: ThemeId; label: string; color: string }[] = [
  { id: 'current', label: 'Текущий', color: '#7C3AED' },
  { id: 'theme-a', label: 'A',       color: '#B45309' },
  { id: 'theme-b', label: 'B',       color: '#0E7490' },
  { id: 'theme-c', label: 'C',       color: '#C2410C' },
]

export default function ThemePreview() {
  const [active, setActive] = useState<ThemeId>('current')

  useEffect(() => {
    const html = document.documentElement
    html.classList.remove('theme-a', 'theme-b', 'theme-c')
    if (active !== 'current') html.classList.add(active)
  }, [active])

  return (
    <div style={{
      position: 'fixed',
      bottom: 16,
      right: 16,
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      background: 'rgba(0,0,0,0.75)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: 10,
      padding: '5px 6px',
      backdropFilter: 'blur(10px)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      fontFamily: 'sans-serif',
    }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', paddingRight: 4, letterSpacing: '0.05em' }}>
        ТЕМА
      </span>
      {THEMES.map(t => (
        <button
          key={t.id}
          onClick={() => setActive(t.id)}
          title={t.id}
          style={{
            padding: '4px 11px',
            borderRadius: 6,
            border: active === t.id ? `1.5px solid ${t.color}` : '1.5px solid transparent',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            background: active === t.id ? `${t.color}22` : 'transparent',
            color: active === t.id ? t.color : 'rgba(255,255,255,0.5)',
            transition: 'all 150ms ease',
            lineHeight: 1,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
