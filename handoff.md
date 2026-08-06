# Отчёт: 2026-08-06

## Что сделано

Разведка: почему retention после включения DRY_RUN=false по-прежнему удаляет 0. Найдены две независимые причины — ничего не менялось.

---

### Проблема 1 — 0 raw кандидатов

**Корень: самовоспроизводящийся цикл между planning step и trigger `on_projects_updated`.**

Trigger (`supabase/schema.sql:107-121`):
```sql
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();   -- на КАЖДЫЙ UPDATE проектов
  return new;
end;
```

Planning step (`video-server/index.js:2844-2862`):
- Берёт ВСЕ живые проекты (нет фильтра `media_expires_at=is.null`)
- Вычисляет `computeMediaExpiry(p.updated_at) = p.updated_at + 72h`
- Если drift > 1ч — патчит `media_expires_at`
- Patch → trigger → `updated_at = now()`
- Следующий день: `updated_at` стал вчера-04:00, `computeMediaExpiry(вчера-04:00) = вчера+72ч` ≠ `media_expires_at` (тоже вчера+72ч, но вычисленный от ещё более старого `updated_at`). Drift = 24ч > 1ч → патчит снова → trigger → `updated_at = now` → бесконечно.

Candidate-запрос (`строка 2876`): `&updated_at=lt.${isoThreshold}` — смотрит на `updated_at`, которое всегда = сегодня-04:00 → 0 кандидатов.

**Наблюдение владельца (UI-бейджи):** проекты от 23, 24, 25, 27, 28 июля показывают ~38ч остатка — одинаково. Это прямое следствие: `media_expires_at` у всех = последний прогон крона (04:00 UTC) + 72ч.

**SQL для верификации** (владелец выполняет в Supabase):
```sql
SELECT
  id,
  created_at::date                                                       AS created,
  updated_at::timestamptz(0)                                             AS updated_at,
  media_expires_at::timestamptz(0)                                       AS media_expires_at,
  ROUND(EXTRACT(EPOCH FROM (media_expires_at - NOW())) / 3600)           AS expires_in_h,
  ROUND(EXTRACT(EPOCH FROM (NOW() - updated_at))       / 3600)           AS updated_ago_h
FROM public.projects
WHERE media_purged_at IS NULL
  AND (audio_url IS NOT NULL OR video_url IS NOT NULL
       OR scene_images IS NOT NULL OR thumbnail_url IS NOT NULL)
ORDER BY created_at ASC;
```
Ожидаемый результат при наличии бага: `updated_ago_h` ≈ одинаковый (~20-28) у всех проектов независимо от `created`.

---

### Проблема 2 — B2 HTTP 400 (temp/ orphan cleanup)

`video-server/index.js:2767-2784`, функция `b2MediaDeleteObjects`:

POST `/?delete` (S3 DeleteObjects) отправляется с `x-amz-content-sha256` и `Content-Length`, но **без `Content-MD5`**. B2's S3-compatible API требует `Content-MD5` (Base64 MD5 от тела) для операции batch delete. Список (`b2MediaListObjects`, GET) работает — значит, auth и endpoint верны. Ошибка только в формате POST-запроса.

Фикс когда придёт время: добавить перед fetch в `b2MediaDeleteObjects`:
```js
const md5 = crypto.createHash('md5').update(body).digest('base64')
// добавить 'Content-MD5': md5 в headers
```

---

## Что не получилось

Прочерк. Разведка полная по обеим проблемам.

---

## Изменения в файлах состояния

TASKS:    задача retention обновлена — старая версия (DRY_RUN) заменена точными причинами с файлами и строками, добавлен SQL для верификации
CONTEXT:  раздел «Retention медиа» переписан — planning loop, trigger, B2 400; раздел «Известные ограничения» обновлён
WORKFLOW: без изменений

---

## Открытые вопросы владельцу

1. Выполнить SQL выше — убедиться, что `updated_ago_h` одинаковый у всех → подтвердить гипотезу о trigger.
2. После подтверждения: решать, в каком порядке чинить — trigger (migration) или смена candidate-запроса на `media_expires_at < NOW()`.
3. B2 temp/ — 16 файлов (1.16 МБ) не удаляются. Ждут фикса `Content-MD5`. Некритично, но накапливается.
