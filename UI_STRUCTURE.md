# UI Structure — YouTubeGen

Навигационная карта интерфейса. Не хранить в git как документацию — только для локального ориентирования.

---

## 1. Навигация

### Navbar (верхняя полоса, sticky, все страницы кроме /auth/*)

**Гость (не залогинен):**
- Логотип `▶ YouTubeGen` → `/`
- На лендинге: ссылки `#how-it-works`, `#pricing`, `#faq`
- LangSwitcher (RU / EN)
- `Войти` → `/auth/login`
- `Зарегистрироваться` → `/auth/register`

**Авторизованный пользователь:**
- Логотип → `/dashboard`
- Баджик кредитов (мигает красным при списании)
- LangSwitcher (сохраняет в профиль через PATCH /api/profile)
- Кнопка `Создать видео` → `/studio` (сбрасывает стор)
- Аватарка / имя → дропдаун:
  - Баланс кредитов (только отображение)
  - `Дашборд` → `/dashboard`
  - `Оплата` → `/billing`
  - `Выйти` (supabase.auth.signOut)

### SidebarNav (левая панель, только dashboard layout)

**Desktop (w-60, скрыт на мобиле):**
| Иконка | Пункт | Роут |
|--------|-------|------|
| 🏠 | Dashboard | `/dashboard` |
| 🎬 | Создать видео *(выделен градиентом)* | `/studio` |
| 🔧 | Инструменты | `/tools` |
| 📊 | Аналитика | `/analytics` |
| 💳 | Оплата | `/billing` |
| ❓ | Поддержка *(внизу)* | `t.me/youtubegenai_bot?start=support` |

**Mobile (нижняя фиксированная панель):**
Те же 5 пунктов, иконки + первое слово label.

---

## 2. Все страницы (роуты)

### Публичные
| Роут | Файл | Назначение |
|------|------|-----------|
| `/` | `app/page.tsx` | Лендинг (LandingBody): Hero, How it works, Pricing, FAQ, Footer |
| `/auth/login` | `app/auth/login/page.tsx` | Форма входа |
| `/auth/register` | `app/auth/register/page.tsx` | Форма регистрации |

### Дашборд (группа `(dashboard)`, layout с SidebarNav)
| Роут | Файл | Назначение |
|------|------|-----------|
| `/dashboard` | `app/(dashboard)/dashboard/page.tsx` | Главная после входа |
| `/studio` | `app/(dashboard)/studio/page.tsx` | Студия генерации (StepWizard) |
| `/tools` | `app/(dashboard)/tools/page.tsx` | Инструменты (Уникализатор) |
| `/analytics` | `app/(dashboard)/analytics/page.tsx` | Аналитика (11 вкладок) |
| `/billing` | `app/(dashboard)/billing/page.tsx` | Тарифы, топапы, баланс |

**URL-параметры студии:**
- `/studio?project={id}` — открыть существующий проект
- `/studio?from=plan` — из аналитики (сохраняет topic, сбрасывает остальное)
- `/studio?from=tools` — из инструментов (сохраняет script, переходит на шаг 3)

### Админ-панель (`/admin/*`, отдельный layout с собственным sidebar)
| Роут | Назначение |
|------|-----------|
| `/admin` | Метрики: выручка Paddle, топ пользователи, статистика проектов |
| `/admin/users` | Управление пользователями |
| `/admin/referrals` | Реферальная программа |
| `/admin/analytics` | Платформенная аналитика |
| `/admin/services` | Мониторинг сервисов (Railway, Vercel, APIs) |
| `/admin/view` | Просмотр проектов пользователей (для отладки) |

---

## 3. Дашборд `/dashboard`

**Компоненты:** `OnboardingModal` (если `onboarding_completed === false`), `ReferralBlock` (если есть `referral_code`), `DashboardClient`

**Блоки:**
1. **Заголовок** — приветствие "Привет, {имя} 👋" + кнопка "Создать видео"
2. **Три карточки статистики:**
   - *Кредиты* — число кредитов, прогресс-бар (от плана), ссылка "Пополнить" → `/billing`, подпись "План: {free/basic/...}"
   - *Всего проектов* — счётчик
   - *Готовых видео* — счётчик (status = `completed`)
3. **Список последних проектов** (до 20):
   - Миниатюра (thumbnail_url или первый кадр сцены)
   - Название + топик + статус-бадж + дата
   - Клик → `/studio?project={id}`
   - Кнопка удаления

**Статусы проектов:** `draft` | `generating_script` | `generating_audio` | `generating_subtitles` | `generating_images` | `generating_video` | `generating_seo` | `completed` | `failed`

---

## 4. Студия `/studio`

**Компонент:** `StepWizard` → `StepWizardInner`

**8 шагов (компоненты Step*tsx):**

| Шаг | Компонент | Назначение | Стоимость |
|-----|-----------|-----------|-----------|
| 1 | `Step1Topic` | Тема, язык, тональность, длина, аудитория | 0 |
| 2 | `Step2Plan` | Видео-план (структура секций) | 1 кр |
| 3 | `Step2Script` *(файл)* | Генерация сценария | 4–7 кр |
| 4 | `Step3Voice` | Выбор голоса + TTS озвучка | 1–18 кр/1к слов |
| 5 | `Step4Subtitles` | Субтитры через Whisper | 2 кр/мин |
| 6 | `Step5Images` | Иллюстрации (Flux/GPT/Gemini) | 7 кр/изображение |
| 7 | `Step6Video` | Сборка видео (Railway сервер) | 1 кр |
| 8 | `Step7Seo` | SEO-метаданные (заголовок, теги) | 2 кр |

**Логика навигации:**
- `inferStep(project)` автоматически определяет шаг при открытии проекта по наличию данных:
  `seo/video_url` → 8, `scene_images` → 7, `subtitle_blocks` → 6, `audio_url` → 5, `script` → 4, `plan_sections` → 3, иначе → 2
- Шаги хранятся в Zustand store (`useStudioStore`)
- Визард хранит `currentStep`, `projectId`, `scriptParams`, `planSections`, `script`, `voiceId`, `audioUrl` и т.д.

---

## 5. Аналитика `/analytics`

**11 вкладок** (Tab type: `niche` | `niche_finder` | `channel_plan` | `trends` | `channel` | `revenue` | `comments` | `keywords` | `compare` | `rising_stars` | `history`):

| Вкладка | i18n ключ | Компонент | Стоимость |
|---------|-----------|-----------|-----------|
| Анализ ниши | `tab_niche` | `NicheTab` | 3 кр |
| Поиск ниши | `tab_niche_finder` | `NicheFinderTab` | 3 кр |
| План запуска | `tab_channel_plan` | `ChannelPlanTab` | 8 кр |
| Тренды | `tab_trends` | `TrendsTab` | 3 кр |
| Анализ канала | `tab_channel` | `ChannelTab` | 3 кр |
| Доходность | `tab_revenue` | `RevenueTab` | 2 кр |
| Анализ комментариев | `tab_comments` | `CommentsTab` | 3 кр |
| Ключевые слова | `tab_keywords` | `KeywordsTab` | 3 кр |
| Сравнение каналов | `tab_compare` | `CompareTab` | 5 кр |
| Восходящие звёзды | `tab_rising_stars` | `RisingStarsTab` | 5 кр |
| История отчётов | `tab_history` | `HistoryTab` | 0 кр |

**Межвкладочная навигация (переходы с данными):**
- `handleGoToNicheFromFinder(topic)` — поиск ниши → анализ ниши
- `handleGoToKeywordsFromPlan(topic)` — план канала → ключевые слова
- `handleGoToChannelFromPlan(channelUrl)` — план канала → анализ канала
- `handleGoToChannelFromNiche(channelUrl)` — анализ ниши → анализ канала
- `handleGoToPlan(topic)` — поиск ниши → план запуска канала
- `handleGoToChannelFromRisingStars(url)` — восходящие звёзды → анализ канала

**История отчётов:**
- Хранится в таблице `analytics_reports` (до 20 на пользователя)
- Клик по отчёту → переключает на нужную вкладку и заполняет результат
- Поддерживает печать (CSS `@media print`: скрыты nav, .no-print элементы)

**Входные параметры ChannelPlanTab (план запуска):**
- Ниша / тема (текст)
- Страна (select, 24 варианта + Worldwide)
- Язык контента (select, 15 языков)
- Формат видео (Смесь 70/30 | Только длинные | Только Shorts)
- Частота публикаций (1 / 2 / 3 в неделю)
- Свой YouTube канал (optional, для идей продолжения)

---

## 6. Инструменты `/tools`

Единственный инструмент: **Уникализатор сценариев**

**Поля:**
- Textarea: исходный текст (счётчик символов)
- Select: язык вывода (12 языков: ru, en, de, fr, es, it, pt, zh, ja, ko, ar, tr)

**Три режима (кнопки):**
| Режим | Стоимость | Что делает |
|-------|-----------|-----------|
| Уникализация | −1 кр | Рерайт для уникальности |
| Очеловечивание | −1 кр | Делает текст более живым |
| Оба | −2 кр | Оба преобразования вместе |

**После обработки:**
- Textarea с результатом
- Кнопка "Скопировать"
- Кнопка "Использовать в студии" → сохраняет в store.script, переходит на шаг 3 (`/studio?from=tools`)

**API:** `POST /api/generate/uniqueize`

---

## 7. Тарифы и оплата `/billing`

**Блок баланса (вверху):** текущие кредиты крупно + план + таблица стоимостей операций (сценарий, озвучка, субтитры, изображение, видео, SEO)

**Сетка тарифов (5 планов):**
| План | Цена | Кредиты |
|------|------|---------|
| Free | $0 | 20 (разово) |
| Basic | $9/мес | — |
| Starter | $19/мес | 100/мес |
| Pro | $39/мес | 300/мес *(выделен)* |
| Agency | $99/мес | 1000/мес |

**Топапы (разовые пакеты):** кредиты за фиксированную цену (без подписки)

**Оплата:** через Telegram-бот deeplink (`t.me/youtubegenai_bot?start={plan_slug}`)

---

## 8. Расположение ключевых элементов

| Элемент | Где находится |
|---------|--------------|
| **Баланс кредитов** | Navbar (баджик, всегда видно) + Navbar дропдаун + `/dashboard` карточка + `/billing` вверху |
| **Тарифы / пополнение** | `/billing` (SidebarNav → Оплата; Navbar дропдаун → Оплата; Dashboard → ссылка "Пополнить") |
| **История проектов** | `/dashboard` (список последних 20) |
| **Профиль пользователя** | Navbar дропдаун (аватар, имя/email) — отдельной страницы `/profile` нет |
| **Настройки** | Отдельной страницы `/settings` нет. Язык — LangSwitcher в Navbar (сохраняется в профиль) |
| **Поддержка** | SidebarNav низ → Telegram bot |
| **История аналитических отчётов** | `/analytics` → вкладка "История" |
| **Реферальная программа** | `/dashboard` (блок ReferralBlock, если есть реферальный код) |

---

## 9. Служебные URL (не в навигации)

| Путь | Назначение |
|------|-----------|
| `/admin` | Только для `ADMIN_EMAILS`; отдельный layout |
| `/api/generate/*` | Генерация сценария, плана, голоса, SEO, картинок |
| `/api/analytics/*` | Аналитические отчёты (niche, channel, trends и т.д.) |
| `/api/profile` | GET/PATCH профиля (кредиты, язык, аватар) |
| `/api/billing/*` | Paddle webhooks, Telegram deeplink |
