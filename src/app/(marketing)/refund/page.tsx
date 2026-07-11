'use client'

import LegalLayout from '@/components/legal/LegalLayout'
import { useLang } from '@/hooks/useLang'

const h2Style = { color: '#CBD5E1', fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', marginTop: '0' }
const pStyle  = { color: '#94A3B8', fontSize: '0.9rem', lineHeight: '1.7', marginBottom: '0' }
const ulStyle = { color: '#94A3B8', fontSize: '0.9rem', lineHeight: '1.7', paddingLeft: '1.25rem', margin: '0' }

function Section({ children }: { children: React.ReactNode }) {
  return <section style={{ marginBottom: '2rem' }}>{children}</section>
}

export default function RefundPage() {
  const { lang } = useLang()
  const ru = lang === 'ru'

  return (
    <LegalLayout titleRu="Политика возвратов" titleEn="Refund Policy" updated="2026-07-11">

      <Section>
        <h2 style={h2Style}>{ru ? '1. Применимость' : '1. Scope'}</h2>
        <p style={pStyle}>
          {ru
            ? 'Настоящая политика распространяется на все покупки через сервис Lefiro — подписки и разовые пополнения кредитов. Пожалуйста, ознакомьтесь с ней до совершения платежа.'
            : 'This policy applies to all purchases through Lefiro — subscriptions and one-time credit top-ups. Please read it before making a payment.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '2. Денежные возвраты' : '2. Monetary Refunds'}</h2>
        <p style={pStyle}>
          {ru
            ? 'По общему правилу, покупки кредитов и подписок являются окончательными и не подлежат возврату. Цифровые продукты потребляются немедленно после активации.'
            : 'As a general rule, credit and subscription purchases are final and non-refundable. Digital products are consumed immediately upon activation.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '3. Исключение: технический сбой' : '3. Exception: Technical Failure'}</h2>
        <p style={pStyle}>
          {ru
            ? <>Если вы оплатили подписку или пополнение, но кредиты не были начислены вследствие технического сбоя на нашей стороне, обратитесь на <a href="mailto:support@lefiro.co" style={{ color: '#818CF8' }}>support@lefiro.co</a> в течение 7 дней с подтверждением транзакции. Мы рассмотрим обращение и при подтверждении сбоя начислим кредиты или вернём оплату.</>
            : <>If you paid for a subscription or top-up but credits were not credited due to a technical failure on our side, contact <a href="mailto:support@lefiro.co" style={{ color: '#818CF8' }}>support@lefiro.co</a> within 7 days with proof of transaction. We will investigate and, if the failure is confirmed, credit your account or issue a refund.</>
          }
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '4. Автоматический возврат кредитов' : '4. Automatic Credit Refund'}</h2>
        <p style={pStyle}>
          {ru
            ? 'Если генерация завершилась ошибкой по причине технического сбоя сервиса (например, сбой провайдера озвучки), кредиты, списанные за данную операцию, возвращаются автоматически в ваш баланс. Ручного обращения в поддержку в этом случае не требуется.'
            : 'If a generation step fails due to a technical service error (e.g., a voiceover provider failure), credits charged for that operation are automatically returned to your balance. No manual support request is needed in that case.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '5. Субъективная неудовлетворённость' : '5. Subjective Dissatisfaction'}</h2>
        <p style={pStyle}>
          {ru
            ? 'Субъективная неудовлетворённость результатами генерации ИИ (стиль голоса, оформление иллюстраций, структура сценария и т. п.) не является основанием для возврата денежных средств. Вариативность является неотъемлемым свойством генеративных технологий, что отражено в Условиях использования.'
            : 'Subjective dissatisfaction with AI generation results (voice style, image aesthetics, script structure, etc.) is not grounds for a monetary refund. Variability is an inherent property of generative AI, as described in the Terms of Service.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '6. Срок действия кредитов' : '6. Credit Expiry'}</h2>
        <p style={pStyle}>
          {ru
            ? 'Кредиты, включённые в тарифный план, действуют в течение расчётного периода. Неиспользованные кредиты не переносятся на следующий период и не подлежат обмену на денежные средства.'
            : 'Credits included in a plan are valid for the billing period. Unused credits do not roll over to the next period and cannot be exchanged for monetary compensation.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '7. Криптовалютные платежи' : '7. Cryptocurrency Payments'}</h2>
        <p style={pStyle}>
          {ru
            ? 'Все платежи осуществляются исключительно в криптовалюте (USDT) через Telegram-бота. Транзакции в блокчейне необратимы. Денежные возвраты на блокчейн-адрес возможны только в случаях, описанных в разделе 3, и производятся в разумные сроки с учётом комиссий сети.'
            : 'All payments are made exclusively in cryptocurrency (USDT) via Telegram bot. Blockchain transactions are irreversible. Monetary refunds to a blockchain address are only possible in the cases described in Section 3 and are processed within a reasonable timeframe accounting for network fees.'}
        </p>
      </Section>

      <Section>
        <h2 style={h2Style}>{ru ? '8. Связь' : '8. Contact'}</h2>
        <p style={pStyle}>
          {ru
            ? <>По вопросам возвратов: <a href="mailto:support@lefiro.co" style={{ color: '#818CF8' }}>support@lefiro.co</a>. Укажите email аккаунта и подтверждение транзакции.</>
            : <>For refund requests: <a href="mailto:support@lefiro.co" style={{ color: '#818CF8' }}>support@lefiro.co</a>. Include your account email and proof of transaction.</>
          }
        </p>
      </Section>

    </LegalLayout>
  )
}
