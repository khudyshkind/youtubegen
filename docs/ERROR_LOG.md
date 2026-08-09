# ERROR_LOG.md — Лог ошибок YouTubeGen

Перед тем как решать новую ошибку — проверь этот файл. Возможно, она уже встречалась.

---

## Шаблон записи

```
### [YYYY-MM-DD] Название ошибки
**Симптом:** что происходит / текст ошибки
**Причина:** почему возникает
**Решение:** как исправить
**Файлы:** какие файлы затронуты
```

---

<!-- Записи добавлять сверху, новые — выше старых -->

---

### [2026-08-09] Повторная «Ошибка генерации сценария» после деплоя динамического таймаута — ⏳ РАЗВЕДКА, ПРИЧИНА НЕ УСТАНОВЛЕНА
**Симптом:** Сразу после деплоя коммитов `5071e83` (динамический таймаут) и `d5837f5` (CHUNKED_THRESHOLD 30→24) владелец получил «Ошибка генерации сценария».
**Что известно по коду:** Строка «Ошибка генерации сценария» — последний fallback outer catch (status 500). Это NOT timeout, NOT overload (оба перехватываются выше и дают другой текст). Возможные источники: нетаймаутная API-ошибка Anthropic (400/500/сетевая) либо ошибка в `generateInternalPlan` (нет try-catch вокруг API-вызова) для chunked path ≥ 24 мин без pre-generated plan.
**Кредиты:** НЕ списаны при любом сценарии ошибки (spendCredits — после успеха).
**Что нужно установить:** (1) Был ли d5837f5 уже задеплоен в момент ошибки (Vercel → Deployments → timestamp); (2) Duration видео — какой путь (single/chunked) отработал; (3) Sentry — точный error class и stack trace.
**Файлы:** `src/app/api/generate/script/route.ts`

---

### [2026-08-09] Таймаут при генерации сценария — `Request timed out` (Sentry #139627127) ✅ ЗАКРЫТО

**Симптом:** 09.08.2026 01:01 UTC — «Ошибка генерации сценария» у пользователя. Алерт retention-style + Sentry: `Error: Request timed out` внутри SDK Anthropic (`rP.makeRequest`), `/generate/script`.

**Причина:** Хардкод `timeout: 120_000` при динамическом `max_tokens`. Формула `calcMaxTokens`: `max(2048, ceil(duration × 130 × 2.9 × 1.3))`. При 25-мин видео = 12 285 токенов; при ~100 tok/s Sonnet → ~123 с > 120 с → таймаут гарантирован. Анализ: граница систематического отказа — от 27 мин (`ceil(27 × 490.1) = 13 226 токенов → 132 с > 130 с кэп`). Retry-логика перехватывала только 529/503 overload — таймаут проходил мимо без повторной попытки.

**Дополнительная находка — chunked path:** `new Anthropic({ timeout: 240_000 })` без явного `maxRetries`. SDK default = 2 → на 529/503 SDK сам делает 3 попытки по 240 с = 720 с >> maxDuration=300 с. Vercel убил бы функцию без чистого ответа. Было упущением, не осознанным решением.

**Кредиты:** НЕ списаны — `spendCredits` вызывается только после успешного получения текста.

**Решение (2026-08-09, коммиты `5071e83` + следующий):**
1. `calcTimeout(maxTokens)` — динамический SDK-таймаут: `clamp(maxTokens × 12 мс, 30 с, 130 с)`. Кап 130 с → два attempt + 16 с = 276 с < maxDuration=300 с.
2. `isAnthropicTimeout()` в `anthropic-retry.ts` — детектор тайм-аутов (408, "timeout", "TimeoutError", "ETIMEDOUT"), отдельно от overload.
3. Retry при таймауте: блок catch перехватывает оба типа, `didRetry` пропускает expand-пасс (бюджет).
4. Chunked path: `maxRetries: 0` (устраняет скрытые SDK-ретраи на 240 с), `calcTimeout(sectionMaxTokens)` вместо хардкода 240 с.
5. `CHUNKED_THRESHOLD` снижен с 30 до 24 мин: при 24 мин → 11 795 токенов → 118 с @ 100 tok/s → запас 12 с; диапазон 24–29 мин уходит в chunked path, где секции ~1 050 токенов → ~10 с << 30 с timeout.
6. Сообщение: `code: 'TIMEOUT'`, HTTP 504, текст называет причину и подтверждает, что кредиты не списаны.

**Файлы:** `src/app/api/generate/script/route.ts`, `src/lib/anthropic-retry.ts`

**Частота:** первый зафиксированный; системно воспроизводим при видео ≥27 мин без снижения порога.

---

### [2026-07-22] YooKassa webhook: рутпричина + платёжные инциденты (SHA 9901805)
**Симптом:** Все вебхуки ЮKassa ack-ались без активации тарифа; платежи клиентов не активировались.
**Причина:** Код проверял `body.type` (всегда `"notification"`) вместо `body.event` (`"payment.succeeded"`) — каждый вебхук тихо ack-ался без активации. Дополнительно отсутствовал диапазон `77.75.154.128/25` в IP whitelist.
**Решение:**
- Исправлена проверка: `body.event === 'payment.succeeded'` (SHA 4587d78)
- IP whitelist: добавлен `77.75.154.128/25`, поддержка `::ffff:x.x.x.x` и IPv6-prefix `2a02:5180:` (SHA 01e17cb)
- Разрешена покупка любого тарифа, кнопка «Продлить» на карточке текущего тарифа (SHA 9989791)
- Таблица `payment_incidents`: UNIQUE(payment_id), upsert+ignoreDuplicates; все ветки вебхука (`bad_metadata`, `unknown_plan`, `amount_mismatch`, `activation_failed`) пишут инцидент + TG alert (SHA 6a38589)
**Файлы:** `src/app/api/webhooks/yookassa/route.ts`, `supabase/migrations/008_payment_incidents.sql`, `src/app/(dashboard)/billing/page.tsx`

---

### [2026-07-22] «Ошибка генерации субтитров» в инструменте Субтитры по аудио
**Симптом:** Загрузка MP3 в инструменте → «Ошибка генерации субтитров» сразу после PUT.
**Причина:** `upload/sign` вызывал `createSignedUrl` для чтения ДО PUT-загрузки файла. Supabase Storage возвращает "Object not found" если объект не существует → `access_url` = '' → Railway `/transcribe` получает пустой `audio_url` → 400 "audio_url required" → Next.js generate/subtitles возвращает 502 → страница показывает ошибку.
**Решение (архитектурный):**
- `upload/sign` type=`tool_audio`: убрать `createSignedUrl`. Возвращать только `{ signed_url, token, path, bucket, content_type }`.
- `generate/subtitles`: принимать `storage_path + storage_bucket` (tool flow). После приёма запроса (файл уже в Storage) вызывать `createSignedUrl(storage_path, 900)`.
- Tool page: после PUT отправлять `{ storage_path, storage_bucket }` вместо `audio_url`.
**Дополнительно:** route теперь возвращает `{ ..., duration_seconds, credits_spent: cost }`. Tool page записывает `credits_spent` из ответа, не пересчитывает и не списывает повторно.
**Файлы:** `src/app/api/upload/sign/route.ts`, `src/app/api/generate/subtitles/route.ts`, `src/app/(dashboard)/tools/subtitles/page.tsx`

---

### [2026-07-20] Антропик 529 на /generate/script (инструментный путь)
**Симптом:** Plan генерируется стабильно, script в tools падает с 529 повторяемо
**Причина:** Script запрашивает 2458 output tokens vs план ~1100 (2.2×). Под overload Anthropic первыми отклоняет тяжёлые запросы. SDK default retries (maxRetries=2, задержки 0.5s+1s) слишком быстрые — ретрай через 1 секунду ловит тот же overload.
**Решение:**
- `src/lib/anthropic-retry.ts` — `isAnthropicOverload()` (Anthropic.APIError status 529/503) + `withAnthropicRetry()` (16±4s jitter, один retry)
- script/plan/seo/repack routes — `maxRetries: 0` в Anthropic client, app-level retry через withAnthropicRetry
- Catch: OVERLOADED code → `{ ok: false, code: 'OVERLOADED', error: 'Нейросеть перегружена...' }` status 503
- Tools pages — проверять `json.code === 'OVERLOADED'` → показывать tools.err_overload + кнопка «Повторить →»
**Важно:** `Anthropic.APIStatusError` НЕ существует в используемой версии SDK — правильно `Anthropic.APIError` (имеет поле `.status`)
**Файлы:** `src/lib/anthropic-retry.ts` (новый), `src/app/api/generate/script/route.ts`, `src/app/api/generate/plan/route.ts`, `src/app/api/generate/seo/route.ts`, `src/app/api/generate/repack/route.ts`, `src/lib/i18n.ts`, tools pages

---

### [2026-06-16] История отчётов пустая — permission denied на analytics_reports
**Симптом:** Вкладка "История" пустая, в логах Vercel: `[reports] fetch error: permission denied for table analytics_reports`
**Причина:** Новые таблицы, созданные вручную в Supabase SQL Editor, не наследуют default privileges автоматически. `service_role` не получил GRANT на таблицу, хотя service_role должен обходить RLS.
**Решение:** `GRANT ALL ON public.analytics_reports TO service_role;` в Supabase SQL Editor. Также добавлено в `supabase/schema.sql` перед RLS политиками.
**Дополнительно:** Сохранение отчёта было только в пути "свежий анализ", но при кэш-хите делался `return` до кода сохранения — добавлено сохранение и в путь кэш-хита.
**Файлы:** `supabase/schema.sql`, `src/app/api/analytics/reports/route.ts`, niche/trends/channel route.ts

---

### [2026-06-16] "Невалидный JSON от Claude" в analytics routes
**Симптом:** `/api/analytics/trends` и `/api/analytics/channel` возвращают ошибку "Невалидный JSON от Claude"
**Причина:** Claude Sonnet при больших промтах с вложенными массивами добавляет вводный текст или markdown-блоки перед JSON. Даже balanced-brace extractor не помогает если модель генерирует невалидный JSON внутри.
**Решение:** Разбить один большой промт на два маленьких запроса к Haiku (max_tokens: 500-600). Flat JSON без вложенных объектов → модель точно следует формату. Результаты двух запросов мёржатся в итоговую структуру.
**Файлы:** `src/app/api/analytics/niche/route.ts`, `src/app/api/analytics/trends/route.ts`, `src/app/api/analytics/channel/route.ts`
**Паттерн:** `parseClaudeJson<T>(text, label)` с balanced-brace извлечением; две отдельных `anthropic.messages.create` с Haiku

---

### [2026-06-13] Railway не подхватывает изменения из GitHub автоматически
**Симптом:** Пушишь код в GitHub, Railway не обновляется — работает старый код
**Причина:** Railway сервис был задеплоен через `railway up` (CLI), а не через GitHub Integration. При CLI-деплое Railway не слушает GitHub webhooks
**Решение:** После каждого изменения в `video-server/` запускать `cd video-server && railway up --detach --service ytgen-video-server` вручную. Альтернатива — подключить GitHub Integration в Railway Settings
**Файлы:** `video-server/index.js` (и любые изменения в video-server/)

---

### [2026-06-13] Субтитры статичны — меняются только при смене изображения
**Симптом:** Вшитые субтитры не меняются по тайм-кодам SRT, а обновляются только когда меняется иллюстрация
**Причина:** FFmpeg получал фильтр `subtitles=` внутри concat-pipeline, где каждый кадр — это изображение с фиксированной длительностью. Субтитры "прилипали" к кадру, а не шли по реальному времени
**Решение:** Двухпроходная сборка. Pass 1: собрать `temp_no_subs.mp4` из изображений + аудио без субтитров. Pass 2: `ffmpeg -i temp_no_subs.mp4 -vf subtitles=subs.srt -c:a copy output.mp4` — субтитры накладываются на готовое видео по SRT тайм-кодам
**Файлы:** `video-server/index.js`

---

### [2026-06-12] Изображения не синхронизированы с аудио
**Симптом:** Сцена про жирафов показывается когда говорят про хищников — иллюстрации не совпадают по времени с аудио
**Причина:** Claude рассчитывал тайм-коды из текста сценария (оценочно), но реальный темп речи в аудио отличается
**Решение:** Передавать `subtitle_blocks` (Whisper, точные тайм-коды) в `/api/generate/images`. При наличии субтитров: разбить блоки на N групп математически → тайм-коды берутся из `block.start/end`, Claude пишет только визуальные промпты на основе текста каждой группы. Без субтитров — старый fallback (Claude угадывает из скрипта, Railway использует `image_interval`).
**Файлы:** `src/app/api/generate/images/route.ts`, `src/components/studio/Step5Images.tsx`

---

### [2026-06-12] Отсутствует /api/generate/image-single
**Симптом:** Перегенерация одной иллюстрации в Step5 → 404 Not Found
**Причина:** Step5Images.tsx вызывает `/api/generate/image-single`, но файл route.ts не был создан
**Решение:** Создан `src/app/api/generate/image-single/route.ts` — принимает project_id/scene_index/prompt, генерирует через Flux, сохраняет метаданные оригинальной сцены (scene, timecode)
**Файлы:** `src/app/api/generate/image-single/route.ts` (новый)

---

### [2026-06-12] Whisper язык захардкожен как 'ru'
**Симптом:** Субтитры генерировались через Whisper с `language: 'ru'` для любого языка видео
**Причина:** API route hardcode; Step4Subtitles не передавал язык
**Решение:** Step4 передаёт `language: scriptParams.language`; API принимает с fallback `'ru'`
**Файлы:** `src/components/studio/Step4Subtitles.tsx`, `src/app/api/generate/subtitles/route.ts`

---

### [2026-06-09] useSearchParams без Suspense boundary
**Симптом:** `useSearchParams() should be wrapped in a suspense boundary at page "/auth/login"` — build error при статической генерации
**Причина:** Next.js требует Suspense wrapper вокруг компонентов с `useSearchParams()` при prerendering
**Решение:** Извлечь логику с `useSearchParams()` в отдельный компонент `LoginForm`, обернуть его в `<Suspense>` внутри экспортируемой страницы
**Файлы:** `src/app/auth/login/page.tsx`

---

### [2026-06-09] Supabase createBrowserClient выбрасывает исключение при сборке
**Симптом:** `@supabase/ssr: Your project's URL and API key are required` при `npm run build` на `/_not-found`
**Причина:** `createBrowserClient` / `createServerClient` вызываются на уровне модуля или в теле компонента; при prerendering без `.env.local` env vars = `undefined`, что вызывает синхронный throw
**Решение:** Использовать `?? 'https://placeholder.supabase.co'` и `?? 'placeholder-anon-key'` как fallback в `createClient()` и `createServerSupabase()`. В продакшне (Vercel) реальные значения переопределяют fallback
**Файлы:** `src/lib/supabase.ts`, `src/lib/supabase-server.ts`

---

### [2026-06-09] Stripe / ElevenLabs / Anthropic / OpenAI / fal.ai инициализация на уровне модуля
**Симптом:** `Neither apiKey nor config.authenticator provided` (Stripe), `Please pass in your ElevenLabs API Key` — сбой при `Collecting page data` во время build
**Причина:** SDK-клиенты (`new Stripe(...)`, `new ElevenLabsClient(...)`, `new Anthropic(...)`, `new OpenAI(...)`) объявлены на уровне модуля; при статическом анализе env vars = undefined → клиенты бросают исключение в конструкторе
**Решение:** Перенести инициализацию клиентов внутрь функции-обработчика (или хелпер-функций), чтобы они создавались только при реальном вызове эндпоинта, когда env vars уже установлены
**Файлы:** `src/app/api/generate/audio/route.ts`, `src/app/api/generate/script/route.ts`, `src/app/api/generate/images/route.ts`, `src/app/api/generate/seo/route.ts`, `src/app/api/stripe/checkout/route.ts`, `src/app/api/stripe/webhook/route.ts`

---

### [2026-06-09] Next.js 16 proxy.ts — неверное имя экспорта
**Симптом:** `Proxy is missing expected function export name` — build error
**Причина:** В Next.js 16 файл `proxy.ts` должен экспортировать функцию с именем `proxy` (или default), а не `middleware`
**Решение:** Переименовать `export async function middleware` → `export async function proxy` в `src/proxy.ts`
**Файлы:** `src/proxy.ts`

---

### [2026-06-09] Конфликт middleware.ts и proxy.ts в Next.js 16
**Симптом:** `Both middleware file "./src/middleware.ts" and proxy file "./src/proxy.ts" are detected` — build error
**Причина:** Next.js 16 переименовал `middleware.ts` → `proxy.ts`, но старый файл остался
**Решение:** Удалить `src/middleware.ts`, оставить только `src/proxy.ts`
**Файлы:** удалён `src/middleware.ts`, сохранён `src/proxy.ts`

---

### [2026-06-09] credits.ts импортирует createServiceClient из supabase.ts (не server)
**Симптом:** `Module '"./supabase"' has no exported member 'createServiceClient'` — TypeScript error
**Причина:** После разделения `supabase.ts` на browser/server части `createServiceClient` переехал в `supabase-server.ts`, но `credits.ts` остался импортировать из старого файла
**Решение:** Изменить импорт в `credits.ts` на `from './supabase-server'`
**Файлы:** `src/lib/credits.ts`
