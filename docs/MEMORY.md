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

## Загрузка своих файлов (upload)

На каждом шаге добавлены кнопки «Загрузить» и «Пропустить».

**Схема загрузки:**
1. Client → `POST /api/upload/sign` → получает `{ signed_url, access_url }`
2. Client → `PUT signed_url` с телом файла (напрямую в Supabase Storage, минуя Vercel 4.5MB limit)
3. `access_url` сохраняется в store (для аудио — signed read URL на 1 час; для изображений — public URL)

**Audio bucket** (private): возвращает signed read URL через `createSignedUrl(path, 3600)`
**Images bucket** (public): возвращает public URL через `getPublicUrl(path)`

**Шаги:**
- Step2: FileReader.readAsText(.txt) → setScript()
- Step3: signed upload → setAudioUrl(access_url)  — кредиты не списываются
- Step4: FileReader.readAsText(.srt) → parseSrt() → setSubtitleBlocks()
- Step5: до 20 файлов, каждый через свой signed URL, scene_index = i+1

## Лог сессий

<!-- Новые записи добавлять сверху в формате: -->
<!-- ### YYYY-MM-DD — Краткое описание -->
<!-- Что сделано, какие файлы созданы/изменены -->

### 2026-07-20 — Wave 1 acceptance + 529 overload fix

**Wave 1 acceptance (SHA 9b8a3b1):**
- `src/components/shared/ScriptSettingsForm.tsx` — extracted shared settings form (language, duration, model, style, tone, audience, hook, CTA, scene_markers, pauses); используется в Step1Topic и script-gen tool
- `src/components/studio/Step1Topic.tsx` — заменён inline на `<ScriptSettingsForm>` + `<LanguageSelect>`
- `src/app/api/projects/from-tool/route.ts` — новый API: создаёт type='project' в projects table (script+plan_sections pre-filled); нужна Migration 005 (column type)
- `src/app/(dashboard)/tools/script-gen/page.tsx` — полный ScriptSettingsForm, two-phase plan (400 кр. → редакт. разделы → script), save errors visible, "Use in Studio" создаёт реальный проект
- seo/repack/uniqueize pages — saveError visible, max-w-[1360px]
- `src/lib/i18n.ts` — ключи script_gen_plan_btn, script_gen_from_plan_btn, script_plan_label, script_plan_edit_hint, save_fail, use_studio_creating, err_overload, retry

**529 overload fix (SHA 32fb7c8):**
- `src/lib/anthropic-retry.ts` — `isAnthropicOverload()` (Anthropic.APIError status 529/503) + `withAnthropicRetry()` (16±4s delay, one retry)
- script/plan/seo/repack routes — `maxRetries:0` в SDK, retry через withAnthropicRetry, OVERLOADED response code
- script-gen/seo/repack pages — «Повторить →» кнопка в error block, plan sections НЕ сбрасываются при ошибке
- Spend order CONFIRMED CORRECT везде (AFTER successful generation)
- Root cause 529: script=2458 output tokens vs plan=~1100 (2.2×); SDK default retries слишком быстрые (0.5s+1s)

**Pending owner action:** Migration 005 SQL — добавляет column `type` в projects table. Без неё from-tool inserts падают.
Деплой: SHA 32fb7c8 → https://youtubegen.vercel.app

### 2026-06-16 — История отчётов аналитики (вкладка История)
Реализовано сохранение и просмотр отчётов аналитики:
- `supabase/schema.sql` — таблица `analytics_reports` (user_id, type, title, query, result, created_at)
- `src/app/api/analytics/reports/route.ts` — GET список + DELETE (service client)
- niche/trends/channel route.ts — сохранение в history при кэш-хите И при свежем анализе
- `src/app/(dashboard)/analytics/page.tsx` — 4-я вкладка "📋 История", открыть отчёт / удалить / Скачать PDF
- Фикс: `GRANT ALL ON analytics_reports TO service_role` — без этого service client получал `permission denied` (новые таблицы не наследуют default privileges)
Деплой: dpl_i4ls647y1 → https://youtubegen.vercel.app

### 2026-06-16 — YouTube Analytics: фикс JSON-парсинга Claude (два Haiku-запроса)
Все три analytics routes переведены на паттерн двух маленьких запросов к Haiku:
- `src/app/api/analytics/niche/route.ts` — запрос 1: метрики (flat), запрос 2: рекомендации (flat)
- `src/app/api/analytics/trends/route.ts` — запрос 1: список трендов, запрос 2: идеи для видео
- `src/app/api/analytics/channel/route.ts` — запрос 1: обзор+темы, запрос 2: форматы+рекомендации
- Добавлен `parseClaudeJson<T>()` с balanced-brace extraction во всех трёх routes
- Добавлено детальное логирование: yt status, videos count, шаги Claude
Деплой: dpl_M7cZot7gWHtULNKqn1tRhBsQRgw1 — https://youtubegen.vercel.app

### 2026-06-16 — YouTube Analytics раздел (начальная реализация)
Добавлен новый раздел /analytics с тремя вкладками:
- `src/lib/types.ts` — CREDIT_COSTS: niche_analysis(10), trends(5), channel_analysis(15)
- `src/lib/i18n.ts` — analytics.* ключи (ru + en)
- `src/components/shared/SidebarNav.tsx` — пункт "YouTube Analytics" → /analytics
- `supabase/schema.sql` — таблица analytics_cache (24ч кэш по type+key)
- `src/app/(dashboard)/analytics/page.tsx` — 3 вкладки, прогресс-шаги, результаты с таблицами/карточками
- `.env.example` — добавлен YOUTUBE_API_KEY
- Vercel — YOUTUBE_API_KEY установлен

### 2026-06-15 — APIHOST: статические превью, кредитное отображение, исправление загрузки голосов
- `src/app/api/voices/apihost/route.ts` — исправлен парсинг (API возвращает `{speaker:[]}` а не `{data:[]}`), добавлен `preview_url` для статических MP3-семплов
- `src/components/studio/Step3Voice.tsx` — превью голосов APIHOST через статические URL (`new Audio(url).play()`), скрытие кнопки при 404, перемещение логики в родительский компонент
- Удалён `/api/voices/apihost/preview/route.ts` (синтез превью через API больше не нужен)
- Убраны рублёвые цены из карточки APIHOST, добавлены кредитные бейджи и динамический расчёт стоимости
Деплой: dpl_9E6ycrUeoomUNNZPoXNzZJtXNUs3 — https://youtubegen.vercel.app

### 2026-06-15 — Уникализация текста + APIHOST TTS движок
Добавлена функция уникализации текста и новый TTS движок APIHOST.RU:
- `src/lib/i18n.ts` — расширена RU/EN i18n: ключи step7.*, thumb.*, tools.*, apihost.*, step2.uniqueize/both_process
- `src/components/studio/Step7Seo.tsx` — полный перевод через t(), CopyButton/ThumbnailSection с useLang()
- `src/app/api/generate/uniqueize/route.ts` — новый эндпоинт (mode: unique/human/both, 1-2 кр., Claude API)
- `src/components/studio/Step2Script.tsx` — 3 кнопки (Уникализировать/Очеловечить/Оба), processingMode state
- `src/app/(dashboard)/tools/page.tsx` — новая страница инструментов с textarea + кнопками + "Использовать в студии"
- `src/components/shared/SidebarNav.tsx` — пункт "Инструменты" (nav.tools)
- `src/lib/types.ts` — AudioEngine+'apihost', ApihostVoiceType, APIHOST_CREDITS_PER_1000_CHARS, audioCost() обновлена
- `src/app/api/voices/apihost/route.ts` — новый route: 7 серверов параллельно, дедупликация, кэш 1ч
- `src/app/api/generate/audio/route.ts` — APIHOST async ветка: synthesize → poll (54×5s) → download → upload
- `src/components/studio/Step3Voice.tsx` — APIHOST движок: ApihostVoiceDropdown, type badges, динамическая стоимость
- `.env.example` — добавлен APIHOST_API_KEY
- Vercel + Railway — APIHOST_API_KEY установлен
Деплой: dpl_9RuoppPV2NYjNTeJSn7h1KPooHya — https://youtubegen.vercel.app

### 2026-06-12 — Railway FFmpeg видео-сервер (автосборка MP4)
Добавлена автосборка MP4 через FFmpeg на Railway:
- `video-server/index.js` — Express сервер POST /render: скачивает аудио+картинки, строит concat.txt, запускает FFmpeg H.264 1280×720, загружает в Supabase `videos` bucket, возвращает public URL
- `Dockerfile` — node:20-slim + apt ffmpeg, копирует video-server/
- `src/app/api/generate/video/render/route.ts` — Vercel proxy (maxDuration=300, 2 credits), пробрасывает запрос на Railway с x-api-secret
- `Step6Video.tsx` — секция "Собрать MP4" с кнопкой, spinner, видеоплеером, кнопкой скачать
- `supabase/schema.sql` — videos bucket изменён на public=true (для public URL без подписи)
- `CREDIT_COSTS` дополнен `video: 2`
- Новые env vars: `RAILWAY_VIDEO_SERVER_URL`, `RAILWAY_API_SECRET`
Деплой: dpl_5u7RHvBURreyVpzw4L2GAi5yXpgX — https://youtubegen.vercel.app

### 2026-06-12 — Финальный аудит и исправление багов (v1.0)
Проведён полный code-level аудит всех 7 шагов и 11 API-маршрутов.
Найдено и исправлено:
1. **Критический баг**: `/api/generate/image-single/route.ts` не существовал — перегенерация отдельной сцены в Step5 давала 404. Создан новый маршрут с сохранением метаданных сцены (scene/timecode) и добавлением NO TEXT, NO WATERMARKS к промпту Flux.
2. **Баг языка субтитров**: Whisper получал `language: 'ru'` жёстко — теперь Step4Subtitles передаёт `scriptParams.language`, API принимает параметр language с fallback 'ru'.
Деплой: dpl_7SdCo8R6bKbUhyQNsNRRVwmgJEr4 — https://youtubegen.vercel.app

### 2026-06-12 — Загрузка своих файлов + кнопки Пропустить
Добавлено на всех 4 шагах: Step2 (.txt upload + textarea paste), Step3 (аудио upload signed URL), Step4 (SRT upload + client-side parse), Step5 (мульти-фото до 20 штук, signed URLs, прогресс-бар). Обновлён /api/upload/sign/route.ts — теперь возвращает access_url (signed read для audio, public URL для images). Деплой: https://youtubegen.vercel.app

