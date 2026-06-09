import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'YouTubeGen — Автоматическая генерация YouTube-видео с ИИ',
}

const PIPELINE_STEPS = [
  { n: '01', title: 'Тема', desc: 'Введите тему и настройте длительность, стиль и аудиторию' },
  { n: '02', title: 'Сценарий', desc: 'Claude AI пишет готовый к озвучке сценарий за секунды' },
  { n: '03', title: 'Озвучка', desc: 'ElevenLabs озвучивает текст естественным голосом' },
  { n: '04', title: 'Субтитры', desc: 'OpenAI Whisper точно расставляет субтитры с таймингом' },
  { n: '05', title: 'Иллюстрации', desc: 'Flux генерирует картинки для каждой сцены' },
  { n: '06', title: 'Видео + SEO', desc: 'FFmpeg собирает видео, Claude пишет заголовок и теги' },
]

const FEATURES = [
  {
    icon: '✍️',
    title: 'Умный сценарий',
    desc: 'Claude Opus пишет сценарий под вашу тему, аудиторию и стиль. Готов к озвучке без правок.',
  },
  {
    icon: '🎙',
    title: 'Живая озвучка',
    desc: 'ElevenLabs с библиотекой из 1000+ голосов на русском языке. Звучит как настоящий диктор.',
  },
  {
    icon: '📋',
    title: 'Точные субтитры',
    desc: 'Whisper от OpenAI расставляет субтитры с точностью до миллисекунды. Без ручной правки.',
  },
  {
    icon: '🎨',
    title: 'AI-иллюстрации',
    desc: 'Flux генерирует уникальные изображения для каждой сцены в формате 16:9.',
  },
  {
    icon: '🎬',
    title: 'Сборка видео',
    desc: 'FFmpeg собирает финальное видео с иллюстрациями, аудио и субтитрами.',
  },
  {
    icon: '🔍',
    title: 'SEO-оптимизация',
    desc: 'Claude пишет цепляющий заголовок, описание и теги под алгоритм YouTube.',
  },
]

const PLANS = [
  {
    name: 'Free',
    price: '0',
    period: '',
    credits: 5,
    features: ['5 кредитов при регистрации', 'Все инструменты генерации', 'Базовая поддержка'],
    cta: 'Начать бесплатно',
    href: '/auth/register',
    highlight: false,
  },
  {
    name: 'Starter',
    price: '9',
    period: '/мес',
    credits: 50,
    features: ['50 кредитов в месяц', 'Все инструменты генерации', 'Email-поддержка'],
    cta: 'Выбрать план',
    href: '/auth/register',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '19',
    period: '/мес',
    credits: 200,
    features: ['200 кредитов в месяц', 'Все инструменты генерации', 'Приоритетная поддержка', 'Экспорт в 4K'],
    cta: 'Выбрать Pro',
    href: '/auth/register',
    highlight: true,
  },
  {
    name: 'Agency',
    price: '49',
    period: '/мес',
    credits: 1000,
    features: ['1000 кредитов в месяц', 'Все инструменты генерации', 'Выделенная поддержка', 'API-доступ'],
    cta: 'Выбрать Agency',
    href: '/auth/register',
    highlight: false,
  },
]

export default function LandingPage() {
  return (
    <div className="flex flex-col">

      {/* ─── Hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-white">
        <div className="absolute inset-0 bg-gradient-to-br from-red-50 via-white to-orange-50 pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-28 text-center">
          <div className="inline-flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm font-medium rounded-full px-4 py-1.5 mb-8">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            5 кредитов бесплатно при регистрации
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            От идеи до
            <span className="text-red-500"> YouTube-видео</span>
            <br />за 10 минут
          </h1>

          <p className="max-w-2xl mx-auto text-xl text-gray-600 mb-10 leading-relaxed">
            Автоматизируйте создание контента: ИИ пишет сценарий, ElevenLabs
            озвучивает, Whisper добавляет субтитры, Flux генерирует иллюстрации —
            всё в одном пайплайне.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/auth/register"
              className="w-full sm:w-auto px-8 py-4 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-2xl text-lg transition-colors shadow-lg shadow-red-200"
            >
              Начать бесплатно →
            </Link>
            <a
              href="#how-it-works"
              className="w-full sm:w-auto px-8 py-4 bg-white border-2 border-gray-200 hover:border-gray-300 text-gray-700 font-semibold rounded-2xl text-lg transition-colors"
            >
              Как это работает ↓
            </a>
          </div>

          <p className="mt-6 text-sm text-gray-500">Не нужна кредитная карта · Регистрация за 30 секунд</p>
        </div>
      </section>

      {/* ─── Pipeline steps ───────────────────────────────── */}
      <section id="how-it-works" className="py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Как это работает</h2>
            <p className="text-xl text-gray-600">Шесть шагов от темы до готового видео</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {PIPELINE_STEPS.map((step) => (
              <div
                key={step.n}
                className="bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-md transition-shadow"
              >
                <div className="text-4xl font-black text-red-100 mb-3">{step.n}</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{step.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features ─────────────────────────────────────── */}
      <section className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Всё что нужно для контента</h2>
            <p className="text-xl text-gray-600">Профессиональные инструменты в одном рабочем пространстве</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex flex-col gap-3">
                <div className="text-4xl">{f.icon}</div>
                <h3 className="text-lg font-semibold text-gray-900">{f.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing ──────────────────────────────────────── */}
      <section id="pricing" className="py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Прозрачные тарифы</h2>
            <p className="text-xl text-gray-600">Начните бесплатно, расширяйте по мере роста</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 items-start">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative bg-white rounded-2xl border-2 p-6 flex flex-col gap-6 ${
                  plan.highlight
                    ? 'border-red-500 shadow-xl shadow-red-100'
                    : 'border-gray-200'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                      Популярный
                    </span>
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">{plan.name}</p>
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-extrabold text-gray-900">${plan.price}</span>
                    <span className="text-gray-500 mb-1">{plan.period}</span>
                  </div>
                  <p className="text-sm text-amber-600 font-medium mt-1">{plan.credits} кредитов</p>
                </div>

                <ul className="flex flex-col gap-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                      <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.href}
                  className={`mt-auto w-full py-3 rounded-xl text-sm font-semibold text-center transition-colors ${
                    plan.highlight
                      ? 'bg-red-500 hover:bg-red-600 text-white'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>

          <p className="text-center text-sm text-gray-500 mt-8">
            1 кредит = 1 операция. Стоимость: сценарий 10 кр · озвучка 5 кр/мин · субтитры 3 кр · иллюстрация 8 кр · SEO 5 кр
          </p>
        </div>
      </section>

      {/* ─── CTA ──────────────────────────────────────────── */}
      <section className="py-24 bg-gray-900">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-bold text-white mb-4">
            Готовы автоматизировать контент?
          </h2>
          <p className="text-xl text-gray-400 mb-10">
            Зарегистрируйтесь и получите 5 кредитов бесплатно прямо сейчас.
          </p>
          <Link
            href="/auth/register"
            className="inline-block px-10 py-4 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-2xl text-lg transition-colors shadow-lg shadow-red-900/40"
          >
            Начать бесплатно →
          </Link>
        </div>
      </section>

      {/* ─── Footer ───────────────────────────────────────── */}
      <footer className="bg-gray-900 border-t border-gray-800 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-white font-bold">
            <span className="text-red-500">▶</span> YouTubeGen
          </div>
          <p className="text-gray-500 text-sm">© {new Date().getFullYear()} YouTubeGen. Все права защищены.</p>
          <div className="flex gap-6 text-sm text-gray-500">
            <Link href="/auth/login" className="hover:text-gray-300 transition-colors">Войти</Link>
            <Link href="/auth/register" className="hover:text-gray-300 transition-colors">Регистрация</Link>
            <a href="#pricing" className="hover:text-gray-300 transition-colors">Тарифы</a>
          </div>
        </div>
      </footer>

    </div>
  )
}
