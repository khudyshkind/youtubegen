import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

function parseClaudeJson<T>(text: string, label: string): T {
  console.log(`[niche] ${label} raw:`, text.substring(0, 500))
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  // Find first { to last matching }
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

async function ytFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const key = env('YOUTUBE_API_KEY')
  const qs = new URLSearchParams({ ...params, key }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  const text = await res.text()
  console.log(`[niche] yt ${path} status=${res.status} body=${text.slice(0, 300)}`)
  if (!res.ok) throw new Error(`YouTube API ${res.status} on ${path}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

function getNichePrompt1(lang: string): string {
  const isRu = lang !== 'en'
  return isRu ? `Ты опытный YouTube аналитик, специализирующийся на анализе ниш. На основе данных о топ каналах и топ видео оцени нишу и верни метрики в JSON.

МЕТОДОЛОГИЯ ОЦЕНКИ КОНКУРЕНЦИИ:
• competition_score 1-10 где 1 = минимальная конкуренция, 10 = максимальная
• Учитывай: количество подписчиков топ каналов, средние просмотры видео, частоту публикаций
• Высокая конкуренция (8-10): каналы с миллионами подписчиков, видео с миллионами просмотров
• Средняя конкуренция (4-7): каналы 100К-1М подписчиков, 50К-500К просмотров видео
• Низкая конкуренция (1-3): каналы до 100К подписчиков, до 50К просмотров видео

ОЦЕНКА ТРЕНДА:
• Анализируй даты публикации топ видео — если свежие видео набирают много просмотров — растёт
• trend: "Растёт" / "Стабильно" / "Снижается"
• growth: процент роста в формате "+23%" или "-5%" (приблизительная оценка)

ОЦЕНКА RPM:
• RPM (Revenue Per Mille) — доход с 1000 просмотров в USD после вычета 45% YouTube
• Рыночные тиры: США/CA/AU/UK: $4-15 | Зап.Европа: $3-10 | СНГ/Россия: $0.5-3 | LATAM: $0.5-2 | ЮВА: $0.3-1.5 | Индия: $0.2-1
• Множители: Финансы/бизнес/страхование: 2-3x | Технологии/ПО: 1.5-2x | Авто/здоровье: 1.2-1.8x | Образование: 1x | Развлечения/игры: 0.5-0.8x
• rpm_min и rpm_max — диапазон для данной ниши

ОЦЕНКА МОНЕТИЗАЦИИ: YouTube требует 1000 подписчиков и 4000 часов просмотров за 12 месяцев
• monetization_1_video: 1 видео/нед | monetization_2_videos: 2 видео/нед | monetization_3_videos: 3 видео/нед

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"competition_score":7,"competition_level":"Высокая","competition_reason":"коротко почему","trend":"Растёт","growth":"+23%","trend_reason":"коротко почему","rpm_min":1.5,"rpm_max":3.0,"monetization_1_video":"18-24 мес","monetization_2_videos":"10-14 мес","monetization_3_videos":"7-10 мес"}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Никаких блоков \`\`\`json. Никаких пояснений. Начни с { и заканчивай с }.`
  : `You are an experienced YouTube niche analyst. Based on data from top channels and videos, evaluate the niche and return metrics in JSON.

COMPETITION METHODOLOGY:
• competition_score 1-10 where 1 = minimum competition, 10 = maximum
• Consider: subscriber counts of top channels, average video views, upload frequency
• High competition (8-10): channels with millions of subscribers, videos with millions of views
• Medium competition (4-7): 100K-1M subscriber channels, 50K-500K video views
• Low competition (1-3): channels under 100K subscribers, under 50K video views

TREND ASSESSMENT:
• Analyze publication dates — if recent videos get many views — growing
• trend: "Growing" / "Stable" / "Declining"
• growth: percentage in format "+23%" or "-5%"

RPM ASSESSMENT:
• RPM = earnings per 1000 views in USD after YouTube's 45% cut
• Market tiers: US/CA/AU/UK: $4-15 | W.Europe: $3-10 | CIS/Russia: $0.5-3 | LATAM: $0.5-2 | SE Asia: $0.3-1.5 | India: $0.2-1
• Multipliers: Finance/business/insurance: 2-3x | Tech/software: 1.5-2x | Auto/health: 1.2-1.8x | Education: 1x | Entertainment/gaming: 0.5-0.8x

MONETIZATION: YouTube requires 1000 subscribers and 4000 watch hours in 12 months
• monetization_1_video: 1 video/wk | monetization_2_videos: 2/wk | monetization_3_videos: 3/wk

RESPONSE FORMAT — strict JSON without markdown:
{"competition_score":7,"competition_level":"High","competition_reason":"brief reason","trend":"Growing","growth":"+23%","trend_reason":"brief reason","rpm_min":1.5,"rpm_max":3.0,"monetization_1_video":"18-24 mo","monetization_2_videos":"10-14 mo","monetization_3_videos":"7-10 mo"}

IMPORTANT: Return ONLY valid JSON. No \`\`\`json blocks. No explanations. Start with { end with }.`
}

function getNichePrompt2(lang: string): string {
  const isRu = lang !== 'en'
  return isRu ? `Ты опытный YouTube аналитик, специализирующийся на анализе ниш и форматов контента. На основе данных о топ каналах и видео определи поднишы, форматы и дай практические рекомендации.

МЕТОДОЛОГИЯ ОПРЕДЕЛЕНИЯ ПОДНИШЕЙ:
• Поднища — более узкая тема в рамках основной ниши (например, в "авто": "электромобили", "тюнинг", "покупка авто")
• Определи 3 поднишы с хорошим потенциалом на основе видео
• subniches_competition — уровень конкуренции: "Низкая" / "Средняя" / "Высокая"

МЕТОДОЛОГИЯ ОПРЕДЕЛЕНИЯ ФОРМАТОВ:
• Формат = тип видео: обзоры, тест-драйвы, сравнения, топы, how-to, разборы, истории
• top_formats — форматы с наибольшим количеством просмотров
• avg_views — среднее количество просмотров для видео в этом формате

РЕКОМЕНДАЦИИ: конкретные практические советы — что делать в первые 3 месяца, какие форматы выбрать, как выделиться

ЛУЧШЕЕ ВРЕМЯ ПУБЛИКАЦИИ:
• best_days — дни недели с наибольшей активностью аудитории
• best_hours — оптимальное время публикации

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"subniches":["Электромобили","Тюнинг","Покупка авто"],"subniches_competition":["Низкая","Средняя","Высокая"],"top_formats":[{"name":"Тест-драйвы","avg_views":450000},{"name":"Обзоры","avg_views":280000},{"name":"Сравнения","avg_views":150000}],"best_days":["Вторник","Четверг"],"best_hours":"18:00-20:00","recommendations":["Начинайте с коротких видео (Shorts) — этот формат набирает миллионы просмотров в данной нише и помогает быстро найти аудиторию","Снимайте сравнительные обзоры: зрители активно ищут такие видео при выборе товара","Публикуйте стабильно 2 видео в неделю — алгоритм YouTube даёт приоритет каналам с регулярным контентом"]}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Никаких блоков \`\`\`json. Никаких пояснений. Начни с { и заканчивай с }.`
  : `You are an experienced YouTube niche analyst. Based on top channel and video data, identify sub-niches, formats and provide practical recommendations.

SUB-NICHE METHODOLOGY:
• Sub-niche — narrower topic within the main niche (e.g. in "auto": "EVs", "tuning", "car buying")
• Identify 3 sub-niches with good potential
• subniches_competition — competition level: "Low" / "Medium" / "High"

FORMAT METHODOLOGY:
• Format = video type: reviews, test drives, comparisons, top lists, how-to, breakdowns, stories
• top_formats — formats with highest view counts from top video data
• avg_views — average view count for videos in this format

RECOMMENDATIONS: specific practical tips — what to do in first 3 months, which formats to choose, how to stand out

BEST POSTING TIME:
• best_days — days of the week with highest audience activity
• best_hours — optimal posting time

RESPONSE FORMAT — strict JSON without markdown:
{"subniches":["Electric Vehicles","Tuning","Car Buying"],"subniches_competition":["Low","Medium","High"],"top_formats":[{"name":"Test Drives","avg_views":450000},{"name":"Reviews","avg_views":280000},{"name":"Comparisons","avg_views":150000}],"best_days":["Tuesday","Thursday"],"best_hours":"18:00-20:00","recommendations":["Start with YouTube Shorts — this format reaches millions of views in this niche and helps grow your audience fast","Create comparison reviews: viewers actively search for these when making a purchase decision","Post consistently 2 videos per week — YouTube's algorithm prioritizes channels with regular uploads"]}

IMPORTANT: Return ONLY valid JSON. No \`\`\`json blocks. No explanations. Start with { end with }.`
}

function cacheKey(topic: string, country: string, lang: string) {
  return `${topic.toLowerCase().trim()}|${country}|${lang}|v4`
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { topic?: string; country?: string; lang?: string }
    const topic = body.topic?.trim() ?? ''
    const country = body.country ?? 'RU'
    const lang = body.lang ?? 'ru'

    console.log(`[niche] start topic="${topic}" country=${country} lang=${lang}`)
    if (!topic) return NextResponse.json({ ok: false, error: 'Введите тему' }, { status: 400 })

    const svc = createServiceClient()
    const key = cacheKey(topic, country, lang)

    // Cache check — non-fatal
    try {
      const { data: cached } = await svc
        .from('analytics_cache')
        .select('result, created_at')
        .eq('cache_type', 'niche')
        .eq('cache_key', key)
        .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .single()
      if (cached) {
        console.log('[niche] cache hit, saving report for user:', user.id)
        try {
          const { data: existing } = await svc
            .from('analytics_reports')
            .select('id')
            .eq('user_id', user.id)
            .eq('report_type', 'niche')
            .eq('query', topic)
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .maybeSingle()
          if (!existing) {
            const { data: old } = await svc
              .from('analytics_reports')
              .select('id')
              .eq('user_id', user.id)
              .eq('report_type', 'niche')
              .order('created_at', { ascending: true })
            if ((old?.length ?? 0) >= 20) {
              await svc.from('analytics_reports').delete().eq('id', old![0].id)
            }
            const { error: saveErr } = await svc.from('analytics_reports').insert({
              user_id: user.id,
              report_type: 'niche',
              title: `Анализ ниши: ${topic}`,
              query: topic,
              result: cached.result,
            })
            console.log('[niche] cache-hit save result:', saveErr?.message ?? 'ok')
          } else {
            console.log('[niche] cache-hit: report already saved today, skip')
          }
        } catch (saveEx) {
          console.warn('[niche] cache-hit report save failed:', saveEx instanceof Error ? saveEx.message : String(saveEx))
        }
        return NextResponse.json({ ok: true, data: cached.result, cached: true })
      }
    } catch (e) {
      console.warn('[niche] cache check skipped:', e instanceof Error ? e.message : String(e))
    }

    const check = await requireCredits(user.id, 'niche_analysis', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    // ── YouTube data ──────────────────────────────────────────────────────────

    console.log('[niche] step 1: search channels')
    const channelSearch = await ytFetch('/search', {
      part: 'snippet', type: 'channel', q: topic,
      maxResults: '10', relevanceLanguage: lang, regionCode: country,
    }) as { items?: Array<{ id: { channelId: string } }> }

    const channelIds = (channelSearch.items ?? []).map(i => i.id.channelId).filter(Boolean).join(',')
    console.log(`[niche] channel ids: ${channelIds.slice(0, 80)}`)

    let channelsData: Array<{ name: string; subscribers: number; videos: number; views: number }> = []
    if (channelIds) {
      console.log('[niche] step 2: channel stats')
      const statsRes = await ytFetch('/channels', {
        part: 'statistics,snippet', id: channelIds,
      }) as { items?: Array<{ snippet: { title: string }; statistics: { subscriberCount?: string; videoCount?: string; viewCount?: string } }> }
      channelsData = (statsRes.items ?? []).map(ch => ({
        name: ch.snippet.title,
        subscribers: parseInt(ch.statistics.subscriberCount ?? '0'),
        videos: parseInt(ch.statistics.videoCount ?? '0'),
        views: parseInt(ch.statistics.viewCount ?? '0'),
      }))
      console.log(`[niche] channels: ${channelsData.length}`)
    }

    console.log('[niche] step 3: search videos')
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    const videoSearch = await ytFetch('/search', {
      part: 'snippet', type: 'video', q: topic,
      order: 'viewCount', publishedAfter: oneYearAgo,
      maxResults: '10', relevanceLanguage: lang, regionCode: country,
    }) as { items?: Array<{ id: { videoId: string }; snippet: { title: string; channelTitle: string; publishedAt: string } }> }

    const videoIds = (videoSearch.items ?? []).map(v => v.id.videoId).filter(Boolean).join(',')
    console.log(`[niche] video ids: ${videoIds.slice(0, 80)}`)

    let videosData: Array<{ title: string; views: number; channel: string; url: string }> = []
    if (videoIds) {
      console.log('[niche] step 4: video stats')
      const vStats = await ytFetch('/videos', {
        part: 'statistics,snippet', id: videoIds,
      }) as { items?: Array<{ id: string; snippet: { title: string; channelTitle: string; publishedAt: string }; statistics: { viewCount?: string } }> }
      videosData = (vStats.items ?? []).map(v => ({
        title: v.snippet.title,
        views: parseInt(v.statistics.viewCount ?? '0'),
        channel: v.snippet.channelTitle,
        url: `https://youtube.com/watch?v=${v.id}`,
      })).sort((a, b) => b.views - a.views)
      console.log(`[niche] videos: ${videosData.length}`)
    }

    // ── Claude: two small requests ────────────────────────────────────────────

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

    const dataCtx = `Топ каналы: ${JSON.stringify(channelsData.slice(0, 5))}
Топ видео: ${JSON.stringify(videosData.slice(0, 5))}
Язык: ${lang}, Страна: ${country}`

    // Request 1 — metrics
    console.log('[niche] step 5a: claude metrics')
    const msg1 = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: [{ type: 'text', text: getNichePrompt1(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Ниша: "${topic}"\n${dataCtx}` }],
    })
    console.log('[niche] msg1 cache input:', msg1.usage.input_tokens, 'cache_read:', msg1.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg1.usage.cache_creation_input_tokens ?? 0)
    const text1 = (msg1.content[0] as { text: string }).text

    interface Metrics {
      competition_score: number
      competition_level: string
      competition_reason: string
      trend: string
      growth: string
      trend_reason: string
      rpm_min: number
      rpm_max: number
      monetization_1_video: string
      monetization_2_videos: string
      monetization_3_videos: string
    }
    const metrics = parseClaudeJson<Metrics>(text1, 'claude1')

    // Request 2 — recommendations + formats with real avg_views
    console.log('[niche] step 5b: claude recommendations')
    const msg2 = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: [{ type: 'text', text: getNichePrompt2(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Ниша: "${topic}"\n${dataCtx}\n\nОпредели топ форматы на основе РЕАЛЬНЫХ видео выше.` }],
    })
    console.log('[niche] msg2 cache input:', msg2.usage.input_tokens, 'cache_read:', msg2.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg2.usage.cache_creation_input_tokens ?? 0)
    const text2 = (msg2.content[0] as { text: string }).text

    interface Recs {
      subniches: string[]
      subniches_competition: string[]
      top_formats: Array<{ name: string; avg_views: number } | string>
      best_days: string[]
      best_hours: string
      recommendations: string[]
    }
    const recs = parseClaudeJson<Recs>(text2, 'claude2')

    // ── Merge into final shape ────────────────────────────────────────────────

    const analysis = {
      competition: {
        score: metrics.competition_score,
        level: metrics.competition_level,
        reason: metrics.competition_reason,
      },
      potential: {
        trend: metrics.trend,
        growth: metrics.growth,
        reason: metrics.trend_reason,
      },
      rpm: { min: metrics.rpm_min, max: metrics.rpm_max, currency: 'USD' },
      subniches: (recs.subniches ?? []).map((name, i) => ({
        name,
        competition: recs.subniches_competition?.[i] ?? 'Средняя',
        potential: 'Высокий',
      })),
      monetization: {
        videos_per_week_1: metrics.monetization_1_video,
        videos_per_week_2: metrics.monetization_2_videos,
        videos_per_week_3: metrics.monetization_3_videos,
      },
      best_time: { days: recs.best_days ?? [], hours: recs.best_hours ?? '' },
      top_formats: (recs.top_formats ?? []).map(f =>
        typeof f === 'string' ? { name: f, avg_views: 0 } : { name: f.name, avg_views: f.avg_views ?? 0 }
      ),
      top_channels: channelsData.slice(0, 5).map(c => ({
        name: c.name,
        subscribers: c.subscribers,
        videos: c.videos,
        avg_views: c.videos > 0 ? Math.round(c.views / c.videos) : 0,
      })),
      top_videos: videosData.slice(0, 5),
      recommendations: recs.recommendations ?? [],
    }

    console.log('[niche] analysis merged ok')

    await spendCredits(user.id, 10, 'niche_analysis')

    try {
      await svc.from('analytics_cache').upsert({
        cache_type: 'niche',
        cache_key: key,
        result: analysis,
        created_at: new Date().toISOString(),
      }, { onConflict: 'cache_type,cache_key' })
    } catch (e) {
      console.warn('[niche] cache write failed:', e instanceof Error ? e.message : String(e))
    }

    // Save to reports history (non-fatal)
    console.log('[niche] saving report for user:', user.id)
    try {
      const { data: old, error: oldErr } = await svc
        .from('analytics_reports')
        .select('id')
        .eq('user_id', user.id)
        .eq('report_type', 'niche')
        .order('created_at', { ascending: true })
      console.log('[niche] existing reports count:', old?.length ?? 0, 'fetchErr:', oldErr?.message ?? 'none')
      if ((old?.length ?? 0) >= 20) {
        await svc.from('analytics_reports').delete().eq('id', old![0].id)
      }
      const { error: saveError } = await svc.from('analytics_reports').insert({
        user_id: user.id,
        report_type: 'niche',
        title: `Анализ ниши: ${topic}`,
        query: topic,
        result: analysis,
      })
      console.log('[niche] save result:', saveError?.message ?? 'ok')
    } catch (e) {
      console.warn('[niche] report save failed:', e instanceof Error ? e.message : String(e))
    }

    // Cleanup stale cache (non-fatal)
    try {
      await svc.from('analytics_cache')
        .delete()
        .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    } catch (e) {
      console.warn('[niche] cache cleanup failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: analysis, cached: false })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/niche] fatal error:', msg)
    return NextResponse.json({ ok: false, error: `Ошибка анализа: ${msg}` }, { status: 500 })
  }
}
