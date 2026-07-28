'use client'

import { useState } from 'react'
import { useLang } from '@/hooks/useLang'
import { CREDIT_COSTS } from '@/lib/types'

export default function FaqAccordion() {
  const [open, setOpen] = useState<number | null>(null)
  const { t } = useLang()

  // UI engines: flux_schnell (100), secretslider (200), flux (780), nano_banana (1170).
  // gpt_mini excluded — hidden from UI via HIDDEN_ENGINES in Step5Images.tsx.
  const faq4ImgMin = Math.min(CREDIT_COSTS.image_flux_schnell, CREDIT_COSTS.image_secretslider, CREDIT_COSTS.image_flux, CREDIT_COSTS.image_nano_banana)
  const faq4ImgMax = Math.max(CREDIT_COSTS.image_flux_schnell, CREDIT_COSTS.image_secretslider, CREDIT_COSTS.image_flux, CREDIT_COSTS.image_nano_banana)
  const faq4Answer = t('faq.a4')
    .replace('{cost_s_min}', String(CREDIT_COSTS.script_sonnet))
    .replace('{cost_s_max}', String(CREDIT_COSTS.script_opus))
    .replace('{cost_i_min}', String(faq4ImgMin))
    .replace('{cost_i_max}', String(faq4ImgMax))
    .replace('{cost_vid}', String(CREDIT_COSTS.video))
    .replace('{cost_seo}', String(CREDIT_COSTS.seo))

  const FAQ = [
    { q: t('faq.q1'), a: t('faq.a1') },
    { q: t('faq.q2'), a: t('faq.a2') },
    { q: t('faq.q3'), a: t('faq.a3') },
    { q: t('faq.q4'), a: faq4Answer },
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
