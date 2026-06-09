# PROGRESS.md — Статус задач YouTubeGen

Обозначения: ✅ готово | ⏳ в очереди | 🔄 в процессе | ❌ заблокировано

---

## Фаза 1 — Фундамент

- [x] ✅ `src/lib/types.ts` — все TypeScript типы проекта
- [x] ✅ `src/lib/supabase.ts` — браузерный клиент Supabase (createBrowserClient)
- [x] ✅ `src/lib/supabase-server.ts` — серверные клиенты (createServerSupabase, createServiceClient, getProfile)
- [x] ✅ `src/lib/credits.ts` — функция `requireCredits()`, `spendCredits()`, `addCredits()`
- [x] ✅ `supabase/schema.sql` — схема БД: profiles, projects, credit_transactions, RLS, Storage buckets
- [x] ✅ `src/proxy.ts` — защита роутов /dashboard /studio /settings /billing (Next.js 16, переименован из middleware.ts)
- [x] ✅ `src/lib/studio-store.ts` — Zustand store для пайплайна (замена useVideoStore)
- [x] ✅ `.env.example` — шаблон всех переменных окружения
- [x] ✅ `src/app/layout.tsx` — корневой layout с метаданными YouTubeGen и Navbar

---

## Фаза 2 — API Routes

- [x] ✅ `src/app/api/generate/script/route.ts` — генерация сценария (Claude + GPT-4o)
- [x] ✅ `src/app/api/generate/audio/route.ts` — озвучка (ElevenLabs) + загрузка в Storage
- [x] ✅ `src/app/api/generate/subtitles/route.ts` — субтитры (OpenAI Whisper)
- [x] ✅ `src/app/api/generate/images/route.ts` — иллюстрации (fal.ai Flux) + Storage
- [x] ✅ `src/app/api/generate/seo/route.ts` — SEO оптимизация (Claude)
- [x] ✅ `src/app/api/projects/route.ts` — GET список, POST создать проект
- [x] ✅ `src/app/api/stripe/checkout/route.ts` — создание сессии оплаты
- [x] ✅ `src/app/api/stripe/webhook/route.ts` — webhook: начисление кредитов, смена плана
- [ ] ⏳ `src/app/api/generate/video/route.ts` — сборка видео (FFmpeg)
- [ ] ⏳ `src/app/api/stripe/portal/route.ts` — портал управления подпиской

---

## Фаза 3 — Авторизация

- [x] ✅ `src/app/auth/login/page.tsx` — страница входа (email + пароль + Google OAuth)
- [x] ✅ `src/app/auth/register/page.tsx` — страница регистрации (имя + email + пароль + Google)
- [x] ✅ `src/app/auth/callback/route.ts` — OAuth callback (exchangeCodeForSession)
- [x] ✅ `src/components/shared/Navbar.tsx` — навбар: лого, кредиты, дропдаун, выход

---

## Фаза 4 — Лендинг и дашборд

- [x] ✅ `src/app/(marketing)/layout.tsx` — layout для будущих маркетинговых страниц
- [x] ✅ `src/app/page.tsx` — лендинг (Hero, Пайплайн, Features, Pricing, CTA, Footer)
- [x] ✅ `src/app/(dashboard)/layout.tsx` — layout с сайдбаром и мобильной навигацией
- [x] ✅ `src/app/(dashboard)/dashboard/page.tsx` — дашборд: статы, история проектов, пустой стейт
- [x] ✅ `src/app/(dashboard)/billing/page.tsx` — тарифы, баланс кредитов, Stripe checkout

---

## Фаза 5 — Студия генерации

- [x] ✅ `src/app/(dashboard)/studio/page.tsx` — страница студии
- [x] ✅ `src/components/studio/StepWizard.tsx` — прогресс-бар + роутинг шагов + кнопка сброса
- [x] ✅ `src/components/studio/Step1Topic.tsx` — тема, длительность, стиль, аудитория → создаёт проект
- [x] ✅ `src/components/studio/Step2Script.tsx` — генерация через Claude/GPT-4o + редактирование
- [x] ✅ `src/components/studio/Step3Voice.tsx` — выбор голоса, стабильность, аудио + субтитры
- [x] ✅ `src/components/studio/Step4Images.tsx` — редактируемые промпты + генерация + превью
- [x] ✅ `src/components/studio/Step5Video.tsx` — превью материалов, скачивание, «сборка видео (скоро)»
- [x] ✅ `src/components/studio/Step6Seo.tsx` — генерация + редактирование title/desc/tags + финиш

---

## Фаза 6 — Деплой

- [x] ✅ Сборка `npm run build` проходит без ошибок (18/18 страниц)
- [ ] ⏳ Настройка переменных окружения на Vercel
- [ ] ⏳ Настройка Stripe webhook endpoint
- [ ] ⏳ Применение schema.sql в Supabase
- [ ] ⏳ Финальное тестирование пайплайна
- [ ] ⏳ Публикация

---

## Сводка

| Фаза | Прогресс |
|---|---|
| Фаза 1 — Фундамент | 8 / 8 |
| Фаза 2 — API Routes | 8 / 10 |
| Фаза 3 — Авторизация | 4 / 4 |
| Фаза 4 — Лендинг и дашборд | 5 / 5 |
| Фаза 5 — Студия | 8 / 8 |
| Фаза 6 — Деплой | 1 / 6 |
| **Итого** | **35 / 42** |
