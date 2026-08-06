# Отчёт: 2026-08-06

## Что сделано

**Задача: разведка неотслеживаемых файлов (read-only, ничего не менять)**

Проверены все 19 untracked путей и 3 M-файла рабочего дерева.

---

### Таблица по каждому пути

| Путь | Тип | Redesign-landing? | Ссылки из отслеживаемого | Секреты | Рекомендация |
|------|-----|-------------------|--------------------------|---------|--------------|
| `design-system/lefiro/MASTER.md` | Дизайн-токены, палитра, типография | Да | Нет | Нет | Коммитить (с landing-v2) |
| `eslint.undef-check.mjs` (корень) | Дубликат `scripts/eslint.undef-check.mjs` | Нет | Нет | Нет | Удалить |
| `public/showcase/` (8 PNG, ~6.4 МБ) | Витринные изображения лендинга | Да | Да — `landing-v2/data.ts` | Нет | Коммитить (с landing-v2) |
| `scripts/acceptance-language-fix.mjs` | Acceptance-тест: SEO language fix (коммит 12f66b5) | Нет | Нет | Нет | Коммитить |
| `scripts/check-vault.mjs` | Одноразовый зонд: vault/pgcrypto в Supabase | Нет | Нет | Нет¹ | Удалить |
| `scripts/eslint.undef-check.mjs` | ESLint flat-config для no-undef | Нет | Нет | Нет | Коммитить (открытая задача в TASKS) |
| `scripts/fal-nb2-edit-probe.mjs` | Зонд биллинга fal nano-banana-2/edit | Нет | Нет | Нет | Коммитить (повторяемый) |
| `scripts/fal-seed-probe.mjs` | Зонд seed у nano-banana-2 | Нет | Нет | Нет | Удалить — ❌ seed не работает, зафиксировано в TASKS |
| `scripts/ss-ref-probe.mjs` | Зонд референса у Secret Slider | Нет | Нет | Нет | Удалить — ❌ референс игнорируется, зафиксировано в CONTEXT |
| `scripts/test-byok-live.mjs` | Live acceptance: BYOK gate | Нет | Нет | Нет | Коммитить |
| `scripts/test-inject-characters.mjs` | Unit-тест `imgInjectCharacterProfiles` | Нет | Нет | Нет | Коммитить (есть открытая задача) |
| `scripts/test-keywords-real-miss.mjs` | Live acceptance: keywords/route.ts | Нет | Нет | Нет | Коммитить |
| `scripts/test-quota-balance.mjs` | Live acceptance: quota-403 в двух роутах | Нет | Нет | Нет | Коммитить |
| `scripts/test-titles-niche.mjs` | Live тест niche/titles с реальными API | Нет | Нет | Нет | Коммитить |
| `src/app/preview-landing/page.tsx` | Preview-маршрут `/preview-landing` для LandingV2 | Да | Нет (из untracked) | Нет | Коммитить (с landing-v2) |
| `src/components/dev/ThemePreview.tsx` | TEMPORARY: переключатель тем A/B/C | Да | Нет | Нет | Держать → удалить после выбора темы |
| `src/components/landing-v2/` (18 файлов) | Полный редизайн лендинга Lefiro | Да | Нет (preview-only) | Нет | Коммитить на redesign-landing |
| `src/lib/i18n-v2.ts` | i18n с префиксом `v2.*` для landing-v2 | Да | Нет (из untracked) | Нет | Коммитить (с landing-v2) |
| `video-server/test-prompt-truncation.js` | Synthetic unit-тест промпт-трюнкации | Нет | Нет | Нет | Коммитить |

¹ `check-vault.mjs` читает `SUPABASE_SERVICE_ROLE_KEY` из `.env.local` в runtime — секрет не хардкодирован, но присутствует как runtime-зависимость.

---

### Модифицированные отслеживаемые файлы (M, не ??)

| Путь | Изменение | Связь |
|------|-----------|-------|
| `package.json` + `package-lock.json` | +`gsap ^3.15.0` | Анимации landing-v2 |
| `src/app/globals.css` | ~185 строк: новая токен-система + временные `.theme-a/.theme-b/.theme-c` | redesign-landing + ThemePreview |

---

### Ключевые находки

1. **Ветка `redesign-landing` есть локально, в origin НЕ запушена** — весь лендинг под риском потери.

2. **Все файлы с секретами чисты** — ни в одном из 19 untracked файлов нет хардкодированных ключей, токенов или персональных данных.

3. **Showcase-изображения привязаны к коду** — `landing-v2/data.ts` ссылается на 8 конкретных `gen_162xxxx.png` по имени; без них `/preview-landing` не откроется.

4. **Три зонда выполнили задачу, результат записан, файлы больше не нужны:** `fal-seed-probe.mjs` (❌ seed не работает), `ss-ref-probe.mjs` (❌ референс игнорируется), `check-vault.mjs` (одноразовый).

5. **`eslint.undef-check.mjs` в корне** — дубликат `scripts/eslint.undef-check.mjs`, создан вероятно при разведке. Удалить корневой.

---

## Что не получилось

Прочерк — задача была диагностической, всё выполнено.

---

## Изменения в файлах состояния

TASKS:    добавлено в «`control_job.tmp` и `scripts/*.mjs`» — полный инвентарь и решение по каждому пути (✅ разведка завершена); добавлен пункт «Landing v2 (редизайн)» в раздел ЛЕНДИНГ И ДЕМО
CONTEXT:  без изменений (новых технических фактов о системе не выявлено)
WORKFLOW: добавлены три кандидата: (1) зонды vs тесты — разный жизненный цикл; (2) крупная работа на локальной ветке без пуша — риск потери; третий («коммит без пуша — работа не сделана») был добавлен ранее.

---

## Открытые вопросы владельцу

1. **Что делать с ветками `redesign-landing` и `feat/1080p-video`?** Обе существуют только локально. Рекомендация: запустить на `redesign-landing` всю landing-v2 работу (переключиться, git add, commit, push origin redesign-landing) — это страховка от потери.

2. **Коммитить ли landing-v2 на `main` или отдельным PR из `redesign-landing`?** Редизайн ещё не готов к замене существующего лендинга (preview-маршрут `/preview-landing` изолирован, основной `/` не тронут). Рекомендую PR: сначала нажать «выбрать тему», затем merge.

3. **Удалять ли зонды (`check-vault.mjs`, `fal-seed-probe.mjs`, `ss-ref-probe.mjs`) или добавить в `.gitignore`?** Рекомендую удалить — результаты уже в TASKS/CONTEXT, файлы больше не запускаются.

4. **Что делать с `src/components/dev/ThemePreview.tsx` и `.theme-a/.theme-b/.theme-c` в globals.css?** Нужно выбрать тему (A — янтарный, B — ?, C — ?, текущий — фиолетовый), после чего удалить временный блок CSS и компонент.
