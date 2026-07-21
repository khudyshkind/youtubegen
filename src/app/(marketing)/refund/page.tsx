'use client'

import Link from 'next/link'
import LegalLayout from '@/components/legal/LegalLayout'
import { useLang } from '@/hooks/useLang'

const pStyle = { color: '#94A3B8', fontSize: '0.9rem', lineHeight: '1.7', marginBottom: '0' }

export default function RefundPage() {
  const { lang } = useLang()
  const ru = lang === 'ru'

  return (
    <LegalLayout titleRu="Политика возвратов" titleEn="Refund Policy" updated="2026-07-21">
      <section style={{ marginBottom: '2rem' }}>
        <p style={pStyle}>
          {ru
            ? 'Условия возврата средств изложены в §6 '
            : 'Refund terms are described in §6 of the '}
          <Link href="/offer#s6" style={{ color: '#818CF8' }}>
            {ru ? 'Договора публичной оферты' : 'Public Offer Agreement'}
          </Link>
          {'.'}
        </p>
      </section>
    </LegalLayout>
  )
}
