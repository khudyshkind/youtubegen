'use client'

import Link from 'next/link'
import { useLang } from '@/hooks/useLang'

const TOOL_CARDS = [
  {
    slug: 'script-gen',
    emoji: '📝',
    titleKey: 'tools.card_script' as const,
    descKey: 'tools.card_script_desc' as const,
    accent: { bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.2)', hover: 'rgba(124,58,237,0.35)', color: '#a78bfa' },
  },
  {
    slug: 'seo',
    emoji: '🎯',
    titleKey: 'tools.card_seo' as const,
    descKey: 'tools.card_seo_desc' as const,
    accent: { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)', hover: 'rgba(59,130,246,0.35)', color: '#60a5fa' },
  },
  {
    slug: 'repack',
    emoji: '🔁',
    titleKey: 'tools.card_repack' as const,
    descKey: 'tools.card_repack_desc' as const,
    accent: { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)', hover: 'rgba(16,185,129,0.35)', color: '#34d399' },
  },
  {
    slug: 'uniqueize',
    emoji: '✍️',
    titleKey: 'tools.card_uniqueizer' as const,
    descKey: 'tools.card_uniqueizer_desc' as const,
    accent: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)', hover: 'rgba(245,158,11,0.35)', color: '#fbbf24' },
  },
]

export default function ToolsPage() {
  const { t } = useLang()

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">{t('tools.title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.hub_subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {TOOL_CARDS.map((card) => (
          <Link
            key={card.slug}
            href={`/tools/${card.slug}`}
            className="flex flex-col gap-2 p-5 rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: card.accent.bg, border: `1px solid ${card.accent.border}` }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = card.accent.hover)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = card.accent.border)}
          >
            <span className="text-2xl">{card.emoji}</span>
            <span className="text-sm font-semibold leading-snug" style={{ color: card.accent.color }}>{t(card.titleKey)}</span>
            <span className="text-xs text-slate-500 leading-relaxed">{t(card.descKey)}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
