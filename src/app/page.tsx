import Link from 'next/link'
import type { Metadata } from 'next'
import HeroSection from '@/components/landing/HeroSection'
import RevealInit from '@/components/landing/RevealInit'
import TiltInit from '@/components/landing/TiltInit'
import CursorGlow from '@/components/landing/CursorGlow'
import ScrollProgress from '@/components/landing/ScrollProgress'
import AnimatedCounter from '@/components/landing/AnimatedCounter'
import FaqAccordion from '@/components/landing/FaqAccordion'

export const metadata: Metadata = {
  title: 'YouTubeGen — От идеи до YouTube-видео за 10 минут',
  description:
    'Автоматическое создание YouTube-видео с AI. Сценарий, озвучка на 28 языках (321 голос), субтитры, иллюстрации и SEO — всё за 10 минут.',
}

const STEPS = [
  { n: '01', icon: '💡', title: 'Тема',         desc: 'Введите тему, укажите длительность, стиль и целевую аудиторию' },
  { n: '02', icon: '✍️', title: 'Сценарий',     desc: 'AI пишет профессиональный сценарий за 10–30 секунд' },
  { n: '03', icon: '🎙️', title: 'Озвучка',      desc: 'Нейросеть озвучивает — 321 голос, 28 языков на выбор' },
  { n: '04', icon: '📋', title: 'Субтитры',     desc: 'AI расставляет субтитры с точными тайм-кодами' },
  { n: '05', icon: '🖼️', title: 'Иллюстрации', desc: 'AI генерирует уникальные изображения 16:9 для каждой сцены' },
  { n: '06', icon: '🎬', title: 'Видео',        desc: 'Автоматически собирает финальное Full HD видео с аудио и субтитрами' },
  { n: '07', icon: '🔍', title: 'SEO',          desc: 'AI пишет цепляющий заголовок, описание и теги для YouTube' },
]

const BENEFITS = [
  { icon: '⚡', title: 'Экономия времени',  desc: '10 минут вместо 10 часов. Весь пайплайн — от темы до готового видео — полностью автоматизирован.' },
  { icon: '🌍', title: '28 языков озвучки', desc: 'Русский, английский, испанский, французский, немецкий, японский, китайский и ещё 21 язык.' },
  { icon: '🎙️', title: '321 голос на выбор', desc: 'Мужские, женские, молодые, взрослые — выберите голос под стиль и тему своего канала.' },
  { icon: '🖼️', title: 'AI-иллюстрации',   desc: 'Нейросеть генерирует уникальные изображения под каждую сцену. Никаких стоковых фото.' },
  { icon: '📊', title: 'SEO-оптимизация',   desc: 'AI автоматически пишет заголовок, описание и теги под алгоритм YouTube.' },
  { icon: '💰', title: 'Тарифы от $9/мес',  desc: '20 бесплатных кредитов при регистрации. Без скрытых платежей и привязки карты.' },
]

const PLANS = [
  {
    name: 'Starter', price: '9',  credits: 100,
    features: ['100 кредитов в месяц', '~6–8 видео в месяц', 'Все инструменты генерации', 'Email-поддержка'],
    cta: 'Начать', highlight: false,
  },
  {
    name: 'Pro',     price: '19', credits: 300,
    features: ['300 кредитов в месяц', '~20 видео в месяц', 'Все инструменты генерации', 'Экспорт в 4K', 'Приоритетная поддержка'],
    cta: 'Выбрать Pro', highlight: true,
  },
  {
    name: 'Agency',  price: '49', credits: 1000,
    features: ['1000 кредитов в месяц', '~66+ видео в месяц', 'Все инструменты генерации', 'Экспорт в 4K', 'API-доступ', 'Выделенная поддержка'],
    cta: 'Выбрать Agency', highlight: false,
  },
]

const TESTIMONIALS = [
  { text: 'Создал первое видео за 8 минут. Раньше тратил весь день на монтаж.', name: 'Алексей К.',  role: 'YouTube-блогер' },
  { text: 'Теперь веду 3 канала параллельно. YouTubeGen экономит мне 40+ часов в месяц.', name: 'Мария В.', role: 'Контент-маркетолог' },
  { text: 'Голоса звучат натурально, SEO реально работает. Подписчики растут.', name: 'Дмитрий С.', role: 'Предприниматель' },
]

const BG = '#0A0A0F'
const DIV_LINE = '1px solid rgba(255,255,255,0.05)'

export default function LandingPage() {
  return (
    <div className="flex flex-col" style={{ background: BG }}>

      {/* ── Global interactive components ─────────────────── */}
      <RevealInit />
      <TiltInit />
      <CursorGlow />
      <ScrollProgress />

      {/* ── Hero ──────────────────────────────────────────── */}
      <HeroSection />

      {/* ── How it works ──────────────────────────────────── */}
      <section id="how-it-works" className="py-28 relative" style={{ background: BG }}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 reveal">
            <p className="text-violet-400 text-sm font-semibold uppercase tracking-widest mb-3">Пайплайн</p>
            <h2 className="text-5xl font-extrabold gradient-text mb-4">AI делает всё сам</h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              7 шагов от темы до готового видео. Ваша задача — ввести тему и нажать кнопку.
            </p>
          </div>

          {/* Steps — staggered reveal-left */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {STEPS.map((step, i) => (
              <div
                key={step.n}
                data-tilt
                className="card-dark rounded-2xl p-6 reveal-left"
                style={{ transitionDelay: `${i * 70}ms` }}
              >
                <div className="flex items-start justify-between mb-4">
                  <span className="text-3xl">{step.icon}</span>
                  <span className="text-4xl font-black leading-none select-none" style={{ color: 'rgba(124,58,237,0.2)' }}>
                    {step.n}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-slate-100 mb-2">{step.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-12 reveal">
            <Link href="/auth/register" className="btn-gradient inline-block px-8 py-3.5 text-white font-semibold rounded-xl">
              Попробовать бесплатно →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Benefits ──────────────────────────────────────── */}
      <section className="py-28 relative" style={{ background: 'linear-gradient(to bottom, #0A0A0F, #0D0B16, #0A0A0F)' }}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-px bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 reveal">
            <p className="text-blue-400 text-sm font-semibold uppercase tracking-widest mb-3">Преимущества</p>
            <h2 className="text-5xl font-extrabold gradient-text mb-4">Почему YouTubeGen</h2>
            <p className="text-xl text-slate-400">Профессиональный контент без команды и технических знаний</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {BENEFITS.map((b, i) => (
              <div
                key={b.title}
                data-tilt
                className="card-dark rounded-2xl p-7 reveal"
                style={{ transitionDelay: `${i * 90}ms` }}
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4"
                  style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)' }}
                >
                  {b.icon}
                </div>
                <h3 className="text-lg font-semibold text-slate-100 mb-2">{b.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Demo ──────────────────────────────────────────── */}
      <section className="py-28" style={{ background: BG }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10 reveal">
            <p className="text-pink-400 text-sm font-semibold uppercase tracking-widest mb-3">Демо</p>
            <h2 className="text-5xl font-extrabold gradient-text mb-4">Посмотри как это работает</h2>
            <p className="text-xl text-slate-400">Студия YouTubeGen — 7 шагов в одном месте</p>
          </div>

          <div
            className="reveal rounded-3xl overflow-hidden aspect-video flex items-center justify-center mb-4"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 0 80px rgba(124,58,237,0.1)' }}
          >
            <div className="text-center px-4">
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)' }}>
                <svg className="w-10 h-10 text-violet-400 ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <p className="text-slate-300 font-medium text-lg mb-1">Демо-видео скоро появится</p>
              <p className="text-slate-600 text-sm">Пока что — попробуй сам бесплатно</p>
              <Link href="/auth/register" className="btn-gradient inline-block mt-5 px-6 py-2.5 text-white text-sm font-semibold rounded-xl">
                Начать бесплатно →
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-2 reveal">
            {STEPS.map((step) => (
              <div key={step.n} className="card-dark rounded-xl p-2 sm:p-3 text-center">
                <div className="text-lg sm:text-2xl mb-1">{step.icon}</div>
                <div className="text-xs text-slate-600 font-medium leading-tight hidden sm:block">{step.title}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats bar — animated counters ─────────────────── */}
      <div
        className="py-14"
        style={{ background: 'rgba(124,58,237,0.05)', borderTop: '1px solid rgba(124,58,237,0.15)', borderBottom: '1px solid rgba(124,58,237,0.15)' }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-white/[0.06] text-center reveal">
            {[
              { to: 100,  suffix: '+',    label: 'пользователей' },
              { to: 500,  suffix: '+',    label: 'видео создано' },
              { to: 28,   suffix: '',     label: 'языков поддерживается' },
              { to: 10,   suffix: ' мин', label: 'среднее время создания' },
            ].map((s) => (
              <div key={s.label} className="px-6 py-2">
                <div className="text-4xl font-extrabold text-slate-100">
                  <AnimatedCounter to={s.to} suffix={s.suffix} duration={1200} />
                </div>
                <div className="text-sm text-slate-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Testimonials ──────────────────────────────────── */}
      <section className="py-28" style={{ background: BG }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14 reveal">
            <h2 className="text-5xl font-extrabold gradient-text mb-3">Что говорят пользователи</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <div
                key={t.name}
                data-tilt
                className="card-dark rounded-2xl p-6 flex flex-col gap-4 reveal"
                style={{ transitionDelay: `${i * 110}ms` }}
              >
                <div className="flex gap-1">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <svg key={j} className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
                <p className="text-slate-400 text-sm leading-relaxed flex-1">&ldquo;{t.text}&rdquo;</p>
                <div>
                  <p className="text-sm font-semibold text-slate-200">{t.name}</p>
                  <p className="text-xs text-slate-600">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────── */}
      <section id="pricing" className="py-28 relative" style={{ background: 'linear-gradient(to bottom, #0A0A0F, #0D0B18, #0A0A0F)' }}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 reveal">
            <p className="text-violet-400 text-sm font-semibold uppercase tracking-widest mb-3">Тарифы</p>
            <h2 className="text-5xl font-extrabold gradient-text mb-4">Прозрачные цены</h2>
            <p className="text-xl text-slate-400">Начните бесплатно — без карты и скрытых платежей</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-start">
            {PLANS.map((plan, i) => (
              <div
                key={plan.name}
                data-tilt
                className={`relative rounded-2xl p-8 flex flex-col gap-6 reveal ${plan.highlight ? 'pro-card-glow' : 'card-dark'}`}
                style={{
                  transitionDelay: `${i * 80}ms`,
                  ...(plan.highlight ? { background: 'rgba(124,58,237,0.08)' } : {}),
                }}
              >
                {plan.highlight && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="text-white text-xs font-bold px-4 py-1.5 rounded-full whitespace-nowrap" style={{ background: 'linear-gradient(135deg, #7C3AED, #2563EB)' }}>
                      ⭐ Популярный
                    </span>
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">{plan.name}</p>
                  <div className="flex items-end gap-1">
                    <span className="text-5xl font-extrabold text-slate-100">${plan.price}</span>
                    <span className="text-slate-500 mb-2">/мес</span>
                  </div>
                  <p className="text-sm text-violet-400 font-semibold mt-1">{plan.credits} кредитов в месяц</p>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-400">
                      <svg className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                {plan.highlight ? (
                  <Link href="/auth/register" className="btn-gradient mt-auto w-full py-3.5 rounded-xl text-sm font-semibold text-center text-white">
                    {plan.cta}
                  </Link>
                ) : (
                  <Link href="/auth/register" className="btn-ghost-dark mt-auto w-full py-3.5 rounded-xl text-sm font-semibold text-center">
                    {plan.cta}
                  </Link>
                )}
              </div>
            ))}
          </div>

          <div className="text-center mt-10 space-y-2 reveal">
            <p className="text-slate-300 font-medium">
              🎁 <span className="text-violet-400 font-semibold">20 бесплатных кредитов</span> при регистрации — без привязки карты
            </p>
            <p className="text-sm text-slate-600">
              Сценарий 1 кр · Озвучка 2 кр · Субтитры 1 кр · Иллюстрация 1 кр · Видео 2 кр · SEO 1 кр · Полное видео ~12–15 кр
            </p>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────── */}
      <section id="faq" className="py-28" style={{ background: BG }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 reveal">
            <p className="text-blue-400 text-sm font-semibold uppercase tracking-widest mb-3">FAQ</p>
            <h2 className="text-5xl font-extrabold gradient-text mb-4">Частые вопросы</h2>
            <p className="text-xl text-slate-400">Всё что нужно знать перед стартом</p>
          </div>
          <div className="reveal">
            <FaqAccordion />
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────── */}
      <section className="py-28 relative overflow-hidden" style={{ background: 'linear-gradient(to bottom, #0A0A0F, #0F0A1E)' }}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-violet-700/15 rounded-full filter blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[300px] bg-blue-700/10 rounded-full filter blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center reveal">
          <h2 className="text-4xl sm:text-5xl font-extrabold text-slate-100 mb-4 leading-tight">
            Создай своё первое видео{' '}
            <span className="gradient-text">бесплатно</span>
          </h2>
          <p className="text-xl text-slate-400 mb-10">Регистрация за 30 секунд — без карты, без обязательств</p>
          <Link href="/auth/register" className="btn-gradient inline-block px-10 py-4 text-white font-semibold rounded-2xl text-lg">
            Начать бесплатно →
          </Link>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-sm">
            <span className="text-slate-500">✓ 20 кредитов бесплатно</span>
            <span className="hidden sm:block w-px h-4 bg-white/10" />
            <span className="text-slate-500">✓ Без кредитной карты</span>
            <span className="hidden sm:block w-px h-4 bg-white/10" />
            <span className="text-slate-500">✓ Отмена в любой момент</span>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────── */}
      <footer style={{ background: '#060608', borderTop: DIV_LINE }} className="py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 mb-8">
            <div>
              <div className="flex items-center gap-2 font-bold text-xl mb-1">
                <span style={{ background: 'linear-gradient(135deg, #A78BFA, #60A5FA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>▶</span>
                <span className="text-slate-100">YouTubeGen</span>
              </div>
              <p className="text-slate-600 text-sm">Автоматизация YouTube-контента с AI</p>
            </div>
            <nav className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-slate-600">
              <a href="#how-it-works" className="hover:text-slate-300 transition-colors">Как работает</a>
              <a href="#pricing"      className="hover:text-slate-300 transition-colors">Тарифы</a>
              <a href="#faq"          className="hover:text-slate-300 transition-colors">FAQ</a>
              <Link href="/auth/login"     className="hover:text-slate-300 transition-colors">Войти</Link>
              <Link href="/auth/register"  className="hover:text-slate-300 transition-colors">Регистрация</Link>
            </nav>
          </div>
          <div className="pt-6" style={{ borderTop: DIV_LINE }}>
            <p className="text-slate-700 text-sm text-center">© 2026 YouTubeGen. Все права защищены.</p>
          </div>
        </div>
      </footer>

    </div>
  )
}
