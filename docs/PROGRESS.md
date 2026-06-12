# PROGRESS.md — Статус задач YouTubeGen

Обозначения: ✅ готово | ⏳ в очереди | 🔄 в процессе | ❌ заблокировано

---

## Фаза 1 — Фундамент

- [x] ✅ `src/lib/types.ts` — все TypeScript типы проекта (28 языков, ScriptModel, VoiceSettings, SubtitleStyle)
- [x] ✅ `src/lib/supabase.ts` — браузерный клиент Supabase
- [x] ✅ `src/lib/supabase-server.ts` — серверные клиенты
- [x] ✅ `src/lib/credits.ts` — requireCredits, spendCredits, addCredits (с session client для RLS)
- [x] ✅ `src/lib/env.ts` — утилита env() для зачистки BOM из переменных окружения
- [x] ✅ `supabase/schema.sql` — схема БД с GRANT для роли authenticated
- [x] ✅ `src/proxy.ts` — защита роутов (Next.js 16 middleware)
- [x] ✅ `src/lib/studio-store.ts` — Zustand store, 7 шагов, VoiceSettings, SubtitleStyle
- [x] ✅ `.env.example` — шаблон переменных

---

## Фаза 2 — API Routes

- [x] ✅ `src/app/api/generate/script/route.ts` — Claude Sonnet/Opus/GPT-4o, новый buildPrompt с 10+ параметрами
- [x] ✅ `src/app/api/generate/audio/route.ts` — ElevenLabs с style/useSpeakerBoost
- [x] ✅ `src/app/api/generate/subtitles/route.ts` — OpenAI Whisper
- [x] ✅ `src/app/api/generate/images/route.ts` — fal.ai Flux
- [x] ✅ `src/app/api/generate/seo/route.ts` — Claude SEO
- [x] ✅ `src/app/api/voice-preview/route.ts` — превью голоса без списания кредитов
- [x] ✅ `src/app/api/projects/route.ts` — GET/POST
- [x] ✅ `src/app/api/projects/[id]/route.ts` — GET/DELETE по ID
- [x] ✅ `src/app/api/paddle/checkout/route.ts` — оплата
- [x] ✅ `src/app/api/paddle/webhook/route.ts` — webhook кредиты
- [x] ✅ `src/app/api/generate/video/route.ts` — ZIP-архив (аудио + иллюстрации + SRT + timing + README)
- [x] ✅ `src/app/api/generate/video/render/route.ts` — Vercel proxy → Railway FFmpeg (maxDuration 300, 2 credits)

---

## Фаза 3 — Авторизация

- [x] ✅ `src/app/auth/login/page.tsx` — видимый текст в полях
- [x] ✅ `src/app/auth/register/page.tsx` — видимый текст в полях
- [x] ✅ `src/app/auth/callback/route.ts` — OAuth callback
- [x] ✅ `src/components/shared/Navbar.tsx` — навбар с кредитами

---

## Фаза 4 — Лендинг и дашборд

- [x] ✅ `src/app/page.tsx` — лендинг
- [x] ✅ `src/app/(dashboard)/layout.tsx` — layout с сайдбаром
- [x] ✅ `src/app/(dashboard)/dashboard/page.tsx` — дашборд с кнопками «Продолжить» и удалить черновик
- [x] ✅ `src/app/(dashboard)/billing/page.tsx` — тарифы + Paddle checkout
- [x] ✅ `src/components/shared/DeleteProjectButton.tsx` — кнопка удаления проекта

---

## Фаза 5 — Студия генерации (7 шагов)

- [x] ✅ `Step1Topic.tsx` — тема + 28 языков + AI-модель с кредитами + стиль/тон/аудитория + хук/CTA/маркеры
- [x] ✅ `Step2Script.tsx` — генерация + загрузить .txt + вставить текст + кнопка «Пропустить»
- [x] ✅ `Step3Voice.tsx` — генерация + загрузить .mp3/.wav (signed URL → Supabase) + «Пропустить»
- [x] ✅ `Step4Subtitles.tsx` — Whisper + загрузить .srt (client-side parse) + «Пропустить»
- [x] ✅ `Step5Images.tsx` — генерация + загрузить до 20 фото (signed URLs) + «Пропустить»
- [x] ✅ `Step6Video.tsx` — автосборка MP4 (Railway FFmpeg) + ZIP download + видеоплеер
- [x] ✅ `Step7Seo.tsx` — генерация SEO + финиш (навигация → 6)
- [x] ✅ `StepWizard.tsx` — 7 шагов, restore из DB, inferStep обновлён

---

## Фаза 6 — Деплой

- [x] ✅ `npx tsc --noEmit` — 0 ошибок
- [x] ✅ `next build` — 19/19 страниц, все ƒ routes присутствуют
- [x] ✅ Деплой на Vercel production: https://youtubegen.vercel.app
- [x] ✅ Финальное тестирование пайплайна — code audit, исправлены 2 бага, задеплоено

---

## Сводка

| Фаза | Прогресс |
|---|---|
| Фаза 1 — Фундамент | 9 / 9 |
| Фаза 2 — API Routes | 12 / 12 |
| Фаза 3 — Авторизация | 4 / 4 |
| Фаза 4 — Лендинг и дашборд | 5 / 5 |
| Фаза 5 — Студия (7 шагов) | 8 / 8 |
| Фаза 6 — Деплой | 4 / 4 |
| Railway FFmpeg видео-сервер | 4 / 4 |
| **Итого** | **46 / 46** ✅ |
