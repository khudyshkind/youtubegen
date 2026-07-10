import type { Metadata } from 'next'
import LandingBody from '@/components/landing/LandingBody'

export const metadata: Metadata = {
  title: 'Lefiro — От идеи до YouTube-видео за 10 минут',
  description:
    'Автоматическое создание YouTube-видео с AI. Сценарий, озвучка на 28 языках (321 голос), субтитры, иллюстрации и SEO — всё за 10 минут.',
}

async function getUsdToRub(): Promise<number> {
  try {
    const res = await fetch(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
      { next: { revalidate: 3600 } }
    )
    const data = await res.json()
    return data.usd?.rub ?? 90
  } catch {
    return 90
  }
}

export default async function LandingPage() {
  const usdToRub = await getUsdToRub()
  return <LandingBody usdToRub={usdToRub} />
}
