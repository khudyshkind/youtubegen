# MEMORY.md — Память проекта YouTubeGen

## О проекте

**YouTubeGen** — SaaS-платформа для автоматической генерации YouTube-видео для русскоязычных блогеров.

**Пайплайн генерации:**
1. Сценарий → Claude API (`@anthropic-ai/sdk`)
2. Озвучка → ElevenLabs (`@elevenlabs/elevenlabs-js`)
3. Субтитры → OpenAI Whisper (`openai`)
4. Иллюстрации → Flux via fal.ai (`@fal-ai/client`)
5. Сборка видео → FFmpeg
6. SEO-оптимизация → Claude API

**Стек технологий:**
- Frontend: Next.js 16, TypeScript, Tailwind CSS, Zustand
- Backend: Next.js API Routes, Supabase (PostgreSQL + Auth + Storage)
- Платежи: Stripe
- AI: Anthropic Claude, OpenAI Whisper, ElevenLabs, fal.ai (Flux)
- Деплой: Vercel

**Структура проекта:**
```
src/app/          — страницы и API routes
src/components/   — React компоненты
src/lib/          — утилиты, типы, клиенты
supabase/         — схема базы данных
docs/             — документация
tmp/              — временные файлы (в .gitignore)
```

---

## Кредитная система

Каждая операция списывает кредиты с баланса пользователя. Проверка — через `requireCredits()` перед каждым платным вызовом.

| Операция | Стоимость | API |
|---|---|---|
| Генерация сценария | 10 кредитов | Claude API |
| Озвучка (на минуту) | 5 кредитов | ElevenLabs |
| Транскрибация/субтитры | 3 кредита | OpenAI Whisper |
| Генерация иллюстрации | 8 кредитов | fal.ai (Flux) |
| SEO-оптимизация | 5 кредитов | Claude API |

При нехватке кредитов API возвращает `{ ok: false, code: 'NO_CREDITS' }` со статусом 402.

---

## Тарифные планы

| План | Цена | Кредиты | Stripe Price ID |
|---|---|---|---|
| Free | $0 | 5 | — |
| Starter | $9/мес | 50 | `price_starter` |
| Pro | $19/мес | 200 | `price_pro` |
| Agency | $49/мес | 1000 | `price_agency` |

---

## Переменные окружения

Все ключи только через `process.env`. Никогда не хардкодить. При добавлении новой переменной — сразу добавить в `.env.example`.

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Anthropic
ANTHROPIC_API_KEY=

# OpenAI (Whisper)
OPENAI_API_KEY=

# ElevenLabs
ELEVENLABS_API_KEY=

# fal.ai
FAL_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# App
NEXT_PUBLIC_APP_URL=
```

---

## Лог сессий

<!-- Новые записи добавлять сверху в формате: -->
<!-- ### YYYY-MM-DD — Краткое описание -->
<!-- Что сделано, какие файлы созданы/изменены -->

