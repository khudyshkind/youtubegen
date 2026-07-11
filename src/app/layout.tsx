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
    default: 'Lefiro — Автоматическая генерация YouTube-видео',
    template: '%s | Lefiro',
  },
  description:
    'Создавайте YouTube-видео на автопилоте: сценарий, озвучка, субтитры, иллюстрации и SEO — всё в одном месте.',
  keywords: ['youtube', 'генерация видео', 'автоматизация', 'контент', 'ИИ'],
  applicationName: 'Lefiro',
  openGraph: {
    siteName: 'Lefiro',
    title: 'Lefiro',
    description: 'Автоматическая генерация YouTube-видео с помощью ИИ',
    url: 'https://lefiro.co',
    type: 'website',
    locale: 'ru_RU',
  },
  twitter: {
    card: 'summary_large_image',
    site: 'Lefiro',
    title: 'Lefiro',
    description: 'Автоматическая генерация YouTube-видео с помощью ИИ',
  },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-screen flex flex-col text-gray-900" style={{ background: '#0A0A0F' }}>
        <Navbar />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  )
}
