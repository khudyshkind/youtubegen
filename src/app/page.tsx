import type { Metadata } from 'next'
import LandingBody from '@/components/landing/LandingBody'

export const metadata: Metadata = {
  title: 'YouTubeGen — От идеи до YouTube-видео за 10 минут',
  description:
    'Автоматическое создание YouTube-видео с AI. Сценарий, озвучка на 28 языках (321 голос), субтитры, иллюстрации и SEO — всё за 10 минут.',
}

export default function LandingPage() {
  return <LandingBody />
}
