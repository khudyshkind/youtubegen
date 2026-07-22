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

## Фаза 7 — Рост и монетизация

- [x] ✅ Step6Video.tsx — перенос «Вшить субтитры» из Step4, локальный `burnIn` стейт, SRT скачать
- [x] ✅ Кредитная система — новые CREDIT_COSTS ключи, PLAN_CREDITS значения, SQL миграция
- [x] ✅ Реферальная программа — SQL колонки, applyReferral(), /api/referral/apply, ReferralBlock
- [x] ✅ Админ-панель — 5 страниц + API routes, защита через proxy.ts, analytics_events
- [x] ✅ Диагностика + Paddle revenue — fetchPaddleRevenue(), UsersTable с subscription полями

---

## Фаза 9 — YouTube Analytics

- [x] ✅ CREDIT_COSTS — niche_analysis(10), trends(5), channel_analysis(15), revenue_calc(3)
- [x] ✅ i18n — analytics.* ключи ru + en (nav.analytics, 50+ ключей, tab_revenue, tab_history)
- [x] ✅ SidebarNav.tsx — пункт "YouTube Analytics" → /analytics
- [x] ✅ supabase/schema.sql — analytics_cache + analytics_reports таблицы (GRANT ALL TO service_role)
- [x] ✅ /api/analytics/niche/route.ts — YouTube API + два Haiku-запроса (10 кр.) + кэш-хит save
- [x] ✅ /api/analytics/trends/route.ts — два Haiku-запроса (5 кр.) + кэш-хит save
- [x] ✅ /api/analytics/channel/route.ts — два Haiku-запроса (15 кр.) + кэш-хит save
- [x] ✅ /api/analytics/reports/route.ts — GET + DELETE история (20 лимит)
- [x] ✅ /api/analytics/revenue/route.ts — RPM-калькулятор Haiku (3 кр.) + save
- [x] ✅ /dashboard/analytics/page.tsx — 5 вкладок: анализ ниши, тренды, канал, калькулятор дохода, история
- [x] ✅ .env.example + Vercel — YOUTUBE_API_KEY

---

## Фаза 8 — i18n + Уникализация + APIHOST TTS

- [x] ✅ i18n система (src/lib/i18n.ts + useLang hook) — все строки RU/EN, все 7 шагов студии переведены
- [x] ✅ Step7Seo.tsx — полный перевод через t(), CopyButton и ThumbnailSection sub-компоненты с useLang()
- [x] ✅ /api/generate/uniqueize/route.ts — эндпоинт уникализации (mode: unique/human/both, 1-2 кр.)
- [x] ✅ Step2Script.tsx — 3 кнопки (Уникализировать/Очеловечить/Оба), processingMode, handleProcess()
- [x] ✅ /tools страница — textarea ввода, 3 кнопки обработки, результат, "Использовать в студии"
- [x] ✅ SidebarNav.tsx — пункт "Инструменты" с puzzle-иконкой
- [x] ✅ APIHOST_API_KEY — добавлен в Vercel и Railway
- [x] ✅ .env.example — добавлен APIHOST_API_KEY
- [x] ✅ types.ts — ApihostVoiceType, APIHOST_CREDITS_PER_1000_CHARS, audioCost() для apihost
- [x] ✅ /api/voices/apihost/route.ts — 7 серверов параллельно, дедупликация, фильтр по языку
- [x] ✅ /api/generate/audio/route.ts — APIHOST async TTS (synthesize → poll → download → upload)
- [x] ✅ Step3Voice.tsx — APIHOST движок с ApihostVoiceDropdown, type badges, динамическая стоимость

---

---

## Фаза 10 — Wave 1 Acceptance + Tools expansion

- [x] ✅ `ScriptSettingsForm.tsx` — shared settings component (Step1Topic + script-gen tool parity)
- [x] ✅ `Step1Topic.tsx` — uses ScriptSettingsForm instead of inline settings
- [x] ✅ `/api/projects/from-tool/route.ts` — creates type='project' with pre-filled script+plan
- [x] ✅ `tools/script-gen/page.tsx` — two-phase plan, ScriptSettingsForm, save errors, real project on "Use in Studio"
- [x] ✅ `tools/seo`, `tools/repack`, `tools/uniqueize` — saveError visible, max-w-[1360px], "Use in Studio" via from-tool
- [x] ✅ `src/lib/anthropic-retry.ts` — isAnthropicOverload + withAnthropicRetry (16±4s)
- [x] ✅ script/plan/seo/repack routes — maxRetries:0, withAnthropicRetry, OVERLOADED response
- [x] ✅ Tools pages — «Повторить →» button on 529 error, plan sections preserved
- [ ] ⏳ **Owner:** Run Migration 005 SQL (adds `type` column to projects table) in Supabase Dashboard

---

## Фаза 11 — Инструмент Субтитры по аудио (SHA 442b63f)

- [x] ✅ `/api/upload/sign` — тип `tool_audio` (без project_id), валидация MIME/ext/size ≤25MB; NO `createSignedUrl` (arch fix)
- [x] ✅ `/api/tools/save-run` — тип `subtitles`, сохранение `subtitle_blocks`, удаление temp-аудио; NO spendCredits
- [x] ✅ `/tools/subtitles/page.tsx` — drag&drop, селектор языка, cost note, SRT/VTT/TXT download, `?run=` restore; `credits_spent` из роута
- [x] ✅ `tools/page.tsx` — карточка Субтитры (teal акцент, emoji 🎧)
- [x] ✅ `i18n.ts` — ключи `tools.card_subtitles*` + `tools.subtitles_*` (ru + en, 22 ключа)
- [x] ✅ `generate/subtitles` — `storage_path+storage_bucket` tool flow; `createSignedUrl` после загрузки; возвращает `duration_seconds + credits_spent`
- [x] ✅ Arch fix E2E verified: Railway 200, subtitle_blocks OK, debug endpoint deleted, studio unaffected
- [x] ✅ Vercel deploy — build success, SHA `442b63f`

---

---

## Фаза 12 — Инструмент «Иллюстрации по тексту»

- [x] ✅ `src/lib/scene-split.ts` — detectSceneCount (Haiku auto, word-count fallback)
- [x] ✅ `/api/tools/illustrations/scenes` — POST {text, count_mode, count?} → scene preview
- [x] ✅ `/api/tools/illustrations/init` — создаёт stub-проект (type='tool_run', image_style='image-illustrations')
- [x] ✅ `/api/tools/illustrations/finalize` — сбрасывает routing slug, ставит status='completed'
- [x] ✅ `custom_style` в `/api/generate/images` — synthetic StyleConfig, bypass STYLE_CONFIGS
- [x] ✅ `custom_style` в `/api/generate/image-single` — то же для перегенерации
- [x] ✅ `i18n.ts` — ключи `tools.ill_*` + `tools.card_illustrations*` (ru + en, ~35 ключей)
- [x] ✅ `IllustrationsTool.tsx` — клиентский компонент (SSE, regen, ZIP, 4 фазы, 11 стилей, 3 движка)
- [x] ✅ `tools/illustrations/page.tsx` — сервер-компонент, ?run= restore из projects
- [x] ✅ `tools/page.tsx` — карточка Иллюстрации (violet акцент, emoji 🖌️)
- [x] ✅ `DashboardClient.tsx` — TOOL_EMOJI добавлены 'subtitles' и 'image-illustrations'
- [x] ✅ `SubtitlesTool.tsx` — LANGUAGES (12) заменён на SCRIPT_LANGUAGES import (28 языков)
- [x] ✅ `npx tsc --noEmit` — 0 ошибок

---

---

## Фаза 13 — YooKassa: рутпричина + инциденты + биллинг

- [x] ✅ `src/app/api/webhooks/yookassa/route.ts` — исправлен `body.event` вместо `body.type` (SHA 4587d78)
- [x] ✅ IP whitelist — добавлен `77.75.154.128/25`, IPv4-mapped `::ffff:`, IPv6 prefix (SHA 01e17cb)
- [x] ✅ Verbose logging на каждом silent exit + TG alert на всех failure ветках
- [x] ✅ `supabase/migrations/008_payment_incidents.sql` — UNIQUE(payment_id), GRANT service_role (applied)
- [x] ✅ `recordIncident()` в webhook handler — all 4 failure branches instrumented
- [x] ✅ Приёмочный тест: amount_mismatch confirmed, idempotency (2 webhook = 1 row), already_activated на дублях
- [x] ✅ `src/app/(dashboard)/billing/page.tsx` — убрана disabled «Понижение», разрешён любой тариф, кнопка «Продлить»
- [x] ✅ `src/lib/i18n.ts` — ключ `billing.renew_btn` (RU: Продлить / EN: Renew)

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
| Синхронизация изображений с аудио | 1 / 1 |
| Фаза 7 — Рост и монетизация | 5 / 5 |
| Фаза 8 — i18n + Уникализация + APIHOST TTS | 12 / 12 |
| Фаза 9 — YouTube Analytics | 11 / 11 |
| Фаза 10 — Wave 1 Acceptance + Tools | 8 / 9 (pending Migration 005) |
| Фаза 11 — Субтитры по аудио | 6 / 6 |
| Фаза 12 — Иллюстрации по тексту | 13 / 13 |
| Фаза 13 — YooKassa + payment_incidents | 8 / 8 |
| **Итого** | **110 / 111** |
