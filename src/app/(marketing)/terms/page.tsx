'use client'

import LegalLayout from '@/components/legal/LegalLayout'
import { useLang } from '@/hooks/useLang'

const h2Style = { color: '#CBD5E1', fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', marginTop: '0' }
const pStyle  = { color: '#94A3B8', fontSize: '0.9rem', lineHeight: '1.7', marginBottom: '0' }
const ulStyle = { color: '#94A3B8', fontSize: '0.9rem', lineHeight: '1.7', paddingLeft: '1.25rem', margin: '0' }

function Section({ children }: { children: React.ReactNode }) {
  return <section style={{ marginBottom: '2rem' }}>{children}</section>
}

export default function TermsPage() {
  const { lang } = useLang()
  const ru = lang === 'ru'

  return (
    <LegalLayout titleRu="Условия использования" titleEn="Terms of Service" updated="2026-07-11">

      <Section>
        <h2 style={h2Style}>{ru ? '1. О сервисе' : '1. About the Service'}</h2>
        <p style={pStyle}>
          {ru
            ? 'Lefiro (далее — «сервис», «мы») предоставляет инструменты для создания видеоконтента с использованием искусственного интеллекта. Используя сервис, вы принимаете настоящие условия. Если вы не согласны с ними — не используйте сервис.'
            : 'Lefiro ("the Service", "we") provides AI-powered tools for automating video content creation. By using the Service, you agree to these Terms. If you do not agree, do not use the Service.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '2. Аккаунт' : '2. Account'}</h2>
        <ul style={ulStyle}>
          {ru ? (
            <>
              <li>Для использования сервиса необходима регистрация.</li>
              <li>Вам должно быть не менее 18 лет.</li>
              <li>Вы несёте ответственность за конфиденциальность учётных данных и все действия, совершённые под вашим аккаунтом.</li>
              <li>Один аккаунт на одного пользователя.</li>
            </>
          ) : (
            <>
              <li>Registration is required to use the Service.</li>
              <li>You must be at least 18 years old.</li>
              <li>You are responsible for keeping your credentials confidential and for all activity under your account.</li>
              <li>One account per user.</li>
            </>
          )}
        </ul>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '3. Кредиты и тарифы' : '3. Credits and Plans'}</h2>
        <ul style={ulStyle}>
          {ru ? (
            <>
              <li>Сервис работает на кредитной системе; стоимость каждой операции отображается в интерфейсе.</li>
              <li>Бесплатный тариф предоставляет кредиты однократно при регистрации.</li>
              <li>Платные тарифы пополняют баланс ежемесячно.</li>
              <li>Неиспользованные кредиты сгорают по истечении расчётного периода, если иное не предусмотрено тарифом.</li>
              <li>Мы вправе изменять тарифы с уведомлением по электронной почте не менее чем за 14 дней.</li>
            </>
          ) : (
            <>
              <li>The Service operates on a credit system; the cost of each operation is shown in the interface.</li>
              <li>The free plan grants credits once upon registration.</li>
              <li>Paid plans replenish credits monthly.</li>
              <li>Unused credits expire at the end of the billing period unless the plan provides otherwise.</li>
              <li>We may update pricing with at least 14 days&apos; email notice.</li>
            </>
          )}
        </ul>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '4. Результаты генерации ИИ' : '4. AI Generation Results'}</h2>
        <p style={pStyle}>
          {ru
            ? 'Сервис предоставляет инструменты для создания контента, а не гарантированный результат. Выходные данные генеративного ИИ по своей природе вариативны: стиль изображений, тембр голоса, структура сценария и иные параметры могут отличаться от ожиданий. Используя сервис, вы принимаете эту вариативность.'
            : 'The Service provides tools, not guaranteed outcomes. Generative AI output is inherently variable — image style, voice timbre, script structure, and other parameters may differ from expectations. By using the Service you accept this variability.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '5. Ваш контент и ответственность' : '5. Your Content and Responsibility'}</h2>
        <p style={{ ...pStyle, marginBottom: '0.5rem' }}>
          {ru
            ? 'Вы несёте полную ответственность за контент, создаваемый и публикуемый с помощью сервиса. Вы обязуетесь соблюдать Правила сообщества YouTube, законодательство об авторских правах и иные применимые нормы. Запрещено создание:'
            : 'You are solely responsible for content you create and publish using the Service. You must comply with YouTube Community Guidelines, copyright law, and all other applicable regulations. Prohibited content includes:'}
        </p>
        <ul style={ulStyle}>
          {ru ? (
            <>
              <li>Дезинформации и вводящего в заблуждение контента.</li>
              <li>Контента, нарушающего авторские права или права третьих лиц.</li>
              <li>Материалов, запрещённых законодательством.</li>
            </>
          ) : (
            <>
              <li>Disinformation and misleading content.</li>
              <li>Content that infringes copyright or third-party rights.</li>
              <li>Content prohibited by applicable law.</li>
            </>
          )}
        </ul>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '6. Запрещённое использование' : '6. Prohibited Use'}</h2>
        <p style={{ ...pStyle, marginBottom: '0.5rem' }}>
          {ru ? 'Запрещается:' : 'Prohibited activities include:'}
        </p>
        <ul style={ulStyle}>
          {ru ? (
            <>
              <li>Автоматизированный массовый постинг спама.</li>
              <li>Попытки обойти технические ограничения сервиса.</li>
              <li>Использование сервиса в нарушение действующего законодательства или прав третьих лиц.</li>
            </>
          ) : (
            <>
              <li>Automated bulk spam posting.</li>
              <li>Circumventing the Service&apos;s technical restrictions.</li>
              <li>Using the Service in violation of applicable law or third-party rights.</li>
            </>
          )}
        </ul>
        <p style={{ ...pStyle, marginTop: '0.5rem' }}>
          {ru
            ? 'Нарушение может повлечь немедленную блокировку аккаунта без возврата средств.'
            : 'Violations may result in immediate account termination without refund.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '7. Изменение условий и доступность' : '7. Changes and Availability'}</h2>
        <p style={pStyle}>
          {ru
            ? 'Мы вправе изменять настоящие условия. О существенных изменениях мы уведомим по электронной почте. Продолжение использования сервиса после вступления изменений в силу означает их принятие. Мы не гарантируем непрерывную доступность сервиса и вправе ограничивать или приостанавливать его работу для технического обслуживания.'
            : 'We may update these Terms. Material changes will be communicated by email. Continued use after changes take effect constitutes acceptance. We do not guarantee uninterrupted availability and may restrict or suspend the Service for maintenance.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '8. Ограничение ответственности' : '8. Limitation of Liability'}</h2>
        <p style={pStyle}>
          {ru
            ? 'Сервис предоставляется «как есть», без каких-либо гарантий доступности, точности или пригодности для конкретных целей. Мы не несём ответственности за косвенные, случайные или иные убытки, потерю данных или упущенную выгоду, связанные с использованием сервиса.'
            : 'The Service is provided "as is" without warranty of any kind, including availability, accuracy, or fitness for a particular purpose. We are not liable for indirect, incidental, or consequential damages, data loss, or lost profits arising from use of the Service.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '9. Связь' : '9. Contact'}</h2>
        <p style={pStyle}>
          {ru ? 'По вопросам, связанным с настоящими условиями: ' : 'For questions regarding these Terms: '}
          <a href="mailto:support@lefiro.co" style={{ color: '#818CF8' }}>support@lefiro.co</a>
        </p>
      </Section>

    </LegalLayout>
  )
}
