'use client'

import { useState } from 'react'

const FAQ = [
  {
    q: 'Нужен ли мощный компьютер?',
    a: 'Нет. Всё обрабатывается в облаке — достаточно любого устройства с браузером. Видео рендерится на наших серверах за 3–5 минут независимо от мощности вашего компьютера.',
  },
  {
    q: 'Работает на Windows, Mac и телефоне?',
    a: 'Да, YouTubeGen работает в любом современном браузере на любом устройстве — Windows, Mac, Android, iOS.',
  },
  {
    q: 'Это замена DaVinci Resolve или CapCut?',
    a: 'Нет, это дополнение. YouTubeGen автоматизирует создание контента — сценарий, озвучку, иллюстрации. Для простых видео результат готов сразу. Для сложного монтажа можно скачать исходники и доработать в любом редакторе.',
  },
  {
    q: 'Что такое кредиты?',
    a: 'Кредиты — это внутренняя валюта сервиса. Каждая операция (сценарий, озвучка, иллюстрация) стоит 1–2 кредита. Одно полное видео ~12–15 кредитов. При регистрации вы получаете 20 кредитов бесплатно.',
  },
  {
    q: 'Сколько стоит одно видео?',
    a: 'При тарифе Starter ($9/мес, 100 кредитов) одно видео обходится примерно в $1.35. Это в 10–20 раз дешевле фриланс-монтажа.',
  },
  {
    q: 'Какие языки поддерживаются?',
    a: '28 языков включая русский, английский, украинский, немецкий, испанский и другие. Можно создавать видео на любом из них.',
  },
  {
    q: 'Можно ли загрузить свой текст или аудио?',
    a: 'Да. На каждом шаге можно загрузить свой файл вместо генерации: свой сценарий (.txt), свою озвучку (.mp3), свои субтитры (.srt), свои иллюстрации (.jpg/.png).',
  },
  {
    q: 'Можно ли отменить подписку?',
    a: 'Да, в любой момент без штрафов. Доступ сохраняется до конца оплаченного периода. Неиспользованные кредиты не сгорают в течение месяца.',
  },
  {
    q: 'Есть ли реферальная программа?',
    a: 'Да! За каждого приглашённого друга вы получаете 20 кредитов, друг получает +5 кредитов при регистрации. Реферальная ссылка доступна в разделе Дашборд.',
  },
]

export default function FaqAccordion() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div className="divide-y divide-white/[0.06] rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
      {FAQ.map((item, i) => (
        <div key={i} style={{ background: 'rgba(255,255,255,0.02)' }}>
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-white/[0.03]"
          >
            <span className="font-medium text-slate-200">{item.q}</span>
            <span
              className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300"
              style={{
                background: open === i ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.06)',
                border: open === i ? '1px solid rgba(124,58,237,0.5)' : '1px solid rgba(255,255,255,0.1)',
              }}
            >
              <svg
                className={`w-3 h-3 text-slate-400 transition-transform duration-300 ${open === i ? 'rotate-45 text-violet-400' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
            </span>
          </button>
          {open === i && (
            <div className="px-6 pb-5 text-slate-400 text-sm leading-relaxed border-t border-white/[0.05] pt-4">
              {item.a}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
