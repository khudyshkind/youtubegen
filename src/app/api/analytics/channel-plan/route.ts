import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'
import { resolveUserLang, langNote } from '@/lib/user-lang'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

async function ytFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const key = env('YOUTUBE_API_KEY')
  const qs = new URLSearchParams({ ...params, key }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  const text = await res.text()
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

function parseClaudeJson<T>(text: string, label: string): T {
  console.log(`[channel-plan] ${label} raw:`, text.substring(0, 600))
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start === -1) throw new Error(`${label}: no { found`)
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '{') depth++
    if (c === '}') { depth--; if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T }
  }
  throw new Error(`${label}: unbalanced braces`)
}

function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

function getIdeasPrompt(lang: string): string {
  const isRu = lang !== 'en'
  return isRu
    ? `Ты стратег по YouTube контенту с 10-летним опытом запуска успешных каналов.

Тебе дадут нишу, рынок и данные о топ видео за последний месяц.
Составь детальный план запуска: название канала, позиционирование, идеи для видео, формулы заголовков.

ВАЖНО: Идеи видео должны быть конкретными и готовыми к съёмке — не абстрактными темами.
Учитывай что реально набирает просмотры в данной нише на основе YouTube данных.

ФОРМАТ — строго JSON без markdown:
{"channel_name_ideas":["Название 1","Название 2","Название 3"],"positioning":"Уникальное позиционирование: чем этот канал отличается от конкурентов — 2-3 предложения","video_ideas":[{"title":"Готовое название видео","format":"Shorts/Длинное/Серия","why_works":"Почему сработает — 1 предложение","best_time":"Вторник 18:00","priority":"Срочно"},{"title":"...","format":"...","why_works":"...","best_time":"...","priority":"Скоро"},{"title":"...","format":"...","why_works":"...","best_time":"...","priority":"Можно подождать"}],"title_formulas":[{"formula":"Как [действие] за [срок] без [препятствие]","example":"Как закрыть сделку за 5 минут без давления на клиента"},{"formula":"...","example":"..."}],"content_pillars":["Столп 1","Столп 2","Столп 3"]}

priority: только "Срочно", "Скоро" или "Можно подождать"
Верни РОВНО 20 видео_ideas и РОВНО 5 title_formulas.
Только JSON. Начни с { заканчивай с }.`
    : `You are a YouTube content strategist with 10 years of experience launching successful channels.

You will be given a niche, target market, and data about top videos from the last month.
Create a detailed launch plan: channel name ideas, positioning, video ideas, title formulas.

IMPORTANT: Video ideas must be specific and ready to film — not abstract topics.
Take into account what actually gets views in this niche based on the YouTube data.

FORMAT — strict JSON without markdown:
{"channel_name_ideas":["Name 1","Name 2","Name 3"],"positioning":"Unique positioning: what makes this channel different from competitors — 2-3 sentences","video_ideas":[{"title":"Ready-to-film video title","format":"Shorts/Long/Series","why_works":"Why it will work — 1 sentence","best_time":"Tuesday 6PM","priority":"Urgent"},{"title":"...","format":"...","why_works":"...","best_time":"...","priority":"Soon"},{"title":"...","format":"...","why_works":"...","best_time":"...","priority":"Later"}],"title_formulas":[{"formula":"How to [action] in [time] without [obstacle]","example":"How to close a deal in 5 minutes without pressuring the client"},{"formula":"...","example":"..."}],"content_pillars":["Pillar 1","Pillar 2","Pillar 3"]}

priority: only "Urgent", "Soon", or "Later"
Return EXACTLY 20 video_ideas and EXACTLY 5 title_formulas.
JSON only. Start with { end with }.`
}

function getMonthsPlanPrompt(lang: string): string {
  const isRu = lang !== 'en'
  return isRu
    ? `Ты стратег по YouTube контенту. Составь контент-план на 3 месяца (по неделям).

Для каждого месяца: цель, 4 видео (по одному в неделю), 3 конкретных действия.

ФОРМАТ — строго JSON без markdown:
{"month_1":{"goal":"Цель первого месяца","videos":[{"week":1,"title":"Название видео","format":"Shorts/Длинное","day":"Вторник"},{"week":2,"title":"...","format":"...","day":"..."},{"week":3,"title":"...","format":"...","day":"..."},{"week":4,"title":"...","format":"...","day":"..."}],"actions":["Действие 1","Действие 2","Действие 3"]},"month_2":{"goal":"...","videos":[{"week":5,"title":"...","format":"...","day":"..."},{"week":6,"title":"...","format":"...","day":"..."},{"week":7,"title":"...","format":"...","day":"..."},{"week":8,"title":"...","format":"...","day":"..."}],"actions":["...","...","..."]},"month_3":{"goal":"...","videos":[{"week":9,"title":"...","format":"...","day":"..."},{"week":10,"title":"...","format":"...","day":"..."},{"week":11,"title":"...","format":"...","day":"..."},{"week":12,"title":"...","format":"...","day":"..."}],"actions":["...","...","..."]}}

Только JSON. Начни с { заканчивай с }.`
    : `You are a YouTube content strategist. Create a 3-month content plan (week by week).

For each month: goal, 4 videos (one per week), 3 concrete actions.

FORMAT — strict JSON without markdown:
{"month_1":{"goal":"Month one goal","videos":[{"week":1,"title":"Video title","format":"Shorts/Long","day":"Tuesday"},{"week":2,"title":"...","format":"...","day":"..."},{"week":3,"title":"...","format":"...","day":"..."},{"week":4,"title":"...","format":"...","day":"..."}],"actions":["Action 1","Action 2","Action 3"]},"month_2":{"goal":"...","videos":[{"week":5,"title":"...","format":"...","day":"..."},{"week":6,"title":"...","format":"...","day":"..."},{"week":7,"title":"...","format":"...","day":"..."},{"week":8,"title":"...","format":"...","day":"..."}],"actions":["...","...","..."]},"month_3":{"goal":"...","videos":[{"week":9,"title":"...","format":"...","day":"..."},{"week":10,"title":"...","format":"...","day":"..."},{"week":11,"title":"...","format":"...","day":"..."},{"week":12,"title":"...","format":"...","day":"..."}],"actions":["...","...","..."]}}

JSON only. Start with { end with }.`
}

function getStylePrompt(lang: string): string {
  const isRu = lang !== 'en'
  return isRu
    ? `Ты стратег по YouTube контенту. На основе ниши дай стиль обложек, growth hacks и путь к монетизации.

ПРАВИЛА:
• Каждое значение — максимум одно предложение
• growth_hacks — ровно 3 элемента, каждый одним предложением
• Только JSON без пояснений

ФОРМАТ — строго JSON:
{"thumbnail_style":"Одно предложение о стиле обложек: цвета, шрифт, главный элемент","growth_hacks":["Лайфхак 1 — одно предложение","Лайфхак 2 — одно предложение","Лайфхак 3 — одно предложение"],"monetization_path":"Одно предложение о пути к монетизации"}

Только JSON. Начни с { заканчивай с }.`
    : `You are a YouTube content strategist. Based on the niche, provide thumbnail style, growth hacks, and monetization path.

RULES:
• Each value must be maximum one sentence
• growth_hacks — exactly 3 items, each one sentence
• JSON only, no explanations

FORMAT — strict JSON:
{"thumbnail_style":"One sentence about thumbnail style: colors, font, main element","growth_hacks":["Hack 1 — one sentence","Hack 2 — one sentence","Hack 3 — one sentence"],"monetization_path":"One sentence about the monetization path"}

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
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as {
      topic?: string; country?: string; content_lang?: string; ui_lang?: string
    }
    const {
      topic = '', country = 'RU', content_lang = 'ru', ui_lang = 'ru',
    } = body

    if (!topic.trim()) return NextResponse.json({ ok: false, error: 'Введите тему канала' }, { status: 400 })

    const check = await requireCredits(user.id, 'channel_plan', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    const uiLangFull = resolveUserLang(req, ui_lang)
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

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

      const search = await ytFetch('/search', searchParams) as {
        items?: Array<{ id: { videoId?: string }; snippet: { title: string; channelTitle: string } }>
      }
      const ids = (search.items ?? []).map(v => v.id?.videoId).filter(Boolean).join(',')

      if (ids) {
        const stats = await ytFetch('/videos', { part: 'statistics,snippet', id: ids }) as {
          items?: Array<{
            snippet: { title: string; channelTitle: string; tags?: string[] }
            statistics: { viewCount?: string }
          }>
        }
        ytSummary = (stats.items ?? []).map(v => {
          const views = fmtViews(parseInt(v.statistics.viewCount ?? '0'))
          return `• "${v.snippet.title}" — ${views} views (${v.snippet.channelTitle})`
        }).join('\n')
      }
    } catch (e) {
      console.warn('[channel-plan] YouTube fetch failed:', e instanceof Error ? e.message : String(e))
    }

    const userCtx = ui_lang === 'en'
      ? `Niche: "${topic}"\nMarket: ${country}, content language: ${content_lang}\n\nTop videos in this niche (last 30 days):\n${ytSummary || 'No data available'}`
      : `Ниша: "${topic}"\nРынок: ${country}, язык контента: ${content_lang}\n\nТоп видео в этой нише за последние 30 дней:\n${ytSummary || 'Данные недоступны'}`

    console.log('[channel-plan] running Claude 1 + 2a + 2b in parallel')
    const ctxWithLang = userCtx + langNote(uiLangFull)

    const [msg1, msg2a, msg2b] = await Promise.all([
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: [{ type: 'text', text: getIdeasPrompt(ui_lang), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: ctxWithLang }],
      }),
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2500,
        system: [{ type: 'text', text: getMonthsPlanPrompt(ui_lang), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: ctxWithLang }],
      }),
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: [{ type: 'text', text: getStylePrompt(ui_lang), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: ctxWithLang }],
      }),
    ])

    const text1  = (msg1.content[0]  as { text: string }).text
    const text2a = (msg2a.content[0] as { text: string }).text
    const text2b = (msg2b.content[0] as { text: string }).text
    console.log('[channel-plan] claude1  tokens:', msg1.usage.input_tokens,  'out:', msg1.usage.output_tokens)
    console.log('[channel-plan] claude2a tokens:', msg2a.usage.input_tokens, 'out:', msg2a.usage.output_tokens)
    console.log('[channel-plan] claude2b tokens:', msg2b.usage.input_tokens, 'out:', msg2b.usage.output_tokens)
    console.log('[channel-plan] claude2a raw:', text2a.substring(0, 500))
    console.log('[channel-plan] claude2b raw:', text2b.substring(0, 500))

    const ideas      = parseClaudeJson<IdeasResult>(text1,  'claude1')
    const monthsPlan = parseClaudeJson<MonthsPlanResult>(text2a, 'claude2a')
    const style      = parseClaudeJson<StyleResult>(text2b, 'claude2b')

    const result = {
      channel_name_ideas: ideas.channel_name_ideas ?? [],
      positioning: ideas.positioning ?? '',
      video_ideas: ideas.video_ideas ?? [],
      title_formulas: ideas.title_formulas ?? [],
      content_pillars: ideas.content_pillars ?? [],
      month_1: monthsPlan.month_1,
      month_2: monthsPlan.month_2,
      month_3: monthsPlan.month_3,
      thumbnail_style: style.thumbnail_style ?? '',
      growth_hacks: style.growth_hacks ?? [],
      monetization_path: style.monetization_path ?? '',
    }

    await spendCredits(user.id, 8, 'channel_plan')

    console.log('[channel-plan] saving report...')
    try {
      const svc = createServiceClient()
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
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/channel-plan] error:', msg)
    return NextResponse.json({ ok: false, error: `Ошибка: ${msg}` }, { status: 500 })
  }
}
