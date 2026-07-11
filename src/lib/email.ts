import { Resend } from 'resend'
import { env } from './env'

function getResend() {
  const key = env('RESEND_API_KEY')
  if (!key) return null
  return new Resend(key)
}

const FROM = () => env('RESEND_FROM_EMAIL') || 'Lefiro <noreply@lefiro.co>'
const APP  = () => env('NEXT_PUBLIC_APP_URL') || 'https://lefiro.co'

// ─── shared template wrapper ──────────────────────────────────────────────────

function layout(body: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
      <!-- header -->
      <tr><td style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:32px;text-align:center">
        <p style="margin:0;font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px">🎬 Lefiro</p>
        <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,.75)">Автоматическое создание YouTube-видео с ИИ</p>
      </td></tr>
      <!-- body -->
      <tr><td style="padding:40px 40px 32px">${body}</td></tr>
      <!-- footer -->
      <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #f0f0f0;text-align:center">
        <p style="margin:0;font-size:12px;color:#9ca3af">© 2025 Lefiro · <a href="${APP()}" style="color:#ef4444;text-decoration:none">Открыть сайт</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

function btn(text: string, href: string): string {
  return `<div style="text-align:center;margin:32px 0">
    <a href="${href}" style="display:inline-block;background:#ef4444;color:#fff;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:-0.2px">${text}</a>
  </div>`
}

// ─── 1. Приветственное письмо ─────────────────────────────────────────────────

export async function sendWelcomeEmail(user: { email: string; name?: string | null }) {
  const resend = getResend()
  if (!resend) return

  const name = user.name ?? 'друг'
  const html = layout(`
    <h2 style="margin:0 0 8px;font-size:22px;color:#111">Привет, ${name}! 👋</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.6">
      Добро пожаловать в <strong>Lefiro</strong> — сервис для автоматического создания YouTube-видео с помощью ИИ.
    </p>

    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:20px;margin-bottom:24px">
      <p style="margin:0;font-size:15px;color:#991b1b;font-weight:700">🎁 Вам начислено 30 бесплатных кредитов!</p>
      <p style="margin:6px 0 0;font-size:13px;color:#b91c1c">Этого хватит чтобы создать ваше первое видео с нуля.</p>
    </div>

    ${btn('Создать первое видео →', `${APP()}/studio`)}

    <h3 style="margin:0 0 12px;font-size:15px;color:#111;font-weight:700">Как работает Lefiro — 7 шагов:</h3>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${[
        ['✍️', 'Сценарий', 'Claude AI пишет сценарий по вашей теме'],
        ['🎙️', 'Озвучка', 'Профессиональная AI-озвучка'],
        ['💬', 'Субтитры', 'Whisper AI добавляет точные субтитры'],
        ['🖼️', 'Иллюстрации', 'Уникальные AI-иллюстрации'],
        ['🎬', 'Сборка видео', 'FFmpeg собирает финальный MP4'],
        ['🔍', 'SEO', 'Оптимизированные заголовок, описание и теги'],
        ['✅', 'Готово!', 'Скачайте видео и публикуйте на YouTube'],
      ].map(([icon, step, desc], i) => `
        <tr>
          <td width="32" style="padding:6px 0;vertical-align:top">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#ef4444;color:#fff;border-radius:50%;font-size:11px;font-weight:700">${i + 1}</span>
          </td>
          <td style="padding:6px 0 6px 10px;vertical-align:top">
            <span style="font-size:14px;font-weight:600;color:#111">${icon} ${step}</span>
            <span style="font-size:13px;color:#6b7280"> — ${desc}</span>
          </td>
        </tr>`).join('')}
    </table>
  `)

  try {
    await resend.emails.send({
      from: FROM(),
      to: user.email,
      subject: 'Добро пожаловать в Lefiro! 🎬',
      html,
    })
  } catch (err) {
    console.error('[email] sendWelcomeEmail error:', err)
  }
}

// ─── 2. Видео готово ──────────────────────────────────────────────────────────

export async function sendVideoReadyEmail(
  user: { email: string; name?: string | null },
  project: { id: string; title: string },
) {
  const resend = getResend()
  if (!resend) return

  const name = user.name ?? 'друг'
  const projectUrl = `${APP()}/studio?project_id=${project.id}`

  const html = layout(`
    <h2 style="margin:0 0 8px;font-size:22px;color:#111">Ваше видео готово! 🎉</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.6">
      ${name}, видео по проекту <strong>«${project.title}»</strong> успешно собрано и готово к скачиванию.
    </p>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:24px">
      <p style="margin:0;font-size:14px;color:#166534">
        ✅ Сценарий · ✅ Озвучка · ✅ Субтитры · ✅ Иллюстрации · ✅ Видео
      </p>
      <p style="margin:8px 0 0;font-size:13px;color:#15803d">Все 5 шагов успешно выполнены.</p>
    </div>

    ${btn('Открыть проект →', projectUrl)}

    <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center">
      Не забудьте добавить SEO-описание перед публикацией на YouTube!
    </p>
  `)

  try {
    await resend.emails.send({
      from: FROM(),
      to: user.email,
      subject: `Ваше видео готово! 🎉 — «${project.title}»`,
      html,
    })
  } catch (err) {
    console.error('[email] sendVideoReadyEmail error:', err)
  }
}

// ─── 3. Низкий баланс ─────────────────────────────────────────────────────────

export async function sendLowCreditsEmail(
  user: { email: string; name?: string | null },
  remaining: number,
) {
  const resend = getResend()
  if (!resend) return

  const name = user.name ?? 'друг'

  const plans = [
    { name: 'Starter', credits: 2000,  price: '$19' },
    { name: 'Pro',     credits: 5000,  price: '$39' },
    { name: 'Agency',  credits: 15000, price: '$99' },
  ]

  const html = layout(`
    <h2 style="margin:0 0 8px;font-size:22px;color:#111">Кредиты заканчиваются ⚠️</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.6">
      ${name}, на вашем счёте осталось <strong>${remaining} кредит${remaining === 1 ? '' : remaining < 5 ? 'а' : 'ов'}</strong>.
      Пополните баланс, чтобы продолжить создавать видео.
    </p>

    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:20px;margin-bottom:28px">
      <p style="margin:0;font-size:14px;color:#92400e;font-weight:600">Стоимость операций:</p>
      <p style="margin:8px 0 0;font-size:13px;color:#78350f;line-height:1.8">
        Сценарий — 1 кр · Озвучка — 1–3 кр/1000 симв · Субтитры — 1 кр<br>
        Иллюстрации — 1 кр · Сборка видео — 2 кр · SEO — 1 кр
      </p>
    </div>

    <h3 style="margin:0 0 12px;font-size:15px;color:#111;font-weight:700">Тарифные планы:</h3>
    <table width="100%" cellpadding="0" cellspacing="8" style="border-collapse:separate;border-spacing:0 8px">
      ${plans.map((p, i) => `
        <tr style="background:${i === 1 ? '#fef2f2' : '#f9fafb'};border-radius:10px">
          <td style="padding:14px 16px;border-radius:10px 0 0 10px;border:1px solid ${i === 1 ? '#fecaca' : '#e5e7eb'};border-right:none">
            <span style="font-weight:700;color:#111">${p.name}</span>
            ${i === 1 ? '<span style="margin-left:6px;font-size:11px;background:#ef4444;color:#fff;padding:2px 6px;border-radius:4px">Хит</span>' : ''}
          </td>
          <td style="padding:14px 16px;border-top:1px solid ${i === 1 ? '#fecaca' : '#e5e7eb'};border-bottom:1px solid ${i === 1 ? '#fecaca' : '#e5e7eb'};text-align:center;color:#6b7280;font-size:14px">
            ${p.credits} кредитов
          </td>
          <td style="padding:14px 16px;border-radius:0 10px 10px 0;border:1px solid ${i === 1 ? '#fecaca' : '#e5e7eb'};border-left:none;text-align:right;font-weight:700;color:#ef4444">
            ${p.price}/мес
          </td>
        </tr>`).join('')}
    </table>

    ${btn('Пополнить баланс →', `${APP()}/billing`)}
  `)

  try {
    await resend.emails.send({
      from: FROM(),
      to: user.email,
      subject: `Кредиты заканчиваются — осталось ${remaining} ⚠️`,
      html,
    })
  } catch (err) {
    console.error('[email] sendLowCreditsEmail error:', err)
  }
}

// ─── 4. Реферальный бонус ────────────────────────────────────────────────────

export async function sendReferralBonusEmail(
  referrer: { email: string; name?: string | null },
  newUserEmail: string,
  creditsAdded: number,
  currentBalance: number,
) {
  const resend = getResend()
  if (!resend) return

  const name = referrer.name ?? 'друг'

  const html = layout(`
    <h2 style="margin:0 0 8px;font-size:22px;color:#111">Вы получили ${creditsAdded} кредитов! 🎁</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.6">
      ${name}, по вашей реферальной ссылке зарегистрировался новый пользователь —
      <strong>${newUserEmail}</strong>.
    </p>

    <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:20px;margin-bottom:28px">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:14px;color:#5b21b6">🎁 Начислено кредитов</td>
          <td align="right" style="font-size:20px;font-weight:800;color:#7c3aed">+${creditsAdded}</td>
        </tr>
        <tr>
          <td style="font-size:14px;color:#5b21b6;padding-top:10px;border-top:1px solid #ddd6fe">💰 Текущий баланс</td>
          <td align="right" style="font-size:20px;font-weight:800;color:#7c3aed;padding-top:10px;border-top:1px solid #ddd6fe">${currentBalance} кр.</td>
        </tr>
      </table>
    </div>

    <p style="margin:0 0 8px;font-size:14px;color:#4b5563;">
      Делитесь своей реферальной ссылкой и получайте <strong>${creditsAdded} кредитов</strong> за каждого нового пользователя!
    </p>

    ${btn('Поделиться ссылкой →', `${APP()}/dashboard`)}
  `)

  try {
    await resend.emails.send({
      from: FROM(),
      to: referrer.email,
      subject: `Вы получили ${creditsAdded} кредитов! 🎁 Новый реферал`,
      html,
    })
  } catch (err) {
    console.error('[email] sendReferralBonusEmail error:', err)
  }
}
