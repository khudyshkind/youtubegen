import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

const KEYWORDS_SYSTEM_PROMPT_1 = `Ты опытный YouTube SEO аналитик, специализирующийся на оценке ключевых слов. На основе статистических данных (средние просмотры топ-5 видео и количество конкурирующих видео) оцени каждое ключевое слово.

МЕТОДОЛОГИЯ ОЦЕНКИ:
• difficulty (1-10) — сложность ранжирования по этому запросу
  - 1-3: низкая конкуренция, мало видео, легко войти
  - 4-6: средняя конкуренция, нужна качественная работа
  - 7-10: высокая конкуренция, нужен сильный канал
  - Учитывай: video_count (больше = выше difficulty), avg_views (больше = выше difficulty)

• potential (1-10) — потенциал монетизации и трафика
  - 1-3: низкий интерес аудитории, мало просмотров
  - 4-6: средний интерес
  - 7-10: высокий интерес, много просмотров у топ видео
  - Учитывай: avg_views топ-5 видео (больше = выше potential)

• competition — "Низкая" / "Средняя" / "Высокая"
• recommendation — конкретный совет: "Стоит снять" / "Сложно, но возможно" / "Слишком высокая конкуренция" + причина

ВАЖНО: Оценки должны быть реалистичными и полезными для контент-мейкера при выборе темы.

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"keywords":[{"keyword":"авто зимой","difficulty":6,"potential":8,"competition":"Средняя","recommendation":"Стоит снять — хороший баланс просмотров и конкуренции"}]}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Никаких \`\`\`json. Никаких пояснений. Начни с { и заканчивай с }.`

const KEYWORDS_SYSTEM_PROMPT_2 = `Ты опытный YouTube SEO стратег, помогающий контент-мейкерам выбирать лучшие ключевые слова. На основе списка ключевых слов выбери наиболее перспективные и дай итоговый анализ ниши.

МЕТОДОЛОГИЯ ОТБОРА:
• best_keywords — 3-5 лучших ключевых слов с оптимальным балансом потенциала и конкуренции
  - Лучшее = высокий потенциал + низкая/средняя сложность
  - Это ключевые слова для создания основного контента

• low_competition — 3-5 ключевых слов с минимальной конкуренцией
  - Даже если у них меньше просмотров — по ним легче ранжироваться
  - Отлично подходят для новых каналов, которым нужны первые просмотры

• insights — краткий аналитический вывод по нише (2-3 предложения)
  - Общая оценка ниши
  - Стратегическая рекомендация
  - На чём сосредоточиться

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"best_keywords":["купить авто 2026","тест-драйв новинки","лучший автомобиль до миллиона"],"low_competition":["авто для семьи советы","как выбрать первый автомобиль"],"insights":"Ниша автомобилей очень конкурентна в топовых запросах, но есть возможности в длинных ключах. Начинайте с запросов о конкретных моделях и сравнениях — там конкуренция ниже а интент покупки выше. Делайте акцент на запросы с годом (2026) — они свежее и менее насыщены контентом."}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Никаких \`\`\`json. Никаких пояснений. Начни с { и заканчивай с }.`

function parseClaudeJson<T>(text: string, label: string): T {
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

// YouTube Autocomplete (free, no API key needed)
async function getAutocompleteSuggestions(query: string, lang: string): Promise<string[]> {
  const url = new URL('https://suggestqueries.google.com/complete/search')
  url.searchParams.set('client', 'youtube')
  url.searchParams.set('ds', 'yt')
  url.searchParams.set('q', query)
  url.searchParams.set('hl', lang)
  url.searchParams.set('callback', 'cb')

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    const text = await res.text()
    // Response is JSONP: cb(["query",[["suggestion1",0],["suggestion2",0],...]])
    const match = text.match(/cb\((.+)\)$/)
    if (!match) return []
    const parsed = JSON.parse(match[1]) as [string, Array<[string, number]>]
    return (parsed[1] ?? []).map(item => item[0]).slice(0, 8)
  } catch {
    return []
  }
}

interface YtSearchResponse {
  items?: Array<{
    id: { videoId?: string }
    snippet: { title: string }
  }>
}

interface YtVideoListResponse {
  items?: Array<{
    id: string
    statistics: { viewCount?: string }
  }>
}

// Get avg views for top-5 videos on a query
async function getQueryStats(query: string): Promise<{ avg_views: number; video_count: number }> {
  try {
    const apiKey = env('YOUTUBE_API_KEY')
    const searchUrl = new URL(`${YT_BASE}/search`)
    searchUrl.searchParams.set('part', 'snippet')
    searchUrl.searchParams.set('type', 'video')
    searchUrl.searchParams.set('q', query)
    searchUrl.searchParams.set('maxResults', '5')
    searchUrl.searchParams.set('key', apiKey)

    const searchRes = await fetch(searchUrl.toString())
    if (!searchRes.ok) return { avg_views: 0, video_count: 0 }
    const searchData = await searchRes.json() as YtSearchResponse & { pageInfo?: { totalResults?: number } }

    const videoIds = (searchData.items ?? [])
      .map(i => i.id.videoId)
      .filter((id): id is string => !!id)

    const videoCount = (searchData as { pageInfo?: { totalResults?: number } }).pageInfo?.totalResults ?? 0

    if (videoIds.length === 0) return { avg_views: 0, video_count: videoCount }

    const statsUrl = new URL(`${YT_BASE}/videos`)
    statsUrl.searchParams.set('part', 'statistics')
    statsUrl.searchParams.set('id', videoIds.join(','))
    statsUrl.searchParams.set('key', apiKey)

    const statsRes = await fetch(statsUrl.toString())
    if (!statsRes.ok) return { avg_views: 0, video_count: videoCount }
    const statsData = await statsRes.json() as YtVideoListResponse

    const views = (statsData.items ?? [])
      .map(v => Number(v.statistics.viewCount ?? 0))
      .filter(v => v > 0)

    const avg_views = views.length > 0
      ? Math.round(views.reduce((a, b) => a + b, 0) / views.length)
      : 0

    return { avg_views, video_count: videoCount }
  } catch {
    return { avg_views: 0, video_count: 0 }
  }
}

function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}М`
  if (n >= 1_000) return `${Math.round(n / 1_000)}К`
  return String(n)
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { keyword?: string; lang?: string }
    const keyword = body.keyword?.trim() ?? ''
    const lang = body.lang === 'en' ? 'en' : 'ru'

    if (!keyword) return NextResponse.json({ ok: false, error: 'Введите ключевое слово' }, { status: 400 })

    const check = await requireCredits(user.id, 'keywords_analysis', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    // Collect autocomplete suggestions from multiple seed queries
    const seeds = [
      keyword,
      `${keyword} как`,
      `${keyword} для`,
      `${keyword} лучший`,
      `${keyword} 2026`,
    ]

    console.log(`[keywords] fetching suggestions for: ${keyword} (${lang})`)

    const suggestionsArrays = await Promise.all(
      seeds.map(seed => getAutocompleteSuggestions(seed, lang))
    )

    // Deduplicate and add the keyword itself
    const seen = new Set<string>()
    const allSuggestions: string[] = [keyword]
    seen.add(keyword.toLowerCase())

    for (const arr of suggestionsArrays) {
      for (const s of arr) {
        const key = s.toLowerCase().trim()
        if (!seen.has(key) && s.trim()) {
          seen.add(key)
          allSuggestions.push(s.trim())
        }
      }
    }

    // Limit to 20 unique suggestions to avoid too many API calls
    const suggestions = allSuggestions.slice(0, 20)
    console.log(`[keywords] collected ${suggestions.length} suggestions`)

    // Fetch stats for each suggestion in parallel (batches to avoid rate limits)
    const batchSize = 5
    const statsMap = new Map<string, { avg_views: number; video_count: number }>()

    for (let i = 0; i < suggestions.length; i += batchSize) {
      const batch = suggestions.slice(i, i + batchSize)
      const results = await Promise.all(batch.map(s => getQueryStats(s)))
      batch.forEach((s, j) => statsMap.set(s, results[j]))
    }

    // Build input strings for Claude
    const keywordsData = suggestions.map(s => {
      const stats = statsMap.get(s) ?? { avg_views: 0, video_count: 0 }
      return `- "${s}": avg_views=${fmtViews(stats.avg_views)}, video_count=${stats.video_count}`
    }).join('\n')

    const keywordsList = suggestions.map(s => `- "${s}"`).join('\n')

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

    const [msg1, msg2] = await Promise.all([
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: [{ type: 'text', text: KEYWORDS_SYSTEM_PROMPT_1, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Ниша: "${keyword}"\nДанные (avg_views — среднее топ-5 видео, video_count — конкуренция):\n${keywordsData}` }],
      }),
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: [{ type: 'text', text: KEYWORDS_SYSTEM_PROMPT_2, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Ниша: "${keyword}"\nКлючевые слова:\n${keywordsList}` }],
      }),
    ])

    const text1 = (msg1.content[0] as { text: string }).text
    const text2 = (msg2.content[0] as { text: string }).text
    console.log('[keywords] claude1 raw:', text1.substring(0, 300))
    console.log('[keywords] claude2 raw:', text2.substring(0, 300))
    console.log('[keywords] msg1 cache input:', msg1.usage.input_tokens, 'cache_read:', msg1.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg1.usage.cache_creation_input_tokens ?? 0)
    console.log('[keywords] msg2 cache input:', msg2.usage.input_tokens, 'cache_read:', msg2.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg2.usage.cache_creation_input_tokens ?? 0)

    interface ScoredKeywords {
      keywords: Array<{
        keyword: string
        difficulty: number
        potential: number
        competition: string
        recommendation: string
      }>
    }
    interface KeywordsInsights {
      best_keywords:   string[]
      low_competition: string[]
      insights:        string
    }

    const scored   = parseClaudeJson<ScoredKeywords>(text1, 'claude1')
    const insights = parseClaudeJson<KeywordsInsights>(text2, 'claude2')

    // Merge: scored keywords + real stats from statsMap
    const enrichedKeywords = (scored.keywords ?? []).map(kw => {
      const real = statsMap.get(kw.keyword) ?? { avg_views: 0, video_count: 0 }
      return {
        ...kw,
        avg_views:   real.avg_views,
        video_count: real.video_count,
      }
    })

    const easy   = enrichedKeywords.filter(k => k.difficulty <= 4).length
    const medium = enrichedKeywords.filter(k => k.difficulty >= 5 && k.difficulty <= 7).length
    const hard   = enrichedKeywords.filter(k => k.difficulty >= 8).length

    const result = {
      keyword,
      lang,
      total: enrichedKeywords.length,
      easy,
      medium,
      hard,
      keywords:        enrichedKeywords,
      best_keywords:   insights.best_keywords   ?? [],
      low_competition: insights.low_competition ?? [],
      insights:        insights.insights        ?? '',
    }

    await spendCredits(user.id, 5, 'keywords_analysis')

    // Save to analytics_reports (non-fatal, 20-limit)
    const svc = createServiceClient()
    try {
      const { data: old } = await svc
        .from('analytics_reports')
        .select('id')
        .eq('user_id', user.id)
        .eq('report_type', 'keywords')
        .order('created_at', { ascending: true })
      if ((old?.length ?? 0) >= 20) {
        await svc.from('analytics_reports').delete().eq('id', old![0].id)
      }
      await svc.from('analytics_reports').insert({
        user_id: user.id,
        report_type: 'keywords',
        title: `Ключевые слова: ${keyword}`,
        query: keyword,
        result,
      })
      console.log('[keywords] report saved')
    } catch (e) {
      console.warn('[keywords] report save failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/keywords] error:', msg)
    return NextResponse.json({ ok: false, error: `Ошибка анализа: ${msg}` }, { status: 500 })
  }
}
