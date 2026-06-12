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

