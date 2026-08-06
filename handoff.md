# Отчёт: 2026-08-06

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
