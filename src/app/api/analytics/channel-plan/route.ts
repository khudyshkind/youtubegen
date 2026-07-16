import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'
import { resolveUserLang, langNote } from '@/lib/user-lang'
import { verifyHandle, resolveChannelId, fetchRecentVideoTitles } from '@/lib/youtube-channel'
import { parseClaudeJson } from '@/lib/parse-claude-json'
import { YouTubeQuotaError, checkYouTubeQuota, quotaExceededResponse, byokQuotaResponse, isYouTubeKeyError, youTubeKeyErrorResponse } from '@/lib/youtube-quota'
import { isBillingError, notifyBillingError } from '@/lib/telegram'
import { resolveAnalyticsContext } from '@/lib/analytics-gate'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

async function ytFetch(path: string, params: Record<string, string>, apiKey: string): Promise<unknown> {
  const qs = new URLSearchParams({ ...params, key: apiKey }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  const text = await res.text()
  if (!res.ok) {
    checkYouTubeQuota(res.status, text)
    throw new Error(`YouTube API ${res.status}: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text)
}


function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

type VideoFormat = 'long' | 'shorts' | 'mixed'

function fmtDescription(lang: string, fmt: VideoFormat): string {
  if (lang !== 'en') {
    if (fmt === 'long') return 'Длинные видео (8+ мин)'
    if (fmt === 'shorts') return 'Shorts (до 60 сек)'
    return 'Смесь: ~70% длинные (8+ мин), ~30% Shorts'
  } else {
    if (fmt === 'long') return 'Long-form videos (8+ min)'
    if (fmt === 'shorts') return 'Shorts (under 60 sec)'
    return 'Mix: ~70% long-form (8+ min), ~30% Shorts'
  }
}

function fmtFormatRule(lang: string, fmt: VideoFormat): string {
  if (lang !== 'en') {
    if (fmt === 'long') return 'ВСЕ video_ideas должны иметь format: "Длинное" (8+ мин).'
    if (fmt === 'shorts') return 'ВСЕ video_ideas должны иметь format: "Shorts" (до 60 сек).'
    return 'video_ideas: примерно 14 штук format "Длинное" и 6 штук format "Shorts".'
  } else {
    if (fmt === 'long') return 'ALL video_ideas must have format: "Long" (8+ min).'
    if (fmt === 'shorts') return 'ALL video_ideas must have format: "Shorts" (under 60 sec).'
    return 'video_ideas: approximately 14 with format "Long" and 6 with format "Shorts".'
  }
}

function getIdeasPrompt(lang: string, videoFormat: VideoFormat, continuationEnabled: boolean): string {
  const isRu = lang !== 'en'
  const formatRule = fmtFormatRule(lang, videoFormat)
  const continuationSchema = continuationEnabled
    ? (isRu
      ? `,"continuation_ideas":[{"title":"Название видео","format":"Длинное","inspired_by":"Название видео пользователя из его канала"},{"title":"...","format":"...","inspired_by":"..."},{"title":"...","format":"...","inspired_by":"..."},{"title":"...","format":"...","inspired_by":"..."},{"title":"...","format":"...","inspired_by":"..."}]`
      : `,"continuation_ideas":[{"title":"Video title","format":"Long","inspired_by":"Title of user's existing video"},{"title":"...","format":"...","inspired_by":"..."},{"title":"...","format":"...","inspired_by":"..."},{"title":"...","format":"...","inspired_by":"..."},{"title":"...","format":"...","inspired_by":"..."}]`)
    : ''
  const continuationInstruction = continuationEnabled
    ? (isRu
      ? '\ncontinuation_ideas: 5 идей видео как продолжение тем из видео канала пользователя — в inspired_by укажи конкретное название его видео.'
      : '\ncontinuation_ideas: 5 video ideas as follow-ups to the user\'s existing videos — in inspired_by name the specific video that inspired it.')
    : ''

  return isRu
    ? `Ты стратег по YouTube контенту с 10-летним опытом запуска успешных каналов.

Тебе дадут нишу, рынок и данные о топ видео за последний месяц.
Составь детальный план запуска: название канала, позиционирование, идеи для видео, формулы заголовков.

ВАЖНО: Идеи видео должны быть конкретными и готовыми к съёмке — не абстрактными темами.
Учитывай что реально набирает просмотры в данной нише на основе YouTube данных.
${formatRule}

ФОРМАТ — строго JSON без markdown:
{"channel_name_ideas":["Название 1","Название 2","Название 3"],"positioning":"Уникальное позиционирование: чем этот канал отличается от конкурентов — 2-3 предложения","video_ideas":[{"title":"Готовое название видео","format":"Shorts/Длинное/Серия","why_works":"Почему сработает — 1 предложение","best_time":"Вторник 18:00","priority":"Высокий потенциал"},{"title":"...","format":"...","why_works":"...","best_time":"...","priority":"Средний потенциал"},{"title":"...","format":"...","why_works":"...","best_time":"...","priority":"Нишевый потенциал"}],"title_formulas":[{"formula":"Как [действие] за [срок] без [препятствие]","example":"Как закрыть сделку за 5 минут без давления на клиента"},{"formula":"...","example":"..."}],"content_pillars":["Столп 1","Столп 2","Столп 3"],"reference_channels":[{"name":"Название реального канала на YouTube","handle":"@channelhandle","why_follow":"Одно предложение — чему стоит у него поучиться"},{"name":"...","handle":"...","why_follow":"..."},{"name":"...","handle":"...","why_follow":"..."}],"common_mistakes":["Типичная ошибка 1","Типичная ошибка 2","Типичная ошибка 3","Типичная ошибка 4","Типичная ошибка 5"]${continuationSchema}}

priority: оценивай на основе YouTube-данных — "Высокий потенциал" (много похожих видео с высокими просмотрами), "Средний потенциал" (1-3 похожих видео), "Нишевый потенциал" (мало данных, узкая аудитория).
common_mistakes: 5 конкретных типичных ошибок новичков именно в этой нише.
reference_channels: 3 реальных YouTube канала в этой нише. handle — укажи реальный YouTube-хэндл (@channelname) если знаешь точно, иначе оставь пустой строкой ''.${continuationInstruction}
Верни РОВНО 20 video_ideas и РОВНО 5 title_formulas.
КРИТИЧНО: внутри строковых значений JSON НЕ используй символ двойной кавычки (") — используй апостроф (') или перефразируй. Не допускай переносов строк внутри значений.
Только JSON. Начни с { заканчивай с }.`
    : `You are a YouTube content strategist with 10 years of experience launching successful channels.

You will be given a niche, target market, and data about top videos from the last month.
Create a detailed launch plan: channel name ideas, positioning, video ideas, title formulas.

IMPORTANT: Video ideas must be specific and ready to film — not abstract topics.
Take into account what actually gets views in this niche based on the YouTube data.
${formatRule}

FORMAT — strict JSON without markdown:
{"channel_name_ideas":["Name 1","Name 2","Name 3"],"positioning":"Unique positioning: what makes this channel different from competitors — 2-3 sentences","video_ideas":[{"title":"Ready-to-film video title","format":"Shorts/Long/Series","why_works":"Why it will work — 1 sentence","best_time":"Tuesday 6PM","priority":"High Potential"},{"title":"...","format":"...","why_works":"...","best_time":"...","priority":"Medium Potential"},{"title":"...","format":"...","why_works":"...","best_time":"...","priority":"Niche Potential"}],"title_formulas":[{"formula":"How to [action] in [time] without [obstacle]","example":"How to close a deal in 5 minutes without pressuring the client"},{"formula":"...","example":"..."}],"content_pillars":["Pillar 1","Pillar 2","Pillar 3"],"reference_channels":[{"name":"Real YouTube channel name","handle":"@channelhandle","why_follow":"One sentence — what to learn from this channel"},{"name":"...","handle":"...","why_follow":"..."},{"name":"...","handle":"...","why_follow":"..."}],"common_mistakes":["Beginner mistake 1","Beginner mistake 2","Beginner mistake 3","Beginner mistake 4","Beginner mistake 5"]${continuationSchema}}

priority: assess based on YouTube data — "High Potential" (many similar videos with high views), "Medium Potential" (1-3 similar videos), "Niche Potential" (few data points, narrow audience).
common_mistakes: 5 specific beginner mistakes in this exact niche.
reference_channels: 3 real YouTube channels in this niche. handle — include real YouTube handle (@channelname) if you know it exactly, otherwise use empty string ''.${continuationInstruction}
Return EXACTLY 20 video_ideas and EXACTLY 5 title_formulas.
CRITICAL: Do NOT use double-quote characters (") inside string values — use apostrophes (') or rephrase. No literal newlines inside values.
JSON only. Start with { end with }.`
}

function getMonthsPlanPrompt(lang: string, videoFormat: VideoFormat, publishFreq: number): string {
  const isRu = lang !== 'en'
  const freqNote = isRu
    ? `Частота публикаций: ${publishFreq} видео/нед (≈${publishFreq * 4} видео/мес). Цели месяцев формулируй с учётом этой частоты. 4 видео в плане — примеры, не полный список.`
    : `Publishing frequency: ${publishFreq} video(s)/week (≈${publishFreq * 4}/month). Frame monthly goals around this frequency. The 4 videos listed per month are examples, not the full schedule.`
  const fmtNote = isRu
    ? `Формат видео: ${fmtDescription('ru', videoFormat)}.`
    : `Video format: ${fmtDescription('en', videoFormat)}.`
  return isRu
    ? `Ты стратег по YouTube контенту. Составь контент-план на 3 месяца (по неделям).

${freqNote}
${fmtNote}
Цели формулируй как ориентировочные — при упоминании числовых метрик (подписчики, просмотры) всегда добавляй «ориентировочно» или «при регулярных публикациях».

ФОРМАТ — строго JSON без markdown:
{"month_1":{"goal":"Цель первого месяца","videos":[{"week":1,"title":"Название видео","format":"Shorts/Длинное","day":"Вторник"},{"week":2,"title":"...","format":"...","day":"..."},{"week":3,"title":"...","format":"...","day":"..."},{"week":4,"title":"...","format":"...","day":"..."}],"actions":["Действие 1","Действие 2","Действие 3"]},"month_2":{"goal":"...","videos":[{"week":5,"title":"...","format":"...","day":"..."},{"week":6,"title":"...","format":"...","day":"..."},{"week":7,"title":"...","format":"...","day":"..."},{"week":8,"title":"...","format":"...","day":"..."}],"actions":["...","...","..."]},"month_3":{"goal":"...","videos":[{"week":9,"title":"...","format":"...","day":"..."},{"week":10,"title":"...","format":"...","day":"..."},{"week":11,"title":"...","format":"...","day":"..."},{"week":12,"title":"...","format":"...","day":"..."}],"actions":["...","...","..."]}}

Только JSON. Начни с { заканчивай с }.`
    : `You are a YouTube content strategist. Create a 3-month content plan (week by week).

${freqNote}
${fmtNote}
Frame goals as estimates — when mentioning numeric targets (subscribers, views) always add qualifiers like "approximately" or "with consistent publishing".

FORMAT — strict JSON without markdown:
{"month_1":{"goal":"Month one goal","videos":[{"week":1,"title":"Video title","format":"Shorts/Long","day":"Tuesday"},{"week":2,"title":"...","format":"...","day":"..."},{"week":3,"title":"...","format":"...","day":"..."},{"week":4,"title":"...","format":"...","day":"..."}],"actions":["Action 1","Action 2","Action 3"]},"month_2":{"goal":"...","videos":[{"week":5,"title":"...","format":"...","day":"..."},{"week":6,"title":"...","format":"...","day":"..."},{"week":7,"title":"...","format":"...","day":"..."},{"week":8,"title":"...","format":"...","day":"..."}],"actions":["...","...","..."]},"month_3":{"goal":"...","videos":[{"week":9,"title":"...","format":"...","day":"..."},{"week":10,"title":"...","format":"...","day":"..."},{"week":11,"title":"...","format":"...","day":"..."},{"week":12,"title":"...","format":"...","day":"..."}],"actions":["...","...","..."]}}

JSON only. Start with { end with }.`
}

function getStylePrompt(lang: string, publishFreq: number): string {
  const isRu = lang !== 'en'
  const freqNote = isRu
    ? `Частота публикаций: ${publishFreq} видео/нед. Путь к монетизации рассчитывай с учётом этой частоты.`
    : `Publishing frequency: ${publishFreq} video(s)/week. Factor this into the monetization timeline.`
  return isRu
    ? `Ты стратег по YouTube контенту. На основе ниши дай стиль обложек, growth hacks, путь к монетизации и SEO ключевые слова.

${freqNote}

ПРАВИЛА:
• thumbnail_style, monetization_path — максимум одно предложение каждый
• growth_hacks — ровно 3 элемента, каждый одним предложением
• seo_keywords.channel_description — 7 ключевых фраз для описания канала
• seo_keywords.video_tags — 10 коротких тегов (1-3 слова)
• seo_keywords.hashtags — 7 хештегов с # в начале
• Только JSON без пояснений

ФОРМАТ — строго JSON:
{"thumbnail_style":"Одно предложение о стиле обложек","growth_hacks":["Лайфхак 1","Лайфхак 2","Лайфхак 3"],"monetization_path":"Одно предложение о пути к монетизации","seo_keywords":{"channel_description":["ключевая фраза 1","ключевая фраза 2","ключевая фраза 3","ключевая фраза 4","ключевая фраза 5","ключевая фраза 6","ключевая фраза 7"],"video_tags":["тег1","тег2","тег3","тег4","тег5","тег6","тег7","тег8","тег9","тег10"],"hashtags":["#хештег1","#хештег2","#хештег3","#хештег4","#хештег5","#хештег6","#хештег7"]}}

Только JSON. Начни с { заканчивай с }.`
    : `You are a YouTube content strategist. Based on the niche, provide thumbnail style, growth hacks, monetization path, and SEO keywords.

${freqNote}

RULES:
• thumbnail_style, monetization_path — max one sentence each
• growth_hacks — exactly 3 items, each one sentence
• seo_keywords.channel_description — 7 key phrases for channel description
• seo_keywords.video_tags — 10 short tags (1-3 words)
• seo_keywords.hashtags — 7 hashtags starting with #
• JSON only, no explanations

FORMAT — strict JSON:
{"thumbnail_style":"One sentence about thumbnail style","growth_hacks":["Hack 1","Hack 2","Hack 3"],"monetization_path":"One sentence about monetization path","seo_keywords":{"channel_description":["key phrase 1","key phrase 2","key phrase 3","key phrase 4","key phrase 5","key phrase 6","key phrase 7"],"video_tags":["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10"],"hashtags":["#hashtag1","#hashtag2","#hashtag3","#hashtag4","#hashtag5","#hashtag6","#hashtag7"]}}

JSON only. Start with { end with }.`
}

interface VideoIdea {
  title: string
  format: string
  why_works: string
  best_time: string
  priority: string
}

interface TitleFormula {
  formula: string
  example: string
}

interface MonthPlan {
  goal: string
  videos: Array<{ week: number; title: string; format: string; day: string }>
  actions: string[]
}

interface IdeasResult {
  channel_name_ideas: string[]
  positioning: string
  video_ideas: VideoIdea[]
  title_formulas: TitleFormula[]
  content_pillars: string[]
  reference_channels: Array<{ name: string; handle?: string; why_follow: string; verified_url?: string | null }>
  common_mistakes?: string[]
  continuation_ideas?: Array<{ title: string; format: string; inspired_by: string }>
}

interface MonthsPlanResult {
  month_1: MonthPlan
  month_2: MonthPlan
  month_3: MonthPlan
}

interface StyleResult {
  thumbnail_style: string
  growth_hacks: string[]
  monetization_path: string
  seo_keywords: { channel_description: string[]; video_tags: string[]; hashtags: string[] }
}

export async function POST(req: NextRequest) {
  let lang = 'ru'
  let userHasKey = false
  let plan = 'free'
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as {
      topic?: string
      country?: string
      content_lang?: string
      ui_lang?: string
      video_format?: VideoFormat
      publish_frequency?: number
      user_channel_url?: string
    }
    const {
      topic = '',
      country = 'RU',
      content_lang = 'ru',
      ui_lang = 'ru',
      video_format = 'mixed',
      publish_frequency = 1,
      user_channel_url = '',
    } = body
    lang = ui_lang

    if (!topic.trim()) return NextResponse.json({ ok: false, error: 'Введите тему канала' }, { status: 400 })

    const svc = createServiceClient()
    const ctx = await resolveAnalyticsContext(user.id, svc, lang)
    const { gateRes, apiKey, fallbackKey, cost } = ctx
    userHasKey = ctx.userHasKey
    plan = ctx.plan
    if (gateRes) return gateRes
    async function ytf(path: string, params: Record<string, string>): Promise<unknown> {
      try { return await ytFetch(path, params, apiKey) }
      catch (e) { if (e instanceof YouTubeQuotaError && fallbackKey) return ytFetch(path, params, fallbackKey); throw e }
    }

    const actualCost = cost(CREDIT_COSTS.channel_plan)
    const check = await requireCreditsAmount(user.id, actualCost, supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    const uiLangFull = resolveUserLang(req, ui_lang)
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: 100_000 })

    // Fetch user's recent video projects for personalized context (Task 1: relevance filter)
    let userProjectsCtx = ''
    try {
      const { data: userProjects } = await supabase
        .from('projects')
        .select('topic')
        .eq('user_id', user.id)
        .not('topic', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5)
      if (userProjects && userProjects.length > 0) {
        const sanitize = (s: string) => s.replace(/["«»„"]/g, '\'').replace(/[\r\n\t]/g, ' ').trim()
        const lines = userProjects.filter(p => p.topic).map(p => `• ${sanitize(p.topic as string)}`).join('\n')
        userProjectsCtx = ui_lang === 'en'
          ? `\n\nVideos this user has already created on this platform:\n${lines}\nOnly reference these if they are relevant to the niche "${topic}" — if unrelated, ignore them completely.`
          : `\n\nВидео, которые этот пользователь уже создавал на платформе:\n${lines}\nСсылайся на них только если они релевантны нише "${topic}" — если не связаны с нишей, игнорируй полностью.`
      }
    } catch (e) {
      console.warn('[channel-plan] user projects fetch:', e instanceof Error ? e.message : String(e))
    }

    // Resolve user's own YouTube channel for continuation ideas (Task 5)
    let userChannelVideos: string[] = []
    let userChannelError: string | null = null
    let userChannelEmpty = false
    if (user_channel_url.trim()) {
      try {
        console.log('[channel-plan] resolving user channel:', user_channel_url.trim())
        const channelId = await resolveChannelId(user_channel_url.trim(), apiKey)
        if (!channelId) {
          userChannelError = ui_lang === 'en'
            ? 'Channel not found. Check the URL or @handle.'
            : 'Канал не найден. Проверьте URL или @хэндл.'
        } else {
          userChannelVideos = await fetchRecentVideoTitles(channelId, apiKey, 15)
          userChannelEmpty = userChannelVideos.length === 0
          console.log(`[channel-plan] user channel resolved, ${userChannelVideos.length} videos`)
        }
      } catch (e) {
        if (e instanceof YouTubeQuotaError) throw e
        userChannelError = e instanceof Error ? e.message : String(e)
        console.warn('[channel-plan] user channel fetch failed:', userChannelError)
      }
    }

    // Build continuation context for claude1
    let userContinuationCtx = ''
    if (userChannelVideos.length > 0) {
      const sanitize = (s: string) => s.replace(/["«»„"]/g, '\'').replace(/[\r\n\t]/g, ' ').trim()
      const titles = userChannelVideos.map(t => `• ${sanitize(t)}`).join('\n')
      userContinuationCtx = ui_lang === 'en'
        ? `\n\nUser's own YouTube channel recent videos (use for continuation_ideas):\n${titles}`
        : `\n\nПоследние видео YouTube-канала пользователя (используй для continuation_ideas):\n${titles}`
    }

    // Fetch YouTube trends data
    console.log(`[channel-plan] fetching YouTube trends for "${topic}" country=${country} lang=${content_lang}`)
    let ytSummary = ''
    try {
      const publishedAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const searchParams: Record<string, string> = {
        part: 'snippet', type: 'video', maxResults: '10', order: 'viewCount', publishedAfter, q: topic,
      }
      if (content_lang && content_lang !== 'auto') searchParams.relevanceLanguage = content_lang
      if (country && country !== 'worldwide') searchParams.regionCode = country

      const search = await ytf('/search', searchParams) as {
        items?: Array<{ id: { videoId?: string }; snippet: { title: string; channelTitle: string } }>
      }
      const ids = (search.items ?? []).map(v => v.id?.videoId).filter(Boolean).join(',')

      if (ids) {
        const stats = await ytf('/videos', { part: 'statistics,snippet', id: ids }) as {
          items?: Array<{
            snippet: { title: string; channelTitle: string; tags?: string[] }
            statistics: { viewCount?: string }
          }>
        }
        ytSummary = (stats.items ?? []).map(v => {
          const views = fmtViews(parseInt(v.statistics.viewCount ?? '0'))
          const title = v.snippet.title.replace(/["«»„"]/g, '\'').replace(/[\r\n\t]/g, ' ')
          return `• ${title} — ${views} views (${v.snippet.channelTitle})`
        }).join('\n')
      }
    } catch (e) {
      if (e instanceof YouTubeQuotaError) throw e
      console.warn('[channel-plan] YouTube fetch failed:', e instanceof Error ? e.message : String(e))
    }

    const userCtx = (ui_lang === 'en'
      ? `Niche: "${topic}"\nMarket: ${country}, content language: ${content_lang}\nVideo format: ${fmtDescription('en', video_format)}\n\nTop videos in this niche (last 30 days):\n${ytSummary || 'No data available'}`
      : `Ниша: "${topic}"\nРынок: ${country}, язык контента: ${content_lang}\nФормат видео: ${fmtDescription('ru', video_format)}\n\nТоп видео в этой нише за последние 30 дней:\n${ytSummary || 'Данные недоступны'}`)
      + userProjectsCtx
      + userContinuationCtx

    console.log('[channel-plan] running Claude 1 + 2a + 2b in parallel')
    const ctxWithLang = userCtx + langNote(uiLangFull)

    const continuationEnabled = userChannelVideos.length > 0

    const [msg1, msg2a, msg2b] = await Promise.all([
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: continuationEnabled ? 7000 : 6000,
        system: [{ type: 'text', text: getIdeasPrompt(ui_lang, video_format, continuationEnabled), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: ctxWithLang }],
      }),
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2500,
        system: [{ type: 'text', text: getMonthsPlanPrompt(ui_lang, video_format, publish_frequency), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: ctxWithLang }],
      }),
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: [{ type: 'text', text: getStylePrompt(ui_lang, publish_frequency), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: ctxWithLang }],
      }),
    ])

    const text1  = (msg1.content[0]  as { text: string }).text
    const text2a = (msg2a.content[0] as { text: string }).text
    const text2b = (msg2b.content[0] as { text: string }).text
    console.log('[channel-plan] claude1  tokens:', msg1.usage.input_tokens, 'out:', msg1.usage.output_tokens, 'stop:', msg1.stop_reason)
    console.log('[channel-plan] claude2a tokens:', msg2a.usage.input_tokens, 'out:', msg2a.usage.output_tokens)
    console.log('[channel-plan] claude2b tokens:', msg2b.usage.input_tokens, 'out:', msg2b.usage.output_tokens)
    if (msg1.stop_reason === 'max_tokens') console.warn('[channel-plan] claude1 truncated by max_tokens')
    if (msg2a.stop_reason === 'max_tokens') console.warn('[channel-plan] claude2a truncated by max_tokens')
    if (msg2b.stop_reason === 'max_tokens') console.warn('[channel-plan] claude2b truncated by max_tokens')

    const ideas      = parseClaudeJson<IdeasResult>(text1,  'claude1')
    const monthsPlan = parseClaudeJson<MonthsPlanResult>(text2a, 'claude2a')
    const style      = parseClaudeJson<StyleResult>(text2b, 'claude2b')

    // Verify reference channel handles (Task 4) — 1 quota unit each, no search fallback
    const refChannels = ideas.reference_channels ?? []
    if (refChannels.length > 0) {
      const verified = await Promise.all(
        refChannels.map(async ch => {
          const rawHandle = ch.handle?.trim() ?? ''
          if (!rawHandle || rawHandle === '@') return { ...ch, verified_url: null }
          const channelId = await verifyHandle(rawHandle, apiKey)
          const handle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`
          return { ...ch, verified_url: channelId ? `https://www.youtube.com/${handle}` : null }
        })
      )
      ideas.reference_channels = verified
    }

    const result = {
      channel_name_ideas: ideas.channel_name_ideas ?? [],
      positioning: ideas.positioning ?? '',
      video_ideas: ideas.video_ideas ?? [],
      title_formulas: ideas.title_formulas ?? [],
      content_pillars: ideas.content_pillars ?? [],
      reference_channels: ideas.reference_channels ?? [],
      common_mistakes: ideas.common_mistakes ?? [],
      continuation_ideas: ideas.continuation_ideas ?? null,
      user_channel_url: user_channel_url.trim() || undefined,
      continuation_empty: userChannelEmpty || undefined,
      continuation_error: userChannelError || undefined,
      month_1: monthsPlan.month_1,
      month_2: monthsPlan.month_2,
      month_3: monthsPlan.month_3,
      thumbnail_style: style.thumbnail_style ?? '',
      growth_hacks: style.growth_hacks ?? [],
      monetization_path: style.monetization_path ?? '',
      seo_keywords: style.seo_keywords ?? { channel_description: [], video_tags: [], hashtags: [] },
    }

    await spendCredits(user.id, actualCost, 'channel_plan')

    console.log('[channel-plan] saving report...')
    try {
      const { data: old } = await svc.from('analytics_reports').select('id')
        .eq('user_id', user.id).eq('report_type', 'channel_plan')
        .order('created_at', { ascending: true })
      if ((old?.length ?? 0) >= 20) {
        await svc.from('analytics_reports').delete().eq('id', old![0].id)
      }
      const { error: saveErr } = await svc.from('analytics_reports').insert({
        user_id: user.id, report_type: 'channel_plan',
        title: `План запуска: ${topic}`,
        query: topic.slice(0, 80),
        result,
      })
      if (saveErr) {
        console.warn('[channel-plan] save error:', JSON.stringify(saveErr))
      } else {
        console.log('[channel-plan] report saved OK')
      }
    } catch (e) {
      console.warn('[channel-plan] save exception:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    if (error instanceof YouTubeQuotaError) return (userHasKey && plan === 'free') ? byokQuotaResponse(lang) : quotaExceededResponse(lang)
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/channel-plan] error:', msg)
    if (isYouTubeKeyError(msg)) return youTubeKeyErrorResponse(lang)
    if (isBillingError(msg)) await notifyBillingError('Anthropic', '/analytics/channel-plan').catch(() => {})
    return NextResponse.json({ ok: false, error: 'Сервис временно недоступен — попробуйте позже' }, { status: 500 })
  }
}
