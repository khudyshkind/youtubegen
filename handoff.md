# Отчёт: 2026-08-10 — кеширование AI-консультанта

## Что сделано

### 1. Диагностика "21 строка KB loaded"

Загрузка KB происходит **один раз при старте** — `fs.readFileSync` на уровне модуля (строка 105 `video-server/index.js`), результат в `lefiroKB`. На каждый запрос не перечитывается. 21 строка подряд = **21 рестарт/деплой процесса**, не зацикливание кода. Повторное чтение не нужно — всё корректно.

### 2. `cache_control: ephemeral` для AI-консультанта

Изменён вызов в `runConsultant` (`video-server/index.js:921–926`):

```js
// было
system: consultantSystem(),

// стало
system: [{ type: 'text', text: consultantSystem(), cache_control: { type: 'ephemeral' } }],
```

**Порядок блоков:** `consultantSystem()` возвращает `lefiroKB + '\n\n' + инструкции` — KB первым (строка 896). Это правильный порядок для кеширования (инвариантная часть ≥ 95% объёма system идёт первой).

**Экономика:** KB = 26 844 символа ≈ 6 700 токенов (порог Haiku 4.5 в 4 096 пройден). Каждый повторный вызов за 5 мин сэкономит 6 700 × ($0.80/M − $0.08/M) ≈ $0.0048 на system-части (−90%).

### 3. handoff.md — восстановление поведения

В предыдущей сессии handoff.md был случайно склеен из двух отчётов. Восстановлен протокол: файл перезаписывается при каждой задаче (не конкатенируется).

## Файлы

- `video-server/index.js` — строка 924: `system` изменён на массив блоков с `cache_control`
- `docs/CONTEXT.md` — секция «Prompt caching»: статус bot consultant обновлён (был "отсутствует" → "добавлен"), добавлены факты о KB
- `docs/TASKS.md` — закрыт пункт кеша консультанта; пункт "Кеширование сценария" остаётся открытым
- `handoff.md` — этот файл (перезаписан)

## Что не трогалось

- Логика консультанта (`runConsultant`, `consultantSystem`, rate-limit, ESCALATE)
- Правки надёжности TTS (SV sequential, Voicer retry, AbortSignal)
- Script chunked caching (перенос плана в system) — отдельная задача в TASKS.md

## Открытые вопросы

1. **Script chunked caching** — перенос `sections.map(...)` из `buildSectionUserMessage` в `buildSystemPrompt` (`script/route.ts`). Пока в TASKS.md как открытый пункт.
2. **Почему 21 рестарт?** Если это краш-цикл, а не деплои — найти причину в логах Railway (ошибки до/после "KB loaded"). Если деплои — норма.
