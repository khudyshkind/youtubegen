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

## Что не получилось

Прочерк.

---

## Изменения в файлах состояния

TASKS:    задача retention обновлена — добавлен статус «починено», SQL оставлен как инструкция для владельца
CONTEXT:  обновлён раздел Retention — фикс задокументирован
WORKFLOW: без изменений

---

## Открытые вопросы владельцу

1. Выполнить SQL-миграцию (Шаги 0-2 выше) перед первым боевым прогоном.
2. Прогнать один раз с DRY_RUN=true — посмотреть список кандидатов в Railway Logs.
3. 8 zombie-проектов (статус `generating_*` с июля): после очистки медиа они останутся в таблице с `media_purged_at` выставленным — решить, нужно ли переводить их в статус `failed`.
4. B2 HTTP 400 (Content-MD5) — отдельная задача, не затронута в этом коммите.
