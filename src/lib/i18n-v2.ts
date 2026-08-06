// Landing v2 translations — separate file, НЕ изменяет src/lib/i18n.ts.
// Ключи с префиксом v2.*; механизм аналогичен i18n.ts (useLangStore для lang).
import type { Lang } from '@/lib/i18n'

const v2translations: Record<Lang, Record<string, string>> = {
  ru: {
    // ── Hero ──────────────────────────────────────────────────────────────
    'v2.hero_eyebrow':      'Аналитика · Производство · Инструменты',
    'v2.hero_h1_a':         'Узнайте, что снимать —',
    'v2.hero_h1_b':         'и получите готовое видео.',
    'v2.hero_sub':          'Lefiro находит темы для вашей аудитории и производит полноценное видео: сценарий, озвучка, иллюстрации, сборка. Аналитика и производство в одном месте.',
    'v2.calc_placeholder':  'Вставьте текст сценария или любой фрагмент — чем длиннее, тем точнее...',
    'v2.calc_duration':     'мин.',
    'v2.calc_images_label': 'иллюстраций',
    'v2.calc_credits_label':'кредитов',
    'v2.calc_cta':          'Попробовать бесплатно →',
    'v2.calc_hint':         '10 000 кредитов при регистрации · без карты',
    'v2.calc_note':         'Расчёт: Vision Fast + сценарий + SEO',
    'v2.calc_empty':        'Введите текст, чтобы увидеть расчёт',

    // ── Stats bar ─────────────────────────────────────────────────────────
    'v2.stats_steps':       'шагов пайплайна',
    'v2.stats_langs':       'языков озвучки',
    'v2.stats_voices':      'голосов',

    // ── Three-track section labels ────────────────────────────────────────
    'v2.analytics_tag':       'Аналитика',
    'v2.analytics_title':     'Что снимать — ИИ подскажет',
    'v2.analytics_sub':            'Видеосервис со встроенной YouTube-аналитикой. Метрики каналов, видео и поисковых запросов приходят напрямую из YouTube API. Прогноз дохода — расчётная оценка. Помогает найти нишу и тему до начала производства.',
    'v2.analytics_revenue_note':   'Расчётная оценка — не данные YouTube',
    'v2.analytics_group_of':       'инструмента',

    'v2.studio_tag':          'Студия',
    'v2.studio_title':        'Полный цикл — от темы до готового MP4',
    'v2.studio_sub':          'от темы до готового MP4. Каждый шаг можно пропустить или заменить.',

    'v2.tools_tag':           'Инструменты',
    'v2.tools_title':         'Отдельные задачи — быстро',
    'v2.tools_sub':           'для конкретных задач без создания видео целиком.',

    // ── Timeline bar labels ───────────────────────────────────────────────
    'v2.tl_analytics':        'Аналитика',
    'v2.tl_studio':           'Студия',
    'v2.tl_tools':            'Инструменты',

    // ── Process scene ─────────────────────────────────────────────────────
    'v2.process_tag':        'Процесс',
    'v2.process_title':      'От слова к видео',
    'v2.process_line1':      'Представьте: вы публикуете видео каждый день,',
    'v2.process_line2':      'без монтажёра и копирайтера.',
    'v2.process_line3':      'Вы вводите тему — ИИ пишет сценарий за 30 с.',
    'v2.process_line4':      'Голос выбирается из 101 варианта на 28 языках.',
    'v2.process_line5':      'Субтитры расставляются автоматически по аудио.',
    'v2.process_line6':      'Иллюстрации генерируются под каждую сцену.',
    'v2.process_line7':      'Финальный ролик в Full HD — одним нажатием.',
    'v2.process_line8':      'Готово — от темы до финального ролика.',

    // ── Showcase reel ─────────────────────────────────────────────────────
    'v2.reel_tag':           'Работы',
    'v2.reel_title':         'Реальные кадры из сервиса',
    'v2.reel_ai_generated':  'AI-генерация',

    // ── Bento / Works ─────────────────────────────────────────────────────
    'v2.works_tag':          'Платформа',
    'v2.works_title':        'Всё нужное — в одной студии',
    'v2.works_item1_name':   'Студия',
    'v2.works_item1_desc':   '8 шагов от темы до MP4',
    'v2.works_item2_name':   'Озвучка',
    'v2.works_item2_desc':   '101 голос · 28 языков',
    'v2.works_item3_name':   'SEO-пакет',
    'v2.works_item3_desc':   'Заголовок + теги',
    'v2.works_item4_name':   'Субтитры',
    'v2.works_item4_desc':   'Auto-тайм-коды',
    'v2.works_item5_name':   'AI-иллюстрации',
    'v2.works_item5_desc':   '16:9 на каждую сцену',

    // ── Pipeline ──────────────────────────────────────────────────────────
    'v2.pipe_tag':          'Пайплайн',
    'v2.pipe_title':        'Восемь шагов — одна кнопка',
    'v2.pipe_sub':          'Каждый шаг можно пропустить или заменить своим материалом.',
    'v2.pipe_desc1':        'Введите тему, стиль, длительность и аудиторию',
    'v2.pipe_desc2':        'ИИ строит структуру — вы редактируете до генерации',
    'v2.pipe_desc3':        'Профессиональный сценарий за 10–30 секунд',
    'v2.pipe_desc4':        'Синтез речи из 101 голоса на 28 языках',
    'v2.pipe_desc5':        'Точные тайм-коды субтитров по аудио',
    'v2.pipe_desc6':        'Уникальные иллюстрации 16:9 для каждой сцены',
    'v2.pipe_desc7':        'Автоматическая сборка Full HD MP4',
    'v2.pipe_desc8':        'Заголовок, описание и теги для YouTube',

    // ── Pricing ───────────────────────────────────────────────────────────
    'v2.pricing_tag':         'Тарифы',
    'v2.pricing_title':       'Прозрачные цены',
    'v2.pricing_sub':         'Начните бесплатно — 10 000 кредитов без карты',
    'v2.pricing_free_name':   'Бесплатный',
    'v2.pricing_free_price':  'Бесплатно',
    'v2.pricing_mo':          '/мес',
    'v2.pricing_credits_mo':  'кредитов в месяц',
    'v2.pricing_credits_once':'кредитов при регистрации',
    'v2.pricing_popular':     'Популярный',
    'v2.pricing_cta_free':    'Начать бесплатно',
    'v2.pricing_cta_paid':    'Выбрать',

    // ── FAQ ───────────────────────────────────────────────────────────────
    'v2.faq_tag':   'FAQ',
    'v2.faq_title': 'Часто спрашивают',
    'v2.faq_q1':    'Что такое кредиты?',
    'v2.faq_a1':    'Кредиты — внутренняя валюта сервиса. Типичное 3-минутное видео стоит 5 000–7 000 кредитов. При регистрации вы получаете 10 000 бесплатно — сразу, без карты.',
    'v2.faq_q2':    'Можно загрузить свой сценарий?',
    'v2.faq_a2':    'Да. На каждом шаге можно загрузить свой файл вместо генерации: сценарий (.txt), озвучку (.mp3), субтитры (.srt) или иллюстрации (.jpg/.png).',
    'v2.faq_q3':    'Нужен ли мощный компьютер?',
    'v2.faq_a3':    'Нет. Всё обрабатывается в облаке — достаточно любого браузера на Windows, Mac, Android или iOS. Рендеринг идёт на наших серверах.',
    'v2.faq_q4':    'Можно ли отменить подписку?',
    'v2.faq_a4':    'Да, в любой момент без штрафов. Доступ сохраняется до конца периода. Докупленные кредитные пакеты бессрочны и не привязаны к подписке.',

    // ── CTA ───────────────────────────────────────────────────────────────
    'v2.cta_tag':    'Начать',
    'v2.cta_title':  'Готовы запустить канал?',
    'v2.cta_sub':    '10 000 кредитов при регистрации. Карта не нужна.',
    'v2.cta_btn':    'Создать первое видео →',
    'v2.cta_badge1': '10 000 кредитов при регистрации',
    'v2.cta_badge2': 'Без карты',
    'v2.cta_badge3': 'Отмена в любой момент',
  },
  en: {
    // ── Hero ──────────────────────────────────────────────────────────────
    'v2.hero_eyebrow':      'Analytics · Production · Tools',
    'v2.hero_h1_a':         'Find what to film —',
    'v2.hero_h1_b':         'and get the finished video.',
    'v2.hero_sub':          'Lefiro finds topics your audience wants, then produces a full video: script, voiceover, illustrations, and assembly. Analytics and production, in one place.',
    'v2.calc_placeholder':  'Paste your script or any text snippet — longer gives a better estimate...',
    'v2.calc_duration':     'min',
    'v2.calc_images_label': 'illustrations',
    'v2.calc_credits_label':'credits',
    'v2.calc_cta':          'Start free →',
    'v2.calc_hint':         '10,000 credits on signup · no card needed',
    'v2.calc_note':         'Estimate: Vision Fast + script + SEO',
    'v2.calc_empty':        'Enter text to see the estimate',

    // ── Stats bar ─────────────────────────────────────────────────────────
    'v2.stats_steps':       'pipeline steps',
    'v2.stats_langs':       'voice languages',
    'v2.stats_voices':      'voices',

    // ── Three-track section labels ────────────────────────────────────────
    'v2.analytics_tag':       'Analytics',
    'v2.analytics_title':     'AI tells you what to film',
    'v2.analytics_sub':            'A video service with built-in YouTube analytics. Channel, video and search metrics come straight from the YouTube API. Revenue forecast is an estimate. Find your niche and topic before production starts.',
    'v2.analytics_revenue_note':   'Estimated value — not from YouTube',
    'v2.analytics_group_of':       'tools',

    'v2.studio_tag':          'Studio',
    'v2.studio_title':        'Full cycle — from topic to finished MP4',
    'v2.studio_sub':          'from topic to finished MP4. Each step can be skipped or replaced.',

    'v2.tools_tag':           'Tools',
    'v2.tools_title':         'Individual tasks — fast',
    'v2.tools_sub':           'for specific tasks without producing a full video.',

    // ── Timeline bar labels ───────────────────────────────────────────────
    'v2.tl_analytics':        'Analytics',
    'v2.tl_studio':           'Studio',
    'v2.tl_tools':            'Tools',

    // ── Process scene ─────────────────────────────────────────────────────
    'v2.process_tag':        'Process',
    'v2.process_title':      'From words to video',
    'v2.process_line1':      'Imagine: you publish a video every single day,',
    'v2.process_line2':      'without an editor or copywriter.',
    'v2.process_line3':      'You type a topic — AI writes the script in 30 s.',
    'v2.process_line4':      'Voice chosen from 101 options across 28 languages.',
    'v2.process_line5':      'Subtitles placed automatically from audio.',
    'v2.process_line6':      'Illustrations generated for every scene.',
    'v2.process_line7':      'Full HD video assembled in one click.',
    'v2.process_line8':      'Done — from topic to finished video.',

    // ── Showcase reel ─────────────────────────────────────────────────────
    'v2.reel_tag':           'Showcase',
    'v2.reel_title':         'Real frames from the service',
    'v2.reel_ai_generated':  'AI Generated',

    // ── Bento / Works ─────────────────────────────────────────────────────
    'v2.works_tag':          'Platform',
    'v2.works_title':        'Everything you need — in one studio',
    'v2.works_item1_name':   'Studio',
    'v2.works_item1_desc':   '8 steps from topic to MP4',
    'v2.works_item2_name':   'Voice',
    'v2.works_item2_desc':   '101 voices · 28 languages',
    'v2.works_item3_name':   'SEO package',
    'v2.works_item3_desc':   'Title + tags',
    'v2.works_item4_name':   'Subtitles',
    'v2.works_item4_desc':   'Auto-timecodes',
    'v2.works_item5_name':   'AI images',
    'v2.works_item5_desc':   '16:9 per scene',

    // ── Pipeline ──────────────────────────────────────────────────────────
    'v2.pipe_tag':          'Pipeline',
    'v2.pipe_title':        'Eight steps — one button',
    'v2.pipe_sub':          'Every step can be skipped or replaced with your own material.',
    'v2.pipe_desc1':        'Enter topic, style, duration and audience',
    'v2.pipe_desc2':        'AI builds structure — you edit before generation',
    'v2.pipe_desc3':        'Professional script in 10–30 seconds',
    'v2.pipe_desc4':        'Speech synthesis from 101 voices in 28 languages',
    'v2.pipe_desc5':        'Precise subtitle timecodes from audio',
    'v2.pipe_desc6':        'Unique 16:9 illustrations for every scene',
    'v2.pipe_desc7':        'Automatic Full HD MP4 assembly',
    'v2.pipe_desc8':        'Title, description and tags for YouTube',

    // ── Pricing ───────────────────────────────────────────────────────────
    'v2.pricing_tag':         'Pricing',
    'v2.pricing_title':       'Transparent pricing',
    'v2.pricing_sub':         'Start free — 10,000 credits, no card required',
    'v2.pricing_free_name':   'Free',
    'v2.pricing_free_price':  'Free',
    'v2.pricing_mo':          '/mo',
    'v2.pricing_credits_mo':  'credits / month',
    'v2.pricing_credits_once':'credits on signup',
    'v2.pricing_popular':     'Popular',
    'v2.pricing_cta_free':    'Start for free',
    'v2.pricing_cta_paid':    'Choose plan',

    // ── FAQ ───────────────────────────────────────────────────────────────
    'v2.faq_tag':   'FAQ',
    'v2.faq_title': 'Frequently asked',
    'v2.faq_q1':    'What are credits?',
    'v2.faq_a1':    'Credits are the internal currency. A typical 3-minute video costs 5,000–7,000 credits. You get 10,000 free on signup — instantly, no card needed.',
    'v2.faq_q2':    'Can I upload my own script?',
    'v2.faq_a2':    'Yes. Each step accepts your own file instead of AI generation: script (.txt), voice (.mp3), subtitles (.srt), or images (.jpg/.png).',
    'v2.faq_q3':    'Do I need a powerful computer?',
    'v2.faq_a3':    'No. Everything runs in the cloud — any browser works on Windows, Mac, Android or iOS. Video rendering happens on our servers.',
    'v2.faq_q4':    'Can I cancel anytime?',
    'v2.faq_a4':    'Yes, anytime without penalties. Access continues until end of period. Purchased credit packs never expire and are independent of your subscription.',

    // ── CTA ───────────────────────────────────────────────────────────────
    'v2.cta_tag':    'Get started',
    'v2.cta_title':  'Ready to launch your channel?',
    'v2.cta_sub':    '10,000 credits on signup. No credit card needed.',
    'v2.cta_btn':    'Create first video →',
    'v2.cta_badge1': '10,000 credits on signup',
    'v2.cta_badge2': 'No card needed',
    'v2.cta_badge3': 'Cancel anytime',
  },
}

export function tv2(key: string, lang: Lang): string {
  const dict = v2translations[lang]
  const fallback = v2translations['ru']
  return dict[key] ?? fallback[key] ?? key
}
