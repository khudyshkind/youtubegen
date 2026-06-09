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
