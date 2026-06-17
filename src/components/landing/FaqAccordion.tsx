'use client'

import { useState } from 'react'
import { useLang } from '@/hooks/useLang'

export default function FaqAccordion() {
  const [open, setOpen] = useState<number | null>(null)
  const { t } = useLang()

  const FAQ = [
    { q: t('faq.q1'), a: t('faq.a1') },
    { q: t('faq.q2'), a: t('faq.a2') },
    { q: t('faq.q3'), a: t('faq.a3') },
    { q: t('faq.q4'), a: t('faq.a4') },
    { q: t('faq.q5'), a: t('faq.a5') },
    { q: t('faq.q6'), a: t('faq.a6') },
    { q: t('faq.q7'), a: t('faq.a7') },
    { q: t('faq.q8'), a: t('faq.a8') },
    { q: t('faq.q9'), a: t('faq.a9') },
  ]

  return (
    <div className="divide-y divide-white/[0.06] rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
      {FAQ.map((item, i) => (
        <div key={i} style={{ background: 'rgba(255,255,255,0.02)' }}>
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-white/[0.03]"
          >
            <span className="font-medium text-slate-200">{item.q}</span>
            <span
              className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300"
              style={{
                background: open === i ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.06)',
                border: open === i ? '1px solid rgba(124,58,237,0.5)' : '1px solid rgba(255,255,255,0.1)',
              }}
            >
              <svg
                className={`w-3 h-3 text-slate-400 transition-transform duration-300 ${open === i ? 'rotate-45 text-violet-400' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
            </span>
          </button>
          {open === i && (
            <div className="px-6 pb-5 text-slate-400 text-sm leading-relaxed border-t border-white/[0.05] pt-4">
              {item.a}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
