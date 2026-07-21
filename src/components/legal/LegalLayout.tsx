'use client'

import Link from 'next/link'
import { useLang } from '@/hooks/useLang'

interface Props {
  titleRu: string
  titleEn: string
  updated: string
  children: React.ReactNode
}

export default function LegalLayout({ titleRu, titleEn, updated, children }: Props) {
  const { lang, setLang } = useLang()

  return (
    <div style={{ background: '#0A0A0F', minHeight: '100vh', color: '#F1F5F9' }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">

        {/* Top bar */}
        <div className="flex items-center justify-between mb-10">
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
            ← Lefiro
          </Link>
          <button
            onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.5rem', padding: '0.25rem 0.75rem' }}
          >
            {lang === 'ru' ? 'EN' : 'RU'}
          </button>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-extrabold text-slate-100 mb-1">
          {lang === 'ru' ? titleRu : titleEn}
        </h1>
        <p className="text-sm mb-10" style={{ color: 'rgba(100,116,139,0.9)' }}>
          {lang === 'ru' ? `Последнее обновление: ${updated}` : `Last updated: ${updated}`}
        </p>

        {/* Page content */}
        {children}

        {/* Cross-links */}
        <div
          className="mt-16 pt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: 'rgba(71,85,105,1)' }}
        >
          <Link href="/offer"   className="hover:text-slate-400 transition-colors">
            {lang === 'ru' ? 'Публичная оферта' : 'Public Offer'}
          </Link>
          <Link href="/terms"   className="hover:text-slate-400 transition-colors">
            {lang === 'ru' ? 'Условия использования' : 'Terms of Service'}
          </Link>
          <Link href="/privacy" className="hover:text-slate-400 transition-colors">
            {lang === 'ru' ? 'Политика конфиденциальности' : 'Privacy Policy'}
          </Link>
          <Link href="/refund"  className="hover:text-slate-400 transition-colors">
            {lang === 'ru' ? 'Политика возвратов' : 'Refund Policy'}
          </Link>
          <a href="mailto:support@lefiro.co" className="hover:text-slate-400 transition-colors">
            support@lefiro.co
          </a>
        </div>

      </div>
    </div>
  )
}
