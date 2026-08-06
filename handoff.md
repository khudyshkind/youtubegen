# Отчёт: 2026-08-06

## Что сделано

Прибраны неотслеживаемые файлы на main по итогам разведки.

**Удалено** (одноразовые зонды, результаты зафиксированы в TASKS/CONTEXT):
- `scripts/check-vault.mjs` — зонд vault/pgcrypto в Supabase
- `scripts/fal-seed-probe.mjs` — зонд seed у nano-banana-2 (❌ не работает)
- `scripts/ss-ref-probe.mjs` — зонд референса у Secret Slider (❌ игнорируется)
- `eslint.undef-check.mjs` (корень) — дубликат `scripts/eslint.undef-check.mjs`

**Закоммичено** (`341ac3b`) — повторяемые тесты и инструменты:
- `scripts/acceptance-language-fix.mjs` — acceptance SEO language fix
- `scripts/eslint.undef-check.mjs` — ESLint flat-config для no-undef (связан с открытой задачей)
- `scripts/fal-nb2-edit-probe.mjs` — зонд биллинга fal nano-banana-2/edit
- `scripts/test-byok-live.mjs` — live acceptance BYOK gate
- `scripts/test-inject-characters.mjs` — unit-тест imgInjectCharacterProfiles
- `scripts/test-keywords-real-miss.mjs` — live acceptance keywords/route.ts
- `scripts/test-quota-balance.mjs` — live acceptance quota-403
- `scripts/test-titles-niche.mjs` — live тест niche/titles
- `video-server/test-prompt-truncation.js` — synthetic unit-тест промпт-трюнкации

**Запушено** в origin/main (`341ac3b`).

**Ранее в этой сессии** (до этого коммита):
- `redesign-landing` закоммичена и запушена (`2428254`): 35 файлов landing-v2
- `feat/1080p-video` настроена на tracking origin/feat/1080p-video

---

## Что не получилось

Прочерк.

---

## Изменения в файлах состояния

TASKS:    задача «`control_job.tmp` и `scripts/*.mjs` в untracked» закрыта — добавлены хеши коммитов, старый список решений заменён итогом
CONTEXT:  без изменений
WORKFLOW: без изменений (кандидаты добавлены в предыдущей сессии)

---

## Открытые вопросы владельцу

1. `scripts/fal-nb2-edit-probe.mjs` закоммичен как «повторяемый инструмент» — если фактически одноразовый, удалить в следующей итерации.
2. Удалённые зонды (`check-vault`, `fal-seed-probe`, `ss-ref-probe`) воссоздаются из описания в CONTEXT/TASKS. Если нужно восстановить — скажите.
