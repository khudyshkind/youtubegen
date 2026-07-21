'use client'

import LegalLayout from '@/components/legal/LegalLayout'
import { useLang } from '@/hooks/useLang'

const h2Style = { color: '#CBD5E1', fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', marginTop: '0' }
const pStyle  = { color: '#94A3B8', fontSize: '0.9rem', lineHeight: '1.7', marginBottom: '0' }
const ulStyle = { color: '#94A3B8', fontSize: '0.9rem', lineHeight: '1.7', paddingLeft: '1.25rem', margin: '0' }
const linkStyle = { color: '#818CF8' }

function Section({ children, id }: { children: React.ReactNode; id?: string }) {
  return <section id={id} style={{ marginBottom: '2rem' }}>{children}</section>
}

export default function OfferPage() {
  const { lang } = useLang()
  const ru = lang === 'ru'

  return (
    <LegalLayout titleRu="Договор публичной оферты" titleEn="Public Offer Agreement" updated="2026-07-21">

      <Section>
        <h2 style={h2Style}>{ru ? '1. Общие положения' : '1. General Provisions'}</h2>
        <p style={pStyle}>
          {ru
            ? 'Настоящий документ является публичной офертой сервиса Lefiro (далее — «Исполнитель», «сервис») и адресован любому дееспособному физическому лицу (далее — «Заказчик»), выразившему желание воспользоваться услугами сервиса. Акцепт оферты осуществляется путём регистрации аккаунта с подтверждением согласия с условиями настоящего договора, Пользовательским соглашением и Политикой конфиденциальности.'
            : 'This document is a public offer from the Lefiro service (the "Service Provider", "Service") to any legally capable individual (the "Customer") wishing to use the Service. Acceptance of this offer is effected by completing account registration and confirming agreement with these terms, the Terms of Service, and the Privacy Policy.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '2. Предмет договора' : '2. Subject of Contract'}</h2>
        <p style={pStyle}>
          {ru
            ? 'Исполнитель предоставляет Заказчику онлайн-доступ к инструментам автоматизации создания видеоконтента на базе искусственного интеллекта: генерация сценариев, озвучивание, создание изображений и видеороликов, SEO-аналитика YouTube (далее — «Услуги»). Услуги предоставляются посредством кредитной системы: Заказчик заблаговременно пополняет баланс кредитов и расходует их по мере использования функций сервиса.'
            : 'The Service Provider grants the Customer online access to AI-powered video content automation tools: script generation, voiceover synthesis, image and video creation, and YouTube SEO analytics (the "Services"). Services are delivered through a credit system: the Customer pre-loads a credit balance and spends credits when using Service features.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '3. Порядок акцепта и заключения договора' : '3. Acceptance and Contract Formation'}</h2>
        <ul style={ulStyle}>
          {ru ? (
            <>
              <li>Договор считается заключённым с момента завершения регистрации с подтверждением согласия с настоящей офертой, Пользовательским соглашением и Политикой конфиденциальности.</li>
              <li>Заказчик должен быть не моложе 18 лет и обладать полной дееспособностью.</li>
              <li>Принимая оферту, Заказчик подтверждает, что ознакомлен с её условиями и принимает их в полном объёме без каких-либо оговорок.</li>
              <li>Если Заказчик не согласен с условиями оферты, он обязан отказаться от использования сервиса.</li>
            </>
          ) : (
            <>
              <li>The Contract is deemed concluded upon completing registration with confirmation of consent to this Offer, the Terms of Service, and the Privacy Policy.</li>
              <li>The Customer must be at least 18 years of age and have full legal capacity.</li>
              <li>By accepting the Offer, the Customer confirms they have read and fully accept these terms without reservation.</li>
              <li>If the Customer does not agree to the terms, they must refrain from using the Service.</li>
            </>
          )}
        </ul>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '4. Стоимость услуг и порядок оплаты' : '4. Pricing and Payment'}</h2>
        <ul style={ulStyle}>
          {ru ? (
            <>
              <li>Стоимость Услуг определяется действующим прайс-листом, опубликованным в разделе «Тарифы» сервиса. Цены указаны в рублях.</li>
              <li>Оплата производится через Telegram-бота сервиса с использованием платёжного агрегатора ЮKassa (ООО «НКО ЮМани», лицензия Банка России № 3522-К).</li>
              <li>Обязательство Заказчика по оплате считается исполненным с момента поступления денежных средств на счёт Исполнителя.</li>
              <li>Кредиты зачисляются на баланс аккаунта автоматически после подтверждения платежа, как правило, в течение нескольких минут.</li>
              <li>Исполнитель вправе изменять цены, уведомив Заказчика по электронной почте не менее чем за 14 дней до вступления изменений в силу.</li>
            </>
          ) : (
            <>
              <li>Service pricing is defined by the current price list published in the "Billing" section of the Service. Prices are shown in Russian rubles.</li>
              <li>Payment is made via the Service&apos;s Telegram bot using the YooKassa payment aggregator (YuMoney LLC, Bank of Russia license No. 3522-K).</li>
              <li>The Customer&apos;s payment obligation is deemed fulfilled upon receipt of funds in the Service Provider&apos;s account.</li>
              <li>Credits are automatically credited to the account balance after payment confirmation, typically within minutes.</li>
              <li>The Service Provider may change prices with at least 14 days&apos; advance notice to the Customer&apos;s registered email address.</li>
            </>
          )}
        </ul>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '5. Права и обязанности сторон' : '5. Rights and Obligations'}</h2>
        <p style={{ ...pStyle, marginBottom: '0.5rem' }}>
          {ru ? 'Исполнитель обязуется:' : 'The Service Provider shall:'}
        </p>
        <ul style={{ ...ulStyle, marginBottom: '1rem' }}>
          {ru ? (
            <>
              <li>Предоставлять доступ к Услугам в соответствии с оплаченным тарифом.</li>
              <li>Хранить сгенерированные медиафайлы не менее 72 часов с момента их создания.</li>
              <li>Своевременно уведомлять Заказчика об изменениях условий договора.</li>
              <li>Обрабатывать персональные данные Заказчика в соответствии с Политикой конфиденциальности.</li>
            </>
          ) : (
            <>
              <li>Provide access to the Services in accordance with the paid plan.</li>
              <li>Store generated media files for at least 72 hours from creation.</li>
              <li>Notify the Customer of changes to the contract terms in a timely manner.</li>
              <li>Process the Customer&apos;s personal data in accordance with the Privacy Policy.</li>
            </>
          )}
        </ul>
        <p style={{ ...pStyle, marginBottom: '0.5rem' }}>
          {ru ? 'Заказчик обязуется:' : 'The Customer shall:'}
        </p>
        <ul style={ulStyle}>
          {ru ? (
            <>
              <li>Использовать Услуги в соответствии с действующим законодательством и Правилами сообщества YouTube.</li>
              <li>Нести полную ответственность за контент, создаваемый с помощью сервиса.</li>
              <li>Не передавать доступ к аккаунту третьим лицам.</li>
              <li>Хранить загружаемые медиафайлы самостоятельно, с учётом срока хранения, указанного в п. 5.</li>
            </>
          ) : (
            <>
              <li>Use the Services in compliance with applicable law and YouTube Community Guidelines.</li>
              <li>Take full responsibility for content created using the Service.</li>
              <li>Not transfer account access to third parties.</li>
              <li>Download generated media files within the retention period specified in clause 5.</li>
            </>
          )}
        </ul>
      </Section>

      <Section id="s6">
        <h2 style={h2Style}>{ru ? '6. Возврат средств' : '6. Refund Policy'}</h2>
        <ul style={ulStyle}>
          {ru ? (
            <>
              <li>
                <strong style={{ color: '#CBD5E1' }}>Разовое пополнение (неиспользованные кредиты)</strong> — возврат
                возможен в течение 14 дней с даты оплаты, если кредиты не были израсходованы на генерацию контента.
                Заявку направьте на{' '}
                <a href="mailto:support@lefiro.co" style={linkStyle}>support@lefiro.co</a>
                , указав email аккаунта и сумму платежа.
              </li>
              <li>
                <strong style={{ color: '#CBD5E1' }}>Подписка</strong> — пропорциональный возврат за неиспользованные
                дни расчётного периода возможен в течение 14 дней с даты списания, если кредиты подписки не
                расходовались. Заявку направьте на{' '}
                <a href="mailto:support@lefiro.co" style={linkStyle}>support@lefiro.co</a>.
              </li>
              <li>
                <strong style={{ color: '#CBD5E1' }}>Возврат не производится</strong>, если кредиты были хотя бы
                частично израсходованы, либо если с момента оплаты прошло более 14 календарных дней.
              </li>
              <li>
                Возврат осуществляется тем же способом оплаты в течение 10 рабочих дней после подтверждения заявки
                Исполнителем.
              </li>
            </>
          ) : (
            <>
              <li>
                <strong style={{ color: '#CBD5E1' }}>One-time top-up (unused credits)</strong> — refundable within
                14 days of payment, provided no credits were spent on content generation. Send a request to{' '}
                <a href="mailto:support@lefiro.co" style={linkStyle}>support@lefiro.co</a>
                {' '}with your account email and payment amount.
              </li>
              <li>
                <strong style={{ color: '#CBD5E1' }}>Subscription</strong> — a pro-rated refund for unused days
                in the billing period is available within 14 days of the charge, provided no plan credits were spent.
                Send a request to{' '}
                <a href="mailto:support@lefiro.co" style={linkStyle}>support@lefiro.co</a>.
              </li>
              <li>
                <strong style={{ color: '#CBD5E1' }}>No refund</strong> if credits were at least partially spent,
                or if more than 14 calendar days have elapsed since payment.
              </li>
              <li>
                Refunds are issued via the original payment method within 10 business days of request confirmation
                by the Service Provider.
              </li>
            </>
          )}
        </ul>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '7. Ограничение ответственности' : '7. Limitation of Liability'}</h2>
        <p style={pStyle}>
          {ru
            ? 'Сервис предоставляется «как есть». Исполнитель не гарантирует непрерывную доступность, конкретный результат генерации или соответствие результатов ожиданиям Заказчика ввиду вариативной природы генеративного ИИ. Исполнитель не несёт ответственности за косвенные убытки, упущенную выгоду или потерю данных, если они не вызваны умышленными действиями Исполнителя. Совокупная ответственность Исполнителя ограничена суммой, фактически уплаченной Заказчиком за соответствующую Услугу.'
            : 'The Service is provided "as is." The Service Provider does not guarantee uninterrupted availability, a specific generation result, or that results will meet the Customer\'s expectations due to the inherently variable nature of generative AI. The Service Provider is not liable for indirect damages, lost profits, or data loss unless caused by intentional actions of the Service Provider. The Service Provider\'s aggregate liability is limited to the amount actually paid by the Customer for the relevant Service.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '8. Применимое право и разрешение споров' : '8. Governing Law and Disputes'}</h2>
        <p style={pStyle}>
          {ru
            ? 'Договор регулируется законодательством Российской Федерации. Споры разрешаются путём переговоров. При недостижении соглашения — в порядке, предусмотренном действующим законодательством РФ.'
            : 'This Agreement is governed by the laws of the Russian Federation. Disputes shall be resolved through negotiation. If no agreement is reached, disputes shall be settled in accordance with applicable Russian law.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '9. Контактные данные' : '9. Contact Information'}</h2>
        <p style={pStyle}>
          {ru
            ? 'По вопросам исполнения настоящего договора, возвратам и поддержке: '
            : 'For questions regarding this Agreement, refunds, and support: '}
          <a href="mailto:support@lefiro.co" style={linkStyle}>support@lefiro.co</a>
        </p>
      </Section>

    </LegalLayout>
  )
}
