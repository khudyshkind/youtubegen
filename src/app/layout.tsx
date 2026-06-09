import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import Navbar from '@/components/shared/Navbar'

const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin', 'latin-ext'],
})

export const metadata: Metadata = {
  title: {
    default: 'YouTubeGen — Автоматическая генерация YouTube-видео',
    template: '%s | YouTubeGen',
  },
  description:
    'Создавайте YouTube-видео на автопилоте: сценарий, озвучка, субтитры, иллюстрации и SEO — всё в одном месте.',
  keywords: ['youtube', 'генерация видео', 'автоматизация', 'контент', 'ИИ'],
  openGraph: {
    title: 'YouTubeGen',
    description: 'Автоматическая генерация YouTube-видео с помощью ИИ',
    type: 'website',
    locale: 'ru_RU',
  },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">
        <Navbar />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  )
}
