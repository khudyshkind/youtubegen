# Handoff — 2026-08-17

## Цель сессии

Оценить надёжность Secret Slider, разобрать учёт списаний, реализовать вебхук-приёмник, перенести накопленные факты в CONTEXT/WORKFLOW/TASKS.

---

## Ключевые факты, установленные живыми запросами

### Слот SS

- Задача **63294** (2026-08-16T22:49Z) зависла в PROCESSING на 131+ мин.
- `cancel` вызван дважды — HTTP 200, `cancel_requested_count=2`, но слот так и не освободился.
- Принудительной остановки нет: в OpenAPI 21 операция, ни одна не прерывает PROCESSING.
- Часы машины: дрейф 0,00 мин относительно заголовка `Date` Supabase/SS → цифры точны.

### OpenAPI-аудит

- 21 задокументированная операция; 15 эндпоинтов работают вне спека.
- `POST /cancel` для PROCESSING: флаг `cancel_requested=True`, воркер не останавливается.
- `GET /api/v2/balance` — работает (`api_credits`, 60 req/min, rate_limit_per_day расхождение).
- `style='default'` — не входит в 106 допустимых значений `GET /api/v2/styles`. Передаём невалидное значение.
- `mode=visual` с `subject_image`/`scene_image`/`style_image` есть в спецификации, но не тестировался.

### Сверка учёта

| | Число |
|---|---|
| SS всего изображений (33 задачи) | 715 |
| Наши `image_secretslider` транзакции | 583 |
| Разница | **+132 на стороне SS** |

Основные причины расхождения:
- 23 задачи SS без нашего `image_job` (ранние задачи, до таблицы или до сохранения `provider_task_id`)
- Задача 53362: SS отработала после нашего таймаута, 29 картинок не забраны
- Задача 63252: 11 картинок SS выдал, но в `image_jobs` и `credit_transactions` — 0 (путь неизвестен)

Мы храним `provider_task_id`: `image_jobs.provider_task_id` заполнен у 10 из 15 boevikh jobs; 5 ранних — null.

### Разбивка по операциям (count=exact)

| операция | транзакций |
|---|---|
| `image_flux_schnell` | 2566 |
| `image_flux` | 407 |
| `image_nano_banana` | 24 |
| `image_secretslider` | 583 |
| `image_gpt_mini` | 0 |
| **Сумма** | **3580** ✓ |

### Вебхук-приёмник

- `POST /webhooks/secretslider` задеплоен на Railway, коммит **`ca3c2ce`**.
- HMAC-SHA256 верификация: `crypto.timingSafeEqual` с проверкой длины буфера.
- `express.raw()` зарегистрирован ДО `express.json()` на точечном маршруте.
- 5 живых тестов пройдены: 200 / 403 / 403 / 403 / 400.
- `webhook_url` к процессу генерации **не подключён** — только приём и логирование.

---

## Изменения файлов

| файл | что изменено |
|---|---|
| `video-server/index.js` | Добавлен вебхук-приёмник (коммит `ca3c2ce`) |
| `docs/CONTEXT.md` | +9 фактов в «Secret Slider — что умеет API»; ⚠️ перепроверить референс (`mode=visual`) |
| `docs/WORKFLOW.md` | +4 кандидата в правила (арифметика, источник чисел, OpenAPI, count=exact) |
| `docs/TASKS.md` | Отменён сторож `estimated_wait_seconds` (ненадёжен) |

---

## Открытые вопросы

1. **Слот занят задачей 63294** — на момент окончания сессии статус PROCESSING, `estimated_remaining_seconds` рос. Нет механизма принудительного освобождения. Ждать естественного завершения или истечения задачи у поставщика.

2. **style='default' — невалидный параметр.** Код передаёт его в `generateImagesSecretSlider`. Нужно выбрать один из 4 базовых стилей (`universal`, `photorealism`, `vector_art`, `illustration`) или убрать параметр. Новый TASKS-пункт не создавался.

3. **Задача 63252** (11 картинок, 2026-08-16) — SS выдал результат, но в нашей БД нет ни `image_job`, ни транзакций. Нужно выяснить путь: синхронный инструмент без provider_task_id?

4. **mode=visual с именованными полями** — не тестировался. Предыдущий тест был с произвольными именами полей. Перепроверить отдельно.

5. **Webhook URL не подключён** — следующий шаг: при создании задачи передавать `webhook_url` с подписью, в приёмнике обновлять `image_jobs.status`.

6. **Мониторинг баланса SS** — endpoint подтверждён (`GET /api/v2/balance`, заголовок `X-API-Key`), cron не реализован. Самый простой из всех провайдеров для подключения.

---

## Что НЕ делалось (по соглашению)

- Секреты не выводились
- `railway up` не использовался
- cancel больше не вызывался
- Новых задач в SS не создавалось
- Кредиты вручную не начислялись и не возвращались

---

# Handoff — 2026-08-18

## Цель сессии

Полный acceptance-тест вебхук-пути (image_jobs → Secret Slider webhook → finalization, DB-claim, dedup), документирование результатов в файлы состояния.

---

## Ключевые факты, установленные сегодня

### Acceptance-тест вебхук-пути (пункты 4–7, все пройдены)

- **Инструмент запуска:** `railway run --service ytgen-video-server node <live-test.mjs>` — переменные Railway подставляются автоматически.
- **job_id:** `23d6f4d5-b70a-482d-98b9-300c92f0faab`, task_id: `64127`.
- **webhook_registered: true** — подтверждено из Railway-логов.
- **scene_images:** 2 SS URL напрямую (тест с `project_id=null` → ветка `uploadImageUrlToStorage` не задействована).
- **credit_transactions:** ровно 2 (−200 каждое), итого −400 кр, `op=image_secretslider`.
- **finalization_claimed_at:** `2026-08-18T10:33:35.222+00:00`.
- **Гонка (пункт 5):** SS доставил 2 вебхука с разными event_id (`84e60658`, `a0a68b18`) одновременно + poll-цикл → 3 клеймера, победил 1 (webhook #1), DB-claim отработал атомарно.
- **Dedup (пункт 6):** первая доставка — `{"ok":true,"note":"already terminal"}`; вторая — `{"ok":true,"duplicate":true}`; credit_transactions не изменился.
- **ss_processed_events:** 5 записей после теста, включая `acceptance-dedup-23d6f4d5`.

### JSON vs multipart: webhook_url не регистрируется в multipart

- `Content-Type: application/json` → `webhook_registered: true`.
- `multipart/form-data` (`mode=visual`, текущий продакшн) → `webhook_registered: null`.
- Следствие: в продакшне SS вебхук не отправляет — основной механизм poll-цикл. Вебхук-инфраструктура готова для будущего JSON-режима.

### Что не проверено

- Ветка `uploadImageUrlToStorage` при `project_id != null` (строка `index.js:7114`). В тесте `project_id=null`. В продакшне `project_id` всегда задан — ветка не прогонялась.

---

## Изменения файлов

| файл | что изменено |
|---|---|
| `docs/CONTEXT.md` | +блок «Живая приёмка вебхук-пути 2026-08-18»: JSON vs multipart, DB-claim, ss_processed_events, dual-webhook; +удержание персонажа |
| `docs/TASKS.md` | Пункт 3 «Асимметрия путей secretslider» закрыт `[x]`, коммит `6d61c5b`, результаты приёмки; отмечено непроверенное: ветка Storage upload |
| `docs/handoff.md` | Добавлена секция 2026-08-18 (этот файл) |

---

## Открытые вопросы

1. **multipart vs JSON-режим** — продакшн-путь не регистрирует `webhook_url`. Уточнить: поддерживает ли SS JSON + `num_images` + `aspect_ratio`? Если да — перевести постановку задачи на JSON и вебхук станет основным путём.
2. **Storage upload branch** — `uploadImageUrlToStorage` при `project_id != null` не тестировалась. Проверить прогоном со студии (там `project_id` всегда задан).
3. **Открытые вопросы из 2026-08-17** — `style='default'` невалидный (вне 106 значений), задача 63252 (11 картинок без image_job), `mode=visual` с именованными полями (`subject_image` и т. п.) — не закрыты.

---

## Что НЕ делалось (по соглашению)

- Секреты не выводились
- `railway up` не использовался
- Кредиты вручную не начислялись и не возвращались
- Новых задач в SS не создавалось (кроме acceptance-теста: 2 картинки)
