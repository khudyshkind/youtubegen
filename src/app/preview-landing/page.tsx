// /preview-landing — preview route for LandingV2.
// Loads Fraunces via next/font (only new dependency — next/font is built-in).
// Existing src/app/page.tsx (old landing) is NOT modified.

import type { Metadata }  from 'next'
import { Fraunces }       from 'next/font/google'
import LandingV2          from '@/components/landing-v2/LandingV2'

export const metadata: Metadata = {
  title: 'Preview: Landing v2 | Lefiro',
  robots: { index: false, follow: false },
}

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets:  ['latin'],
  display:  'swap',
  weight:   ['400', '700'],
})

// Шаг 3 обоснование (Fraunces):
// Редко применяется в productivity/SaaS категории; высокий x-height на 72px+;
// засечки создают контраст с геометричным Geist на теле;
// ассоциируется с "авторитетным голосом" (editorial quality), что подходит
// сервису, который "пишет за тебя".
export default function PreviewLandingPage() {
  return (
    <div className={fraunces.variable}>
      <LandingV2 />
    </div>
  )
}
