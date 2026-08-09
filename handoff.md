# Отчёт: 2026-08-10

## Что сделано

Разведка по логам Railway — кода не менялось.

(В этой же сессии ранее: коммит `8ce60f4` — fix `media_expires_at` не обновлялся при перегенерации медиа. 8 точек записи медиа дополнены GREATEST-guard обновлением. Хелпер `src/lib/media-expiry.ts`.)

### Ответы по четырём пунктам

**1. Параллельность SV.** `runLimited(tasks, 4)` — `index.js:6750`. 4 chunk'а = 4 POST к SV почти одновременно. Лесенка 167→208→251→305 с (шаг ~43 с) доказывает последовательную обработку на стороне SV. Chunk 2 ждёт 167 с (пока slot освободится), обрабатывается за ~41 с = 208 с итого. Параллельность **не даёт выигрыша**: total = сумма последовательных. Бурст мог перегрузить очередь SV и спровоцировать timeout для chunks 5–6.

**2. Почему повтор быстрее.** POLL_MS = 2500 мс фиксированный, deadline = `Date.now() + SV_CHUNK_TIMEOUT_MS` (600 с, ~240 итераций). На retry — **новая задача** через POST /synthesize, новый task_id. Старый task_id теряется безвозвратно. Пропустить готовый результат poll может в 2500-мс окне после последнего тика (~0.4%) — не основная причина. Вероятная причина 600 с + 11 с: первая задача попала в длинную глобальную очередь SV, retry — в пустую. Дополнительный риск: `fetch(/task/${taskId})` без AbortSignal (`index.js:6557`) — при зависании SV status API итерация не прервётся по дедлайну.

**3. Движок Voicer.** `maxChars: 195_000` (`index.js:6417`) → весь текст (16 233 зн.) одним chunk'ом. Voicer режет внутри (`split_type:'smart'`, `max_chunk_length:2500`, `index.js:6596`). Намеренный дизайн. Проблема: timeout 1800 с, **нет retry** (`index.js:6715`), watchdog убивает через 20 мин — до timeout не доходит. Один провал = потеря всего задания.

**4. Цена отказа.** SecretVoicer: 12–20 мин (watchdog). Voicer: 20 мин (watchdog). Уведомление `notifyUserJobDone('audio_failed')` вызывается при `t_job > 90 с` (`index.js:6850`) — для всех этих jobs выполняется. Но только если `telegram_chat_id` заполнен. Без TG — молчание; `status='failed'` выставляется всегда.

### Приоритет правок (вред/сложность)

| # | Правка | Сложность |
|---|---|---|
| 1 | `SV_CHUNK_TIMEOUT_MS`: 600→**180–240 с** | Одна Railway env, без деплоя |
| 2 | Retry для Voicer (1 попытка) | 3–4 строки в processAudioJob |
| 3 | `VOICER_CHUNK_TIMEOUT_MS`: 1800→**300–600 с** | Одна Railway env |
| 4 | SV concurrency 4→1 | Одно число в коде |

## Что не получилось

—

## Диагностический SQL (для предыдущей задачи, `media_expires_at`)

Проверить проекты с медиа новее expires_at:

```sql
SELECT id, created_at, updated_at, media_expires_at,
       audio_url IS NOT NULL AS has_audio,
       video_url IS NOT NULL AS has_video,
       ROUND(EXTRACT(EPOCH FROM (updated_at - media_expires_at)) / 3600, 1) AS hours_stale
FROM projects
WHERE media_purged_at IS NULL
  AND media_expires_at IS NOT NULL
  AND updated_at > media_expires_at
  AND (audio_url IS NOT NULL OR video_url IS NOT NULL
       OR (scene_images IS NOT NULL AND scene_images != '[]'::jsonb)
       OR thumbnail_url IS NOT NULL)
ORDER BY hours_stale DESC;
```

Если строки есть — расширить expiry:

```sql
UPDATE projects
SET media_expires_at = NOW() + INTERVAL '72 hours'
WHERE media_purged_at IS NULL
  AND (audio_url IS NOT NULL OR video_url IS NOT NULL
       OR (scene_images IS NOT NULL AND scene_images != '[]'::jsonb)
       OR thumbnail_url IS NOT NULL)
  AND (media_expires_at IS NULL OR media_expires_at < NOW() + INTERVAL '72 hours');
```

## Изменения в файлах состояния

TASKS:    добавлено «Надёжность TTS: SV таймаут и Voicer retry» в раздел ИНФРАСТРУКТУРА
CONTEXT:  раздел «Поставщики» — факты о SV очереди/таймауте и Voicer архитектуре (по логам 2026-08-10)
WORKFLOW: добавлен кандидат «Параллельность к асинхронному провайдеру не ускоряет обработку»

## Открытые вопросы владельцу

1. Снизить `SV_CHUNK_TIMEOUT_MS` до 180–240 с в Railway env — можно прямо сейчас?
2. Добавить retry для Voicer (3–4 строки кода) — разрешить?
3. Нужны ли логи task_id первых attempts SV, чтобы проверить, завершались ли они до timeout?
