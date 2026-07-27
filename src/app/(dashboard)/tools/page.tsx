'use client'

import Link from 'next/link'
import { useLang } from '@/hooks/useLang'
import { TOOL_CARDS } from '@/lib/content-config'

export default function ToolsPage() {
  const { t } = useLang()

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">{t('tools.hub_title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('tools.hub_subtitle')}</p>
        <p className="text-slate-600 text-sm mt-2">
          {t('tools.studio_hint')}{' '}
          <Link href="/studio" className="text-violet-400 hover:text-violet-300 transition-colors">
            {t('tools.studio_link')}
          </Link>
        </p>
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
