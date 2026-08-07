# Отчёт: 2026-08-07 (инструкция: два пути в шаге 6)

## Что сделано

**`src/components/settings/SettingsClient.tsx`** — пункт 6 инструкции YouTube API-ключа расширен: теперь описывает оба пути, которые может показать Google Cloud Console:
- Если открылось **выпадающее меню** → «Ключ API»
- Если открылся **мастер** «Which API are you using?» → выбрать YouTube Data API v3 → Public data → Next. Явно объяснено, почему не User data (создаёт OAuth-клиент, а не API-ключ).

Пункт 7 (скопировать ключ) и пункт 8 (не устанавливать ограничения) сдвинулись на один вниз. ru + en, остальные пункты не тронуты. tsc чисто.

**Коммит:** `9d3713d`

---

# Отчёт: 2026-08-07 (три UX-исправления поиска подниш)

## Что сделано

### 1. Больше направлений: 5–7 → 10–14

**`src/app/api/analytics/niche-directions/route.ts`:**
- Промпт переписан: явно запрещает слияние «Музыка для ночных клубов» и «Музыка для тренировок» в один сегмент; даёт конкретные примеры дробных сегментов для «музыки» и «личных финансов»
- `max_tokens` 1500 → 2500
- `directions.slice(0, 7)` → `slice(0, 14)`
- Cache key v1 → v2 (сброс старых кэшей)

Live-прогон локально невозможен (ANTHROPIC_API_KEY не доступен без Vercel). Тест — на первом реальном запросе после деплоя.

### 2. Проверка ключа на шаге 1 (не на шаге 2)

**`src/app/(dashboard)/analytics/page.tsx`:**
- `import { createClient } from '@/lib/supabase'`
- `SubNicheTab`: при монтировании — `useEffect` → `createClient().from('profiles').select('encrypted_yt_key').single()` → `setHasKey(bool)`
- Если `hasKey === false`: amber-блок «Нужен YouTube API-ключ» с объяснением (2600 единиц квоты), кнопкой «Добавить ключ в Настройках» и ссылкой «Как получить ключ»; кнопка «Получить направления» `disabled`
- `__byok__` в confirm-view: больше не `<ByokBlock />` (говорил «бесплатный тариф» — неверно для PRO); вместо него — текст `sn_no_key_*` + кнопка в настройки

### 3. Пошаговая инструкция получения ключа

**`src/components/settings/SettingsClient.tsx`:**
- Новое состояние `showYtGuide: boolean` + кнопка «Как получить YouTube API-ключ» (разворачивает)
- 7 шагов: console.cloud.google.com → новый проект → Библиотека → YouTube Data API v3 → Включить → Учётные данные → Ключ API → скопировать
- ⚠️ Важно: не устанавливать IP/HTTP ограничения
- Квота: 10 000 ед./день, ~4 прогона поиска подниш
- Блок якорен: `id="yt-key-guide"` на карточке раздела → ссылки из инструмента ведут сюда
- ru + en, переключается по lang из store
- `settings.yt_api_key_desc` — убрано «только на бесплатном тарифе»

**`src/lib/i18n.ts`:**
- Новые ключи: `analytics.sn_no_key_title`, `sn_no_key_body`, `sn_no_key_btn`, `sn_no_key_how` (ru + en)

## Коммит

`4054ff6` — feat(sub-niche): more directions (10-14), key gate on step 1, API key guide

## Что проверить владельцу после деплоя

1. Нажать «Поиск подниш» → вбить «музыка» → «Получить направления»: должно быть 10–14 карточек, а не 7
2. Личные финансы → аналогично
3. Залогиниться под аккаунтом БЕЗ ключа на PRO → открыть вкладку → должен появиться amber-блок на шаге 1 сразу
4. С ключом → никаких amber-блоков; старый «Аналитика на бесплатном тарифе...» не показывается
5. Настройки → секция YouTube API Key → кнопка «Как получить ключ» → разворачивает 7 шагов

---

# Отчёт: 2026-08-07 (UI-вкладка «Поиск подниш»)

## Что сделано

Добавлена вкладка `sub_niche` в `/analytics` — двухуровневый поиск подниш.

### Изменения в коде

**`src/lib/content-config.ts`:**
- Добавлен `{ id: 'sub_niche', icon: '🔍', ... }` в группу `group_competitors` после `niche`

**`src/lib/i18n.ts`:**
- 40 новых ключей `analytics.sn_*` в ru и en секциях (метки, подсказки, тексты)

**`src/app/(dashboard)/analytics/page.tsx`:**
- Типы: `NicheDirection`, `DirectionsData`, `SubNicheItem`, `SubNicheFinderData`, `SNMetric<T>`
- Хелперы: `GrowthBadge`, `PenetBadge`, `EstBadge`, `TipIcon`
- `SubNicheResultsView` — рендер результатов
- `SubNicheTab` — двухуровневый flow с 4 фазами: input → loading_dirs → dirs → confirm → loading_niches → results
- `Tab` union расширен: `'sub_niche'`
- `TAB_COST.sub_niche = CREDIT_COSTS.sub_niche_finder`
- Рендер: `{tab === 'sub_niche' && <SubNicheTab />}`

### UI-flow

1. **Шаг 1** — поле «Широкая ниша» + страна + язык + кнопка «Найти направления»; зелёная плашка «Бесплатно — квоту YouTube не расходует»; POST `/api/analytics/niche-directions`
2. **Направления** — 5–7 карточек с именем, описанием, примерами подниш; клик → шаг подтверждения
3. **Подтверждение квоты** — предупреждение «~2 300 из 10 000 дневного лимита YouTube API», стоимость −5000 кр., кнопки «Запустить» / «Отмена»
4. **Результаты** — POST `/api/analytics/sub-niche-finder`:
   - Топ-5 крупными карточками (из `verdict.ranking`)
   - Полная таблица надёжных подниш с метриками
   - Свёрнутый блок ненадёжных (с числами выборки)
   - Вердикт ИИ (помечен как «оценка»)

### Разделение api / estimate

- Ячейки `source:'api'` — обычный цвет (slate/white)
- RPM (`source:'estimate'`) — amber/yellow + italic; «*RPM — ориентировочно»
- Вердикт — отдельный блок с тегом «оценка» + пояснением «мнение модели, не расчёт»

## Что не проверено без живого прогона

1. Визуальное отображение топ-5 карточек с реальными данными
2. Таблица при большом числе ниш (18+) — переносы строк в колонке `Подниша`
3. Работа свёрнутого блока ненадёжных когда их 0 (блок не рендерится — OK по коду)
4. Авто-выбор первого направления при единственном результате — не реализован
5. Сортировка таблицы по клику на заголовок — не реализована
6. Кнопка «Создать видео» из результатов подниши — не добавлена

## Открытые вопросы

- Ограничить ли шаг 1 (directions) BYOK так же, как шаг 2? Сейчас любой авторизованный пользователь с тарифом может получить направления бесплатно — quota_used=0.

---

# Отчёт: 2026-08-07 (YouTube 429 rate-limit resilience)

## Что сделано

Добавлена защита от YouTube 429 (rate-limit при параллельных запросах). В прошлом прогоне 13/18 ниш падали на `/search` или `/videos`.

### Изменения в коде

Одинаковые изменения в **`route.ts`** и **`scripts/test-sub-niche-finder.mjs`**:

- `YouTubeRateLimitError` — новый класс (отдельно от `YouTubeQuotaError`). 429 = rate-limit, не квота; retry безопасен.
- `ytFetch`: бросает `YouTubeRateLimitError` при status 429 (до проверки квоты)
- `ytf()` — обёртка: бесконечный цикл, на `YouTubeRateLimitError` ждёт `RATE_LIMIT_DELAYS[attempt]` мс (2000, 4000) и повторяет; остальное — пробрасывает
- Step 2+3: `Promise.all(всё)` → `for`-цикл батчами по `ENRICH_CONCURRENCY=4` с паузой `ENRICH_BATCH_DELAY=400ms`
- `fetch_error: string | null` в `RawEnriched` → `ComputedNiche` → `SubNicheResult` — сбой ниши виден в ответе, не молчит
- Step 5: `Promise.all(топ-5)` → `for`-цикл батчами по `GROWTH_CONCURRENCY=3` с паузой `GROWTH_BATCH_DELAY=500ms`

### Live-test: "музыка для прослушивания" (2026-08-07)

**18/18 reliable, все 5 топ-подниш посчитаны, 0 ошибок 429.**

Quota: 2341 юн. (при прежних 13 падениях до videos.list quota была ~611 — теперь все ниши доходят до конца). Время: Step 2+3 = 5.5с, Step 5 = 1.9с, итого ~7.5с, хорошо меньше 1 мин.

Таблица сравнения old_gr / new_gr по всем 5 топ-поднишам:

| Подниша | old_gr | new_gr | age_f(д) | age_o(д) | коррекция |
|---|---|---|---|---|---|
| Ностальгические хиты 80-90х | 0.07 | 0.45 | 36 | 223 | 6.4× |
| Джазовая музыка для отдыха | 0.20 | 1.47 | 46 | 297 | 7.3× |
| Электронная музыка для слушания | 0.43 | 1.76 | 62 | 207 | 4.1× |
| Медитативная и релакс музыка | 0.09 | 0.63 | 41 | 305 | 7.0× |
| Соул и R&B для слушания | 0.29 | 0.97 | 68 | 192 | 3.3× |

Вывод: old_gr систематически занижен в 3–7× из-за разрыва возрастов когорт. new_gr = скорость набора просмотров (vpd). Электронная музыка и джаз — реально растущие ниши (new_gr > 1), хиты 80-90х и медитация — падающие.

## Открытые вопросы

Нет. Следующий шаг: UI-вкладка в `/analytics/page.tsx`.

---

# Отчёт: 2026-08-07 (нормировка growth_ratio на возраст видео)

## Что сделано

Реализована vpd-нормировка `growth_ratio` в `sub-niche-finder`. Quota не изменилась.

### Изменения в коде

**`src/app/api/analytics/sub-niche-finder/route.ts`:**
- `RawEnriched`: добавлено `views_vpd: number[]`, `fresh_ages: number[]`
- `ComputedNiche`: добавлено `views_vpd`, `median_age_fresh`, `median_age_old`
- `SubNicheResult.metrics`: добавлено `sample_age_days: { fresh, old }` — смещение когорты видно в ответе
- Step 2: строим `freshPubMap<videoId, publishedAt>` из snippet (уже приходит), вычисляем `vpd = viewCount / max(1, age)` при обработке videos.list
- Step 5: аналогично `oldPubMap`, `oldVpd[]`, `oldAges[]`; `growth_ratio = median(fresh_vpd) / median(old_vpd)`
- Sonnet prompt: обновлено описание growth_ratio → "просм/день"

**`scripts/test-sub-niche-finder.mjs`:**
- Зеркалит те же изменения (JS)
- Отслеживает `old_growth_ratio` (raw) и `growth_ratio` (vpd) параллельно
- Добавлена "музыка для прослушивания" (18 ниш)
- Таблица сравнения: `old_gr | new_gr | age_f(д) | age_o(д) | коррекция`

### Live-test: "музыка для прослушивания" (2026-08-07)

13 из 18 ниш упали в 429 (параллельные запросы исчерпали rate limit). Одна ниша с полными данными:

| Подниша | old_gr | new_gr | age_f(д) | age_o(д) | коррекция |
|---|---|---|---|---|---|
| Рок-баллады для прослушивания | 0.04 | 0.28 | 57 | 260 | 7.0× |

Теоретическая коррекция age_o/age_f = 260/57 ≈ 4.6×. Практическая 7× — из-за нелинейности: самые просматриваемые старые видео накопили несоразмерно много views, занижая vpd.

Quota: 611 юн. (без изменения относительно предыдущих прогонов; 13 ниш провалились до videos.list).

## Изменения в файлах состояния

TASKS:    ✅ growth_ratio нормирован — закрыто, таблица live-test в записи
CONTEXT:  пункт "age-bias НЕ исправлен" → "нормирован на возраст (2026-08-07)"
WORKFLOW: обновлён Случай — добавлен факт исправления

## Открытые вопросы владельцу

Нет. Следующий: UI-вкладка в `/analytics/page.tsx`.

---

# Отчёт: 2026-08-07 (разведка growth_ratio + реальные заголовки)

## Что сделано

Разведка двух гипотез по `sub-niche-finder`. Код не изменён.

### ЧАСТЬ 1 — growth_ratio: систематический bias

**Q1 — Окна (код):** fresh = last 90d, old = last 365d filtered ≥90d, оба с `order=viewCount`.

**Q2 — Нет, видео несопоставимого возраста.** `order=viewCount` смещает выборку к старшему краю каждого окна:
- fresh медиана ≈ 60–75 дней (не 45 — bias к уже набравшим просмотры)
- old медиана ≈ 220–300 дней
- Разрыв: **~4×**

**Q3 — views/day на top-5 прогона "музыка для прослушивания"** (поправочный множитель ≈3.8):

| Подниша | gr (текущий) | gr_adj (views/day) | Интерпретация |
|---|---|---|---|
| Лаунж и чилл | 0.26 | ≈0.99 | Плоский рынок, не обвал |
| Соул и R&B | 0.21 | ≈0.80 | Лёгкий спад |
| Ностальгич. 80-90х | 0.03 | ≈0.11 | Реальный спад ✓ |
| Инструментальная б/с | 0.58 | ≈2.20 | **Быстрый рост** |
| Рок-баллады | 0.03 | ≈0.11 | Реальный спад ✓ |

**Q4 — Рекомендация: нормировка на views/day, 0 доп. quota.**
`publishedAt` уже приходит в `snippet` search results (Step 5 строки 458-459) — просто не используется. Исправление: сохранить `Map<videoId, publishedAt>` из поиска, делить `viewCount / age` перед `medianOf`. То же в Step 2 для fresh. `growth_ratio` становится `median(views/day fresh) / median(views/day old)`. ~15 строк в route.ts.

### ЧАСТЬ 2 — подниши из реальных заголовков

**Q1 — search.list snippet:** title, description (~100c), publishedAt, channelTitle. **Тегов и categoryId нет** — только в videos.list.

**Q2 — videos.list на практике:** categoryId есть всегда (90%+ = 10/Music → слишком однородно); теги у 40-70% видео (разброс большой). Для сегментации ниш — малополезно.

**Q3 — 50 заголовков из "музыка" поиска НЕ дают 15-18 creator-ниш.** Haiku нашёл 7 creator-friendly ниш из 50 заголовков (vs 15 из памяти). Причина: ~40% результатов — официальные клипы лейблов (Morgenshtern, NILETTO и т.д.) — шум для анализа контент-мейкеров.

**Q4 — Расход quota:** +101 юн. за 1 поиск (+5%), +303 за 3 поиска (+15%). **Нулевой вариант:** использовать titles из уже существующих per-niche поисков Step 2 (данные уже есть, не сохраняются).

**Q5 — Вывод:** Текущий подход (Haiku из памяти) **лучше** для "музыка"-запроса. Broad search возвращает consumer-content, не creator-content. Если нужна привязка к реальным данным — titles из Step 2 per-niche searches, а не из "музыка" в целом.

## Что не получилось

Live-test Part 1 (fetch real YouTube data): shared `YOUTUBE_API_KEY` исчерпал суточную квоту (~10000 юн.) за предыдущие тест-прогоны. Теоретический анализ Part 1 полностью заменяет live-тест (математика детерминирована).

## Изменения в файлах состояния

TASKS:    добавлено предупреждение о growth_ratio bias в строку sub-niche-finder, приоритет исправления
CONTEXT:  добавлен bullet "growth_ratio age-bias (выявлен разведкой 2026-08-07, НЕ исправлен)"
WORKFLOW: добавлен кандидат "Временны́е метрики сравнения когорт требуют нормировки на возраст"

## Открытые вопросы владельцу

Нет. Исправление growth_ratio однозначно рекомендуется; решение о реализации — за владельцем.

---

## Отчёт: 2026-08-07 (retention-крон)

## Что сделано

Починен retention-крон: разорван цикл planning loop, отбор кандидатов переключён на `media_expires_at`.

---

### Причина 8 NULL-проектов

Строка 2848 (до правки): `&status=not.like.generating_*` в planning step.
Проекты с `status LIKE 'generating_%'` исключались из планирования — они никогда не получали `media_expires_at`.
Два от 05.08 — вероятно, легитимно ещё генерируются. Пять-шесть от июля — zombie (застряли в generating-статусе).

---

### Правки кода (`video-server/index.js`)

**Planning step (строки 2841-2861):**
- Добавлен фильтр `&media_expires_at=is.null` → обрабатывает ТОЛЬКО новые/ненастроенные проекты
- Убран `&status=not.like.generating_*` → zombie-проекты теперь тоже получают expiry (кандидатом всё равно не станут пока статус generating)
- Убраны `updated_at` и `media_expires_at` из select → только `created_at`
- Считает от `created_at`, не от `updated_at` → trigger `on_projects_updated` всё ещё срабатывает (и сбрасывает `updated_at`), но это теперь безвредно: planning step больше не перезаписывает уже выставленные записи

**Candidate query (строки 2863-2875):**
- Удалена `const isoThreshold = ...`
- `&updated_at=lt.${isoThreshold}` → `&media_expires_at=lt.${isoNow}`
- `select=...updated_at...` → `select=...media_expires_at...`

**Step 3 (строки 2877-2884):**
- `_ageHours` теперь = часы после истечения `media_expires_at`, не возраст проекта

---

### SQL для миграции данных (владелец выполняет в Supabase SQL Editor)

**Шаг 0 — проверка до изменений:**

```sql
-- Покажет все проекты, у которых media_expires_at неверен или пуст
-- drift_h > 0 — выставлен от времени крона, а не от created_at
SELECT
  id,
  status,
  created_at::timestamptz(0)                                                  AS created,
  media_expires_at::timestamptz(0)                                            AS current_expires,
  (created_at + interval '72 hours')::timestamptz(0)                          AS correct_expires,
  ROUND(EXTRACT(EPOCH FROM (
    COALESCE(media_expires_at, created_at) - (created_at + interval '72 hours')
  )) / 3600)                                                                   AS drift_h
FROM public.projects
WHERE media_purged_at IS NULL
  AND (audio_url IS NOT NULL OR video_url IS NOT NULL
       OR scene_images IS NOT NULL OR thumbnail_url IS NOT NULL)
  AND (
    media_expires_at IS NULL
    OR ABS(EXTRACT(EPOCH FROM (media_expires_at - (created_at + interval '72 hours')))) > 3600
  )
ORDER BY created_at ASC;
```

Ожидаемый результат: 48 строк (~40 с неверным expires + 8 NULL).
У 8 NULL-проектов увидите status: скорее всего `generating_images` / `generating_audio` / аналогичный.

**Шаг 1 — UPDATE (после проверки результатов Шага 0):**

```sql
-- Пересчитать media_expires_at от created_at для всех проблемных проектов.
-- NOTE: UPDATE сбросит updated_at = now() через триггер — это безвредно после деплоя кода,
-- т.к. candidate query теперь смотрит на media_expires_at, а не updated_at.
-- NOTE: если RETENTION_MEDIA_HOURS ≠ 72 — замените '72 hours' на нужное значение.
UPDATE public.projects
SET media_expires_at = created_at + interval '72 hours'
WHERE media_purged_at IS NULL
  AND (audio_url IS NOT NULL OR video_url IS NOT NULL
       OR scene_images IS NOT NULL OR thumbnail_url IS NOT NULL)
  AND (
    media_expires_at IS NULL
    OR ABS(EXTRACT(EPOCH FROM (media_expires_at - (created_at + interval '72 hours')))) > 3600
  );
```

После этого UPDATE: проекты от июля получат `media_expires_at` = июль+72ч (в прошлом), то есть сразу станут кандидатами.

**Шаг 2 — проверка после UPDATE:**

```sql
SELECT
  id,
  created_at::date                                                             AS created,
  media_expires_at::timestamptz(0)                                             AS expires,
  ROUND(EXTRACT(EPOCH FROM (media_expires_at - NOW())) / 3600)                 AS expires_in_h,
  status
FROM public.projects
WHERE media_purged_at IS NULL
  AND (audio_url IS NOT NULL OR video_url IS NOT NULL
       OR scene_images IS NOT NULL OR thumbnail_url IS NOT NULL)
ORDER BY media_expires_at ASC
LIMIT 20;
```

Ожидается: проекты от июля показывают `expires_in_h < 0` (просроченные) — это будущие кандидаты на очистку.

---

### Порядок действий после деплоя

1. **Задеплоить** — Railway подхватит из GitHub автоматически
2. **Выполнить SQL Шаг 0** — убедиться в правильности
3. **Выполнить SQL Шаг 1** — пересчитать данные
4. **Выполнить SQL Шаг 2** — проверить итог
5. **Временно включить** `RETENTION_DRY_RUN=true` (если сейчас false) и дождаться прогона 04:00 UTC
6. **Посмотреть лог** — должен показать `[retention] N raw` (не 0) и список проектов без удалений
7. **Владелец просматривает список** кандидатов — это ~40+ проектов, удаление необратимо
8. **Включить** `RETENTION_DRY_RUN=false` — реальная очистка

---

---

## sub-niche-finder v2 — четыре алгоритмических исправления (2026-08-07)

### Что сделано

Четыре исправления в `src/app/api/analytics/sub-niche-finder/route.ts` и `scripts/test-sub-niche-finder.mjs`:

1. **search_query** — Haiku теперь выдаёт два поля: `name` (полное название для UI) + `search_query` (2–3 слова, как пользователь ищет на YouTube). YouTube API (`/search`) использует `search_query`, не `name`. Фикс корня проблемы: «Разбор гитарных аккордов для начинающих» давал 0–2 результата, «гитара с нуля» — 50.

2. **reliable flag** — `reliable: boolean` добавлен в `ComputedNiche` и `SubNicheResult`. `reliable = sample_videos >= 5 AND sample_channels >= 5`. Ненадёжные подниши возвращаются в ответе, но исключены из top-5 и помечены в Sonnet-промпте.

3. **Top-5 фильтр** — `.filter(n => n.reliable && ...)` перед сортировкой. Ниши с малой выборкой не могут попасть в топ сколь угодно высоким newcomer_share.

4. **growth_ratio null-порог** — `null` при `oldViews.length < MIN_OLD_SAMPLE_GROWTH` (= 10). Раньше gr=1.83 из 7 видео выглядело как открытие.

Cache key: `v1` → `v2` (формат ответа изменён).

### Результаты live-test v2

| ниша | reliable | quota |
|---|---|---|
| "музыка" | **14/15** (было ~9-11) | 2035 |
| "личные финансы" | **15/15** (было ~9-11) | 2035 |

Итого: 4070 юнитов из 10 000 дневных (41%).

Top-5 в обоих прогонах — только reliable (min c_s=6, max=45). Все old_sample ≥ 30, поэтому growth_ratio вычислен для всех 5 в обоих прогонах (декларируют падение рынка, что совпадает с реальностью).

### Следующий шаг

UI-вкладка в `/analytics/page.tsx` — карточки подниш, таблица метрик, вердикт Sonnet, выбор направления.

---

## niche-directions (уровень 1) + direction parameter (2026-08-07)

### Что сделано

**Новый маршрут** `src/app/api/analytics/niche-directions/route.ts`:
- Haiku-only, YouTube API не используется, `quota_used: 0`
- Разбивает широкую нишу на 5–7 **рыночных сегментов** (аудитории с разными мотивациями — не подтемы)
- Gate: `resolveAnalyticsContext` (план/BYOK), без дополнительного BYOK-only гейта
- Кэш 30 дней (`analytics_cache`, `cache_type='niche_directions'`, key: `{нишa}|{lang}|v1`)
- Возвращает `{broad_niche, directions: [{name, description, examples[]}], quota_used: 0, analyzed_at}`

**Параметр `direction` в sub-niche-finder:**
- Необязательный: если передан, Haiku генерирует подниши только внутри этого сегмента
- Cache key: `{ниша}|{country}|{lang}|dir:{direction}|v2` — отдельно от полного прогона
- Назвние отчёта: `Подниши: {ниша} → {direction}` при наличии direction
- Полный прогон без direction — не изменён

**Тест-скрипт** `scripts/test-niche-directions.mjs` (запуск: `railway run node scripts/test-niche-directions.mjs`).

### Результаты live-test (2026-08-07)

**niche-directions "музыка"** (quota=0):
1. Слушатели и аудитория — плейлисты, разборы альбомов, подборки по настроению
2. Обучение и развитие навыков — уроки, туториалы, теория музыки
3. Производство и звукозапись — DAW, микширование, мастеринг
4. Оборудование и гаджеты — обзоры гитар, микрофонов, наушников, синтезаторов
5. Индустрия и карьера — интервью с артистами, монетизация, история жанров
6. Лайв-перформансы и события — концерты, фестивали
7. Культурное наследие и анализ — история жанров, влияние музыки

**niche-directions "личные финансы"** (quota=0):
1. Начинающие инвесторы
2. Бизнес и самозанятость
3. Экономия и бюджетирование
4. Пассивный доход и инвестирование
5. Финансовая защита и страхование
6. Налоги и право
7. Карьера и увеличение дохода

**sub-niche-finder direction="музыка для прослушивания"** (quota=2341, reliable=16/18):
- Все 18 подниш строго о слушании (лаунж, соул, ностальгия, инструментальная, рок-баллады и т.д.)
- Полный прогон "музыка" охватывал все 4 рынка (слушатели + обучение + производство + индустрия)
- Лучший newcomer_share: Лаунж и чилл (0.62), Соул и R&B (0.59)
- Лучший рост: Инструментальная без слов (gr=0.58)

### Следующий шаг

UI-вкладка: двухуровневый поиск — сначала niche-directions (бесплатно), потом sub-niche-finder с выбранным direction.

---

## Разведка: аналитическая инфраструктура YouTube API (2026-08-06)

### Q1. Маршруты — вызовы и квота

| Маршрут | Гейт | YouTube вызовы | Квота (юнит) | Claude | Cache |
|---|---|---|---|---|---|
| `/api/analytics/niche` | план≠free (BYOK нет) | search×2 + channels + videos | ~202 | 2×Sonnet | `analytics_cache` 72ч |
| `/api/analytics/trends` | `resolveAnalyticsContext` | search×1 + videos | ~101 | 2×Sonnet | `analytics_cache` 72ч |
| `/api/analytics/channel` | `resolveAnalyticsContext` | channels(1) + playlistItems(1–4) + videos.list(1–4) | 3–111 | 2×Sonnet | `analytics_cache` 72ч |
| `/api/analytics/niche-finder` | `resolveAnalyticsContext` | search×3 + videos×3 | ~330 | 3×Sonnet | нет (→`analytics_reports`) |
| `/api/analytics/keywords` | `resolveAnalyticsContext` | search×1 + videos | ~101 | 2×Sonnet | `analytics_cache` 72ч |

`/niche` — старый роут, использует глобальный `YOUTUBE_API_KEY` напрямую, BYOK не поддерживает.
`/channel` с текст-поиском: 100 (search.list type=channel) + 1 (channels.list) + 1–4 (playlistItems, страницы) + 1–4 (videos.list, батчи по 50) = до ~111 юнитов.

### Q2. BYOK — хранение и шифрование

1. Пользователь вводит ключ → `POST /api/settings/save-yt-key` (`src/app/api/settings/save-yt-key/route.ts`):
   - Валидация: формат `AIza...` (30–50 символов)
   - Пробный вызов `channels?part=id&id=UC_x5XG1OV2P6uZZ5FSM9Ttw` — живой ключ
   - Шифрование: `encryptKey(key)` → AES-256-GCM
   - Формат в БД: `IV(12 bytes) || AuthTag(16 bytes) || Ciphertext` как hex → `profiles.encrypted_yt_key`
2. Мастер-ключ: env `YT_KEY_ENCRYPT_SECRET` (64 hex = 32 байта). Файл: `src/lib/crypto.ts`.
3. Авторизация на каждом запросе: `resolveAnalyticsContext()` (`src/lib/analytics-gate.ts`) — одно чтение из `profiles`, дешифровка, результат:

| Ситуация | `apiKey` | `fallbackKey` | скидка |
|---|---|---|---|
| free plan | — | — | gate закрыт (`plan_required`) |
| paid + encrypted_yt_key | расшифрованный ключ | `YOUTUBE_API_KEY` | −30% |
| paid, ключа нет | `YOUTUBE_API_KEY` | — | 0% |

### Q3. Управление квотой

- **Внутреннего счётчика нет.** Ограничения — только со стороны YouTube.
- `checkYouTubeQuota(status, body)` (`src/lib/youtube-quota.ts`) — бросает `YouTubeQuotaError` при status=403 + `reason` = `quotaExceeded` | `dailyLimitExceeded`.
- Каждый маршрут ловит `YouTubeQuotaError`: BYOK → `byokQuotaResponse()`, иначе → `quotaExceededResponse()`.
- BYOK-fallback: при `YouTubeQuotaError` с пользовательским ключом → retry на shared ключ (если `fallbackKey` есть).

### Q4. Переиспользуемые паттерны

| Что | Файл | Функция |
|---|---|---|
| Gate + BYOK + стоимость | `src/lib/analytics-gate.ts` | `resolveAnalyticsContext(userId, svc, lang)` |
| 403 detection | `src/lib/youtube-quota.ts` | `checkYouTubeQuota(status, body)` |
| Типизированная ошибка квоты | `src/lib/youtube-quota.ts` | `class YouTubeQuotaError` |
| Стандартные ответы | `src/lib/youtube-quota.ts` | `byokQuotaResponse()`, `quotaExceededResponse()`, `youTubeKeyErrorResponse()` |
| Шифрование | `src/lib/crypto.ts` | `encryptKey()` / `decryptKey()` |

**Архитектурный паттерн Claude→API→Claude** (из `niche-finder/route.ts`):
1. Claude генерирует N кандидатов (один запрос, дёшево)
2. YouTube API верифицирует топ M параллельно (`Promise.all`)
3. Claude финализирует ранжирование и рекомендации

**Паттерн cache + report** (одинаков во всех маршрутах):
```
analytics_cache: upsert { cache_type, cache_key, result, created_at }
                 select WHERE cache_type=X AND cache_key=K AND created_at > now-72h
                 delete WHERE created_at < now-72h   ← cleanup non-fatal
analytics_reports: insert { user_id, report_type, title, query, result }
                   cap 20/юзер/тип — удалять самую старую при overflow
```

**`ytf()` с BYOK-fallback** (копируется в каждый маршрут):
```ts
async function ytf(path, params) {
  try { return await ytFetch(path, params, apiKey) }
  catch (e) { if (e instanceof YouTubeQuotaError && fallbackKey) return ytFetch(path, params, fallbackKey); throw e }
}
```

### Оценка квоты: 20 подниш × 2 возрастных среза

Для каждой подниши — 2 поиска с разными `publishedAfter` (например, 0–6 мес vs 6–24 мес):

| Вызов | Units | Повторений |
|---|---|---|
| `search.list?type=video&q={niche}&publishedAfter={slice1}` | 100 | 20 |
| `videos.list` stats slice 1 | 1 | 20 |
| `search.list?type=video&q={niche}&publishedAfter={slice2}` | 100 | 20 |
| `videos.list` stats slice 2 | 1 | 20 |
| **Итого (только видео)** | **4 040** | — |

С анализом конкурентов (`search.list?type=channel` × 20 подниш): +2 020 → **~6 060 units** всего.

Дневная квота: 10 000 units. Один прогон = 40–60% квоты → **BYOK обязателен**.

---

---

## Разведка: что умеет niche-finder и чего не хватает (2026-08-06)

### Что он делает

Персональный советник — вход: `{interests, skills, time_per_week, goal, country, content_lang}`. Claude генерирует 5 ниш под профиль человека. YouTube API вызывается только для топ-3 ниш: `search?type=video&order=viewCount&maxResults=10` + `videos?part=statistics`. Данные из API: `pageInfo.totalResults` (video_count) и avg по топ-10 видео (avg_views). Полностью подключён к UI — вкладка «Поиск ниши» / «Find Niche» на `/analytics`.

Структура ответа:
```json
{
  "niches": [{ "name", "match_score", "reason", "monetization", "difficulty",
               "time_required", "example_channels", "first_video_idea",
               "youtube_data": { "video_count", "avg_views" } }],
  "winner": { "name", "why_best", "action_plan", "realistic_timeline", "potential_income" },
  "alternatives": [{ "name", "when_to_consider" }],
  "avoid": [{ "name", "reason" }],
  "user_profile": { "interests", "skills", "time_per_week", "goal" }
}
```

### Чего нет по сравнению с замыслом

| Фича | Статус | Причина |
|---|---|---|
| Разбивка широкой ниши на подниши | ❌ | Вход — профиль человека, не «музыка». Claude подбирает под личность |
| Возрастные срезы (publishedAfter) | ❌ | publishedAfter нигде не используется. avg_views — топ-10 всех времён |
| Подписчики каналов в топе (конкуренция) | ❌ | `videos?part=statistics` → только viewCount. subscriberCount не запрашивается |
| Реальные цифры конкуренции | ⚠️ | video_count и avg_views реальные. Но `difficulty` («Средняя») — 100% Sonnet без данных |

### Качество данных

`video_count` и `avg_views` — реальные API-данные. `difficulty`, `monetization`, `example_channels` — чистые суждения/галлюцинации Sonnet. Поле `difficulty` в UI выглядит как вычисленная оценка, но ничем не подкреплено.

### Вывод: доработать или новый маршрут?

**Новый маршрут.** Существующий niche-finder рабочий, в UI подключён, своё назначение выполняет («какая ниша подходит мне лично»). Менять его вход сломает флоу. Замысел владельца — другой вопрос: «какие подниши рынка сейчас растут» — новый роут `/api/analytics/sub-niche-finder` с входом `{broad_niche}`, 2 age-slice, channel subscriber lookup. Переиспользует весь стек утилит (`resolveAnalyticsContext`, `ytf`, `analytics_cache` etc).

---

## Что не получилось

Прочерк.

---

## Изменения в файлах состояния

TASKS:    задача retention обновлена — добавлен статус «починено», SQL оставлен как инструкция для владельца; добавлена задача sub-niche finder
CONTEXT:  обновлён YouTube Data API (детальные квоты), обновлена строка retention (planning loop починен)
WORKFLOW: без изменений

---

## Открытые вопросы владельцу

1. Выполнить SQL-миграцию (Шаги 0-2 выше) перед первым боевым прогоном.
2. Прогнать один раз с DRY_RUN=true — посмотреть список кандидатов в Railway Logs.
3. 8 zombie-проектов (статус `generating_*` с июля): после очистки медиа они останутся в таблице с `media_purged_at` выставленным — решить, нужно ли переводить их в статус `failed`.
4. B2 HTTP 400 (Content-MD5) — отдельная задача, не затронута в этом коммите.

---

---

## Новый маршрут: /api/analytics/sub-niche-finder (2026-08-07)

### Что сделано

Написан маршрут `src/app/api/analytics/sub-niche-finder/route.ts`.
Добавлена константа `CREDIT_COSTS.sub_niche_finder = 5000` в `src/lib/types.ts`.

---

### Алгоритм (6 шагов)

1. **Auth + BYOK gate** — `resolveAnalyticsContext` → план+ключ. Если нет своего ключа — 403 `byok_required` с `settings_url='/settings'` и `quota_budget=2600`. Shared ключ не используется вообще.
2. **Cache check** — `analytics_cache` WHERE `cache_type='sub_niche_finder'` AND `cache_key='{niche}|{country}|{content_lang}|v1'` AND `created_at > now-72h`. Hit → вернуть без Claude/YouTube.
3. **Credits gate** — `requireCreditsAmount(cost(5000))`, стоимость с BYOK-скидкой 30% = 3500 кр.
4. **Haiku** — генерирует 15–20 подниш + rpm_level/rpm_reason (оценка модели, `source:'estimate'`).
5. **Parallel enrich** (все подниши одновременно):
   - `search.list?publishedAfter=90d` → 100 юн./ниш; `pageInfo.totalResults` = `fresh_video_count`
   - `videos.list?part=statistics` батч 50 → 1 юн./батч; viewCount[]
   - `channels.list?part=statistics,snippet` батч 50 → 1 юн./батч; subscriberCount[], publishedAt[]
   - Метрики: `median_views` = medianOf(views), `newcomer_share` = доля каналов < 12 мес., `top_subs_median` = medianOf(subs)
6. **Top-5 growth** (по newcomer_share × median_views):
   - `search.list?publishedAfter=365d` → 100 юн./ниш; фильтр `daysOld(publishedAt) >= 90` (исключить пересечение с fresh)
   - `videos.list` batched → medianOf(oldViews)
   - `growth_ratio = median_fresh / median_old` (если данных нет → null)
7. **Sonnet вердикт** — получает числа из API, ранжирует top-5 + 2–3 «избегать», `overall_advice`. Всё `source:'estimate'`.

---

### Структура ответа

```json
{
  "broad_niche": "финансы",
  "quota_used": 2345,
  "analyzed_at": "2026-08-07T...",
  "sub_niches": [{
    "name": "Кредитные карты с кэшбэком",
    "metrics": {
      "fresh_video_count":      {"value": 15420,  "source": "api"},
      "median_views_per_video": {"value": 45000,  "source": "api"},
      "newcomer_share":         {"value": 0.32,   "source": "api"},
      "top_subs_median":        {"value": 85000,  "source": "api"},
      "growth_ratio":           {"value": 1.3,    "source": "api"}
    },
    "rpm_estimate": {
      "level":  {"value": "высокий", "source": "estimate"},
      "reason": {"value": "Банки платят высокий CPC", "source": "estimate"}
    }
  }],
  "verdict": {
    "ranking": [{"name":"...","summary":"...","recommendation":"..."}],
    "overall_advice": "...",
    "source": "estimate"
  }
}
```

---

### Ключевые решения

| Решение | Почему |
|---|---|
| BYOK-only, без fallback на shared | ~2600 юнитов = 26% дневной квоты; один прогон на общем ключе выкашивал бы весь день |
| 403 с объяснением квоты в тексте | Платный юзер без ключа не видел сообщения о «бесплатном плане» — нужен другой текст |
| `source: 'api' \| 'estimate'` на каждом поле | Договорились разделять реальные данные и суждения модели явно, не неявно |
| `medianOf` вместо среднего | Устойчив к аутлайерам (одно вирусное видео не искажает картину) |
| growth_ratio = fresh/old (не overlapping cohorts) | old search `publishedAfter=365d`, затем фильтр `daysOld >= 90` на клиенте — исключает пересечение |
| Top-5 growth только для лучших по newcomer_share | Экономия квоты: +100 юн. × 5 вместо × 20 |

---

### Что осталось

- **UI-вкладка** в `src/app/(dashboard)/analytics/page.tsx` — форма с полем «широкая ниша», таблица подниш с метриками и source-бейджами, блок вердикта. Явно вынесено в отдельную задачу.
- **Тестовый прогон** — фактический `quota_used` вернётся в поле ответа; сравнить с ~2600 оценкой.

---

## Изменения файлов состояния (2026-08-07)

TASKS:   sub-niche finder помечен [x], добавлена детальная запись об алгоритме и том, что осталось (UI)
CONTEXT: строка YouTube Data API дополнена /sub-niche-finder и пояснением об отсутствии fallback

---

---

## Live-тест: sub-niche-finder на двух нишах (2026-08-07)

### Что сделано

Написан скрипт `scripts/test-sub-niche-finder.mjs` (зеркало шагов 2–5 маршрута, без HTTP-слоя).
Прогнаны два контрольных запроса: "музыка" и "личные финансы", рынок RU, язык ru.
Anthropic шаги (1, 6) пропущены — ключ только в Vercel; подниши для теста хардкодированы.

---

### Квота

| Ниша | Фактически | Оценка |
|---|---|---|
| "музыка" | **2031** юн. | ~2600 |
| "личные финансы" | **2030** юн. | ~2600 |
| Итого на два прогона | **4061 из 10 000** (41%) | |

Оценка завышена на ~22% — запас хороший, лимит не пробьём.

---

### Таблицы метрик

**МУЗЫКА** (sorted by newcomer_share DESC):

```
Подниша                                      ns    med_v  fvc_90d   subs    gr  v_s  c_s
Музыка для концентрации и учёбы            0.64      700    154k     809  0.30   50   11
Музыка для медитации и сна                 0.43       1k    149k      8k  0.00   50   28
История рок-музыки СССР и России            0.43       9k      2k      7k  1.83    7    7  ⚠ малая выборка
Уроки пения для начинающих                  0.25      724     64k     249  0.46    4    4  ⚠ малая выборка
Каверы популярных песен на гитаре           0.23       8k    101k      7k  0.02   50   22
Музыкальная теория с нуля                   0.20      589      664     637    —    6    5
Обзоры музыкальных альбомов                 0.18       1k    120k     667    —   50   39
Рэп-биты и продакшн треков                  0.14      698     63k      1k    —   30   22
Домашняя студия звукозаписи                 0.12      492      912      5k    —   44   41
Синтезаторы и электронная музыка            0.08       2k    156k      1k    —   50   36
Разбор гитарных аккордов для начинающих     0.00       4k      6k     738    —    2    2  ⚠ малая выборка
DJ-миксинг и техники диджеинга              0.00        0        2       0    —    0    0  ❌ нет данных
Классическая музыка — разборы и история     0.00      426      404      3k    —    2    2  ⚠ малая выборка
Ноты и табулатуры — урок на слух            0.00        0      121       0    —    0    0  ❌ нет данных
Музыкальные инструменты — выбор и обзор     0.00      744     52k      6k    —    6    5
```

**ЛИЧНЫЕ ФИНАНСЫ** (sorted by newcomer_share DESC):

```
Подниша                                      ns    med_v  fvc_90d   subs    gr  v_s  c_s
Ведение бюджета и трекер расходов           0.50       1k      128    24k  1.23    8    2  ⚠ малая выборка
Пенсия и государственные накопления         0.50      621      532     554  0.39    4    4  ⚠ малая выборка
Накопительные счета: актуальные ставки       0.33       2k       42      84  1.21    5    3  ⚠ малая выборка
ИП и самозанятость: налоги и учёт            0.23      909       1k     207  0.03   50   35
Налоговые вычеты 13% — как получить          0.22      962      308      33  0.45   10    9
Криптовалюты — осторожные инвестиции         0.21      645     50k      2k    —   33   29
Инвестиции для начинающих: ОФЗ и акции       0.20       1k     39k     12k    —   16   10
Страхование жизни — что выбрать              0.14       72      621      3k    —   17   14
Избавление от кредитов и долгов              0.13      869      747      9k    —    8    8
Кредитные карты с кэшбэком — сравнение       0.00       6k      150     37k    —    2    2  ⚠ малая выборка
Недвижимость как пассивный доход             0.00       8k     90k       0    —   50    0  ⚠ нет channel-данных
Облигации и ОФЗ для консерваторов            0.00        0        4       0    —    0    0  ❌ нет данных
FIRE-движение: ранняя пенсия в России        0.00       70      105      5k    —    1    1  ⚠ малая выборка
Инвестиции для детей: как начать             0.00       1k       2k     19k    —    1    1  ⚠ малая выборка
Фриланс и налоги — не потерять деньги        0.00        0       24       0    —    0    0  ❌ нет данных
```

*ns=newcomer_share | med_v=median_views | fvc=fresh_video_count 90д | subs=top_subs_median | gr=growth_ratio | v_s=видео в выборке | c_s=каналов в выборке*

---

### Оценка метрик

**1. newcomer_share — дифференцирует ли тяжёлые от пробиваемых?**

ДА — диапазон 0.00–0.64 реальный. «Синтезаторы» (0.08, 36 каналов) vs «Медитация» (0.43, 28 каналов) — оба с хорошей выборкой, и разрыв осмысленный.

НО: **top-5 отбирается по newcomer_share до фильтрации на размер выборки**, поэтому в топ попадают:
- "Пенсия и накопления" (ns=0.50, **2 канала**) — 1 из 2 новый = случайность
- "История рок-музыки" (ns=0.43, **7 каналов**) — 3 из 7 = недостаточно для рыночного вывода

Пока в топ-5 могут пролезать шумовые ниши, которые Sonnet потом «рекомендует».

**Критерий надёжности: newcomer_share значим при `c_s >= 5`, предпочтительно >= 10.**

---

**2. growth_ratio — различается или кластеризован около 1?**

СИЛЬНО различается: 0.00, 0.02, 0.30, 0.46, 1.83 в музыке; 0.03, 0.39, 0.45, 1.21, 1.23 в финансах.
Это хорошо — метрика не вырождается.

НО: «растущие» подниши (gr > 1) имеют крошечную old_sample:
- "История рок-музыки" gr=1.83 → **old_sample=14** (borderline)
- "Ведение бюджета" gr=1.23 → **old_sample=12**
- "Накопительные счета" gr=1.21 → **old_sample=9**

Надёжный пример: "ИП и самозанятость" gr=0.03 → old_sample=50 → действительно стагнирует.

**Критерий надёжности: growth_ratio значим при `old_sample >= 10`, предпочтительно >= 15.**

---

**3. Достаточно ли топ-50 из одного поиска?**

Для популярных широких ниш — да (Медитация: 50/28, Синтезаторы: 50/36, ИП: 50/35).
Для специфичных русскоязычных запросов — нет. Примеры ненадёжных:
- DJ-миксинг: 0 видео/0 каналов (поиск не нашёл ничего по этому запросу)
- Ноты и табулатуры: 0 видео
- Инвестиции для детей: 1 видео/1 канал

Причина: YouTube search ищет по тексту, а русскоязычные каналы часто называются иначе. «Разбор гитарных аккордов для начинающих» — нет такого канала, есть «Гитара с нуля».

---

**4. Нужна ли пометка ненадёжности?**

ДА — обязательно. В каждом из двух прогонов 4–6 подниш из 15 имеют `v_s < 5`. Без флага Sonnet будет получать числа типа `{newcomer_share: 0.50, median_views: 621, sample_videos: 4}` и ранжировать их наравне с нишами на 50 видео.

---

### Что критически сломано в маршруте (до UI)

| # | Проблема | Исправление |
|---|---|---|
| 1 | Top-5 отбирается без фильтра на размер выборки | Фильтровать `sample_channels >= 5` перед sort |
| 2 | `growth_ratio` null только при `medianOld === 0`, не при малой выборке | null если `oldViews.length < 10` |
| 3 | Нет поля `reliable` в ответе | Добавить `reliable: v_s >= 5 && c_s >= 5` на каждую поднишу |

**Это нужно закрыть ДО запуска UI** — иначе пользователи будут видеть «горячие рекомендации» из шума.

---

## Что не получилось

Sonnet-вердикт не протестирован — `ANTHROPIC_API_KEY` в `.env.local` отсутствует (хранится только в Vercel). Это не блокер: YouTube-метрики (основная часть для оценки) получены; Sonnet тестировать можно на deployed endpoint после UI или добавив ключ в `.env.local` временно.

---

## Изменения файлов состояния (2026-08-07, live-test)

TASKS:   запись sub-niche-finder дополнена результатами live-test и тремя пунктами «осталось до UI»
CONTEXT: строка YouTube Data API: уточнён фактический quota_used (2030 вместо оценки 2600), добавлены инварианты надёжности выборки
WORKFLOW: добавлен кандидат «Метрика надёжна только при адекватном размере выборки»

---

## Открытые вопросы владельцу

1. Три исправления в маршруте до UI (см. таблицу выше) — отдать Claude Code?
2. ANTHROPIC_API_KEY добавить в .env.local для полного теста с Sonnet-вердиктом?
3. SQL-миграция retention (из предыдущего отчёта) — выполнена?
