'use client'

import LegalLayout from '@/components/legal/LegalLayout'
import { useLang } from '@/hooks/useLang'

const h2Style = { color: '#CBD5E1', fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', marginTop: '0' }
const pStyle  = { color: '#94A3B8', fontSize: '0.9rem', lineHeight: '1.7', marginBottom: '0' }
const ulStyle = { color: '#94A3B8', fontSize: '0.9rem', lineHeight: '1.7', paddingLeft: '1.25rem', margin: '0' }

function Section({ children }: { children: React.ReactNode }) {
  return <section style={{ marginBottom: '2rem' }}>{children}</section>
}

export default function PrivacyPage() {
  const { lang } = useLang()
  const ru = lang === 'ru'

  return (
    <LegalLayout titleRu="Политика конфиденциальности" titleEn="Privacy Policy" updated="2026-07-11">

      <Section>
        <p style={pStyle}>
          {ru
            ? 'Мы — сервис Lefiro. Эта политика описывает, какие данные мы собираем, как используем и с кем делимся при использовании нашего сервиса автоматизации YouTube-контента.'
            : 'We are Lefiro. This policy describes what data we collect, how we use it, and who we share it with when you use our YouTube content automation service.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '1. Данные, которые мы собираем' : '1. Data We Collect'}</h2>
        <ul style={ulStyle}>
          {ru ? (
            <>
              <li><strong style={{ color: '#CBD5E1' }}>Аккаунт</strong> — адрес электронной почты при регистрации.</li>
              <li><strong style={{ color: '#CBD5E1' }}>Контент проектов</strong> — темы, сценарии, настройки генерации и созданный медиаконтент (аудио, изображения, видео).</li>
              <li><strong style={{ color: '#CBD5E1' }}>Платёжные данные</strong> — Telegram user ID при оформлении подписки; метаданные криптовалютной транзакции (идентификатор, сумма, статус). Приватные ключи и полные реквизиты кошельков не собираются.</li>
              <li><strong style={{ color: '#CBD5E1' }}>Данные YouTube</strong> — при использовании аналитики: данные каналов, которые вы явно выбираете через YouTube Data API (публичные метрики в рамках ваших прав доступа).</li>
              <li><strong style={{ color: '#CBD5E1' }}>Технические данные</strong> — IP-адрес, тип браузера, операционная система, логи запросов. Собираются автоматически инфраструктурными провайдерами.</li>
            </>
          ) : (
            <>
              <li><strong style={{ color: '#CBD5E1' }}>Account</strong> — email address upon registration.</li>
              <li><strong style={{ color: '#CBD5E1' }}>Project content</strong> — topics, scripts, generation settings, and created media (audio, images, video).</li>
              <li><strong style={{ color: '#CBD5E1' }}>Payment data</strong> — Telegram user ID when subscribing; cryptocurrency transaction metadata (ID, amount, status). Private wallet keys and full wallet credentials are not collected.</li>
              <li><strong style={{ color: '#CBD5E1' }}>YouTube data</strong> — when using analytics: channel data you explicitly select via YouTube Data API (public metrics within your access permissions).</li>
              <li><strong style={{ color: '#CBD5E1' }}>Technical data</strong> — IP address, browser type, OS, request logs. Collected automatically by infrastructure providers.</li>
            </>
          )}
        </ul>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '2. Как мы используем данные' : '2. How We Use Data'}</h2>
        <ul style={ulStyle}>
          {ru ? (
            <>
              <li>Предоставление функций сервиса.</li>
              <li>Передача контента сторонним AI-провайдерам для выполнения генерации (только в рамках конкретного запроса).</li>
              <li>Отправка уведомлений по электронной почте (например, о статусе платежа).</li>
              <li>Обнаружение злоупотреблений и обеспечение безопасности сервиса.</li>
            </>
          ) : (
            <>
              <li>Providing Service features.</li>
              <li>Passing content to third-party AI providers to fulfill generation requests (per-request only).</li>
              <li>Sending email notifications (e.g., payment status).</li>
              <li>Abuse detection and service security.</li>
            </>
          )}
        </ul>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '3. Категории обработчиков данных' : '3. Data Processor Categories'}</h2>
        <p style={{ ...pStyle, marginBottom: '0.5rem' }}>
          {ru
            ? 'Мы передаём данные следующим категориям обработчиков (только в рамках их функций):'
            : 'We share data with the following categories of processors (only within their designated functions):'}
        </p>
        <ul style={ulStyle}>
          {ru ? (
            <>
              <li><strong style={{ color: '#CBD5E1' }}>База данных и аутентификация</strong> — Supabase</li>
              <li><strong style={{ color: '#CBD5E1' }}>Хостинг и CDN</strong> — Vercel</li>
              <li><strong style={{ color: '#CBD5E1' }}>Вычислительный воркер</strong> — Railway</li>
              <li><strong style={{ color: '#CBD5E1' }}>Электронная почта</strong> — Resend</li>
              <li><strong style={{ color: '#CBD5E1' }}>Файловое хранилище</strong> — Backblaze B2</li>
              <li><strong style={{ color: '#CBD5E1' }}>Сторонние AI-провайдеры</strong> — обрабатывают ваш контент при генерации (Anthropic, OpenAI, fal.ai и другие)</li>
              <li><strong style={{ color: '#CBD5E1' }}>YouTube Data API</strong> — предоставляет данные каналов для аналитики</li>
              <li><strong style={{ color: '#CBD5E1' }}>Telegram</strong> — платёжный бот</li>
            </>
          ) : (
            <>
              <li><strong style={{ color: '#CBD5E1' }}>Database and authentication</strong> — Supabase</li>
              <li><strong style={{ color: '#CBD5E1' }}>Hosting and CDN</strong> — Vercel</li>
              <li><strong style={{ color: '#CBD5E1' }}>Compute worker</strong> — Railway</li>
              <li><strong style={{ color: '#CBD5E1' }}>Email</strong> — Resend</li>
              <li><strong style={{ color: '#CBD5E1' }}>File storage</strong> — Backblaze B2</li>
              <li><strong style={{ color: '#CBD5E1' }}>Third-party AI providers</strong> — process your content during generation (Anthropic, OpenAI, fal.ai, and others)</li>
              <li><strong style={{ color: '#CBD5E1' }}>YouTube Data API</strong> — provides channel data for analytics</li>
              <li><strong style={{ color: '#CBD5E1' }}>Telegram</strong> — payment bot</li>
            </>
          )}
        </ul>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '4. Cookies и локальное хранилище' : '4. Cookies and Local Storage'}</h2>
        <p style={{ ...pStyle, marginBottom: '0.5rem' }}>
          {ru
            ? 'Мы используем исключительно технические средства хранения:'
            : 'We use only technical storage mechanisms:'}
        </p>
        <ul style={ulStyle}>
          {ru ? (
            <>
              <li><strong style={{ color: '#CBD5E1' }}>HTTP cookies</strong> — сессия аутентификации Supabase. Необходимы для работы аккаунта.</li>
              <li><strong style={{ color: '#CBD5E1' }}>localStorage</strong>: <code style={{ color: '#A78BFA' }}>yt-lang</code> — выбор языка интерфейса; <code style={{ color: '#A78BFA' }}>onboarding_template</code> — состояние онбординга при первом входе.</li>
            </>
          ) : (
            <>
              <li><strong style={{ color: '#CBD5E1' }}>HTTP cookies</strong> — Supabase authentication session. Required for account functionality.</li>
              <li><strong style={{ color: '#CBD5E1' }}>localStorage</strong>: <code style={{ color: '#A78BFA' }}>yt-lang</code> — interface language preference; <code style={{ color: '#A78BFA' }}>onboarding_template</code> — onboarding state on first login.</li>
            </>
          )}
        </ul>
        <p style={{ ...pStyle, marginTop: '0.5rem' }}>
          {ru
            ? 'Рекламные трекеры, Google Analytics, Facebook Pixel и аналогичные системы слежения не используются.'
            : 'Advertising trackers, Google Analytics, Facebook Pixel, and similar tracking systems are not used.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '5. YouTube API Services' : '5. YouTube API Services'}</h2>
        <p style={pStyle}>
          {ru
            ? <>Сервис использует YouTube Data API Services для предоставления аналитики YouTube-каналов. Используя функции аналитики, вы соглашаетесь с <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#818CF8' }}>Политикой конфиденциальности Google</a>. Вы можете отозвать доступ приложения к вашим данным Google через <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" style={{ color: '#818CF8' }}>страницу управления доступом Google</a>.</>
            : <>The Service uses YouTube Data API Services to provide YouTube channel analytics. By using analytics features, you agree to the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#818CF8' }}>Google Privacy Policy</a>. You can revoke the application&apos;s access to your Google data via the <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" style={{ color: '#818CF8' }}>Google permissions page</a>.</>
          }
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '6. Хранение данных' : '6. Data Retention'}</h2>
        <ul style={ulStyle}>
          {ru ? (
            <>
              <li>Данные аккаунта и контент проектов хранятся до удаления аккаунта.</li>
              <li>Созданный медиаконтент (аудио, изображения, видео) хранится ограниченное время согласно вашему тарифу; по истечении срока хранения мы вправе удалять файлы.</li>
              <li>При удалении аккаунта данные удаляются из наших систем в разумные сроки.</li>
            </>
          ) : (
            <>
              <li>Account data and project content are retained until account deletion.</li>
              <li>Created media files (audio, images, video) are retained for a limited period according to your plan; after the retention period expires, we may delete the files.</li>
              <li>Upon account deletion, data is removed from our systems within a reasonable timeframe.</li>
            </>
          )}
        </ul>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '7. Ваши права' : '7. Your Rights'}</h2>
        <p style={{ ...pStyle, marginBottom: '0.5rem' }}>
          {ru ? 'Вы вправе:' : 'You have the right to:'}
        </p>
        <ul style={ulStyle}>
          {ru ? (
            <>
              <li>Получить доступ к своим данным.</li>
              <li>Исправить неточные данные.</li>
              <li>Удалить аккаунт (через настройки или по запросу на support@lefiro.co).</li>
              <li>Запросить экспорт своих данных.</li>
            </>
          ) : (
            <>
              <li>Access your data.</li>
              <li>Correct inaccurate data.</li>
              <li>Delete your account (via settings or by emailing support@lefiro.co).</li>
              <li>Request a data export.</li>
            </>
          )}
        </ul>
        <p style={{ ...pStyle, marginTop: '0.5rem' }}>
          {ru
            ? <>Для реализации прав обратитесь на <a href="mailto:support@lefiro.co" style={{ color: '#818CF8' }}>support@lefiro.co</a>.</>
            : <>To exercise these rights, contact <a href="mailto:support@lefiro.co" style={{ color: '#818CF8' }}>support@lefiro.co</a>.</>
          }
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '8. Изменения политики' : '8. Policy Changes'}</h2>
        <p style={pStyle}>
          {ru
            ? 'Мы вправе обновлять эту политику. О существенных изменениях мы уведомим по электронной почте. Дата последнего обновления указана вверху страницы.'
            : 'We may update this policy. Material changes will be communicated by email. The last updated date is shown at the top of this page.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '9. Связь' : '9. Contact'}</h2>
        <p style={pStyle}>
          <a href="mailto:support@lefiro.co" style={{ color: '#818CF8' }}>support@lefiro.co</a>
        </p>
      </Section>

    </LegalLayout>
  )
}
