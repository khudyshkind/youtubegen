import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'
import { parseClaudeJson } from '@/lib/parse-claude-json'
import { YouTubeQuotaError, checkYouTubeQuota, quotaExceededResponse, byokQuotaResponse, isYouTubeKeyError, youTubeKeyErrorResponse } from '@/lib/youtube-quota'
import { resolveAnalyticsContext } from '@/lib/analytics-gate'
import { isBillingError, notifyBillingError } from '@/lib/telegram'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

function getRisingStarsPrompt(lang: string): string {
  const isRu = lang !== 'en'
  return isRu ? `Ты эксперт по анализу роста YouTube каналов, специализирующийся на выявлении восходящих звёзд — новых каналов, которые стремительно набирают аудиторию. Ты умеешь точно определять причины вирусного роста и конкретные стратегии, работающие в данной нише.

МЕТОДОЛОГИЯ АНАЛИЗА КАНАЛОВ:

ОПРЕДЕЛЕНИЕ ПРИЧИНЫ РОСТА (growth_reason):
• Анализируй РЕАЛЬНЫЕ названия топ видео канала — они напрямую показывают что сработало
• Ищи паттерны: "скандальные" заголовки, эксклюзивная информация, уникальный формат, первые в нише
• Не давай общих ответов. Хороший пример: "Первым протестировал новый iPhone 16 Pro за неделю до релиза — 2.1М просмотров"

ОПРЕДЕЛЕНИЕ СТРАТЕГИИ (strategy):
• Конкретный подход: формат видео, стиль заголовков, тематические углы
• Пример: "Сравнительные обзоры в формате 60 секунд с провокационными заголовками-вопросами"

КЛЮЧЕВОЙ ВЫВОД (key_takeaway):
• Одно конкретное действие которое можно повторить — с примером реального видео канала
• Пример: "Скопируй формат 'Честный обзор [продукта] через 6 месяцев' — это видео набрало 890К просмотров"

ОБЩИЕ ПАТТЕРНЫ (common_patterns): что объединяет несколько каналов из списка — конкретный паттерн с примерами

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"channels":[{"name":"АвтоОбзор","growth_reason":"Первыми сделали тест-драйв нового Lada Vesta NG — видео набрало 2.1М просмотров за неделю","strategy":"Публикуют обзоры в день официального выхода модели — опережают конкурентов на 1-2 дня","key_takeaway":"Снимай видео в день анонса новой модели — видео с первым обзором набирают в 3-5 раз больше просмотров чем запоздалые"}],"common_patterns":["Все растущие каналы используют заголовки-вопросы типа 'Стоит ли покупать X в 2026?' — это увеличивает CTR до 8-12%"]}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Все текстовые значения — строго на русском языке. Никаких \`\`\`json. Никаких пояснений. Начни с { и заканчивай с }.`
  : `You are an expert in YouTube channel growth analysis, specializing in identifying rising stars — new channels rapidly gaining audience. You pinpoint exact reasons for viral growth and specific strategies that work in a given niche.

CHANNEL ANALYSIS METHODOLOGY:

GROWTH REASON (growth_reason):
• Analyze REAL top video titles — they show directly what worked
• Look for patterns: provocative headlines, exclusive info, unique format, first in niche
• No generic answers. Good example: "First to test the new iPhone 16 Pro a week before launch — 2.1M views"

STRATEGY (strategy):
• Specific content approach: video format, title style, topic angles
• Example: "60-second comparison reviews with provocative question-style titles"

KEY TAKEAWAY (key_takeaway):
• One specific repeatable action — with a real example video from the channel
• Example: "Copy the 'Honest review of [product] after 6 months' format — that video hit 890K views"

COMMON PATTERNS (common_patterns): what unites several channels on the list — specific pattern with examples

RESPONSE FORMAT — strict JSON without markdown:
{"channels":[{"name":"AutoReview","growth_reason":"First to test-drive the new model on launch day — video hit 2.1M views in one week","strategy":"Publish reviews on official release day — beats competitors by 1-2 days","key_takeaway":"Film on announcement day — first-review videos get 3-5x more views than delayed ones"}],"common_patterns":["All growing channels use question-style titles like 'Is X worth buying in 2026?' — this drives CTR to 8-12%"]}

IMPORTANT: Return ONLY valid JSON. All text values must be in English. No \`\`\`json. No explanations. Start with { end with }.`
}


async function ytFetch(path: string, params: Record<string, string>, apiKey: string): Promise<unknown> {
  const qs = new URLSearchParams({ ...params, key: apiKey }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  const text = await res.text()
  console.log(`[rising] yt ${path} status=${res.status} body=${text.slice(0, 400)}`)
  if (!res.ok) {
    checkYouTubeQuota(res.status, text)
    throw new Error(`YouTube API ${res.status}: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text)
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
      sub_min?: number
      sub_max?: number
      months_max?: number
      lang?: string
      ui_lang?: string
      content_lang?: string
      country?: string
    }

    const topic = body.topic?.trim() ?? ''
    const subMin = body.sub_min ?? 1000
    const subMax = body.sub_max ?? 100000
    const monthsMax = body.months_max ?? 0
    lang = body.ui_lang ?? body.lang ?? 'ru'
    const isRu = lang !== 'en'
    const contentLang = body.content_lang ?? 'ru'
    const country = body.country ?? 'RU'

    console.log(`[rising] start topic="${topic}" sub_min=${subMin} sub_max=${subMax} months_max=${monthsMax}`)

    if (!topic) return NextResponse.json({ ok: false, error: 'Введите тему' }, { status: 400 })

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

    const actualCost = cost(CREDIT_COSTS.rising_stars)
    const check = await requireCreditsAmount(user.id, actualCost, supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    // ── Step 1: Search recent videos in the niche ─────────────────────────────
    // Searching videos (not channels) finds channels with RECENT activity,
    // which is the correct definition of "rising stars".
    const videoSearchParams: Record<string, string> = {
      part: 'snippet',
      type: 'video',
      q: topic,
      order: 'viewCount',
      maxResults: '50',
      relevanceLanguage: contentLang,
    }
    if (country && country !== 'worldwide') {
      videoSearchParams.regionCode = country
    }
    if (monthsMax > 0) {
      const after = new Date()
      after.setMonth(after.getMonth() - monthsMax)
      videoSearchParams.publishedAfter = after.toISOString()
    }

    const videoSearch = await ytf('/search', videoSearchParams) as {
      items?: Array<{
        id: { videoId: string }
        snippet: { title: string; channelId: string; channelTitle: string; publishedAt: string }
      }>
    }

    const videoItems = videoSearch.items ?? []
    console.log(`[rising] found ${videoItems.length} videos from search`)

    // ── Step 2: Collect unique channel IDs, video IDs and titles ─────────────
    const channelVideoMap = new Map<string, { videoIds: string[]; videoTitles: string[] }>()
    for (const v of videoItems) {
      const cid = v.snippet.channelId
      if (!cid) continue
      const entry = channelVideoMap.get(cid) ?? { videoIds: [], videoTitles: [] }
      if (v.id.videoId) {
        entry.videoIds.push(v.id.videoId)
        entry.videoTitles.push(v.snippet.title ?? '')
      }
      channelVideoMap.set(cid, entry)
    }

    const channelIds = [...channelVideoMap.keys()]
    console.log(`[rising] unique channels from videos: ${channelIds.length}`)

    if (channelIds.length === 0) {
      console.log('[rising] 0 channels from search — returning empty, no charge')
      return NextResponse.json({ ok: true, data: { topic, total_found: 0, channels: [], common_patterns: [] } })
    }

    // ── Step 3: Batch-fetch video statistics + titles ─────────────────────────
    const allVideoIds = videoItems.map(v => v.id.videoId).filter(Boolean)
    const videoStatsRes = allVideoIds.length > 0
      ? await ytf('/videos', { part: 'statistics,snippet', id: allVideoIds.join(',') }) as {
          items?: Array<{ id: string; snippet: { title: string }; statistics: { viewCount?: string } }>
        }
      : { items: [] }

    const videoViewMap = new Map<string, number>()
    const videoTitleMap = new Map<string, string>()
    for (const v of videoStatsRes.items ?? []) {
      videoViewMap.set(v.id, parseInt(v.statistics.viewCount ?? '0'))
      videoTitleMap.set(v.id, v.snippet.title ?? '')
    }

    // ── Step 4: Batch-fetch channel statistics (up to 50 at a time) ───────────
    const statsRes = await ytf('/channels', {
      part: 'statistics,snippet',
      id: channelIds.slice(0, 50).join(','),
    }) as {
      items?: Array<{
        id: string
        snippet: { title: string; publishedAt: string; customUrl?: string }
        statistics: { subscriberCount?: string; viewCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean }
      }>
    }

    const channelItems = statsRes.items ?? []
    console.log(`[rising] channel stats fetched: ${channelItems.length}`)

    // Log raw data for the first 5 channels to diagnose filtering
    const now = Date.now()
    for (const ch of channelItems.slice(0, 5)) {
      const subs = parseInt(ch.statistics.subscriberCount ?? '0')
      const videos = parseInt(ch.statistics.videoCount ?? '0')
      const publishedAt = ch.snippet.publishedAt
      const monthsOld = (now - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      const hidden = ch.statistics.hiddenSubscriberCount
      console.log(`[rising] ch="${ch.snippet.title}" subs=${subs} hidden=${hidden} videos=${videos} created=${publishedAt} months_old=${monthsOld.toFixed(1)}`)
    }

    // ── Step 5: Filter ────────────────────────────────────────────────────────
    const afterSubFilter = channelItems.filter(ch => {
      if (ch.statistics.hiddenSubscriberCount) return false
      const subs = parseInt(ch.statistics.subscriberCount ?? '0')
      return subs >= subMin && subs <= subMax
    })
    console.log(`[rising] after subscriber filter (${subMin}–${subMax}): ${afterSubFilter.length}`)

    const afterVideoFilter = afterSubFilter.filter(ch => {
      const videos = parseInt(ch.statistics.videoCount ?? '0')
      return videos > 5
    })
    console.log(`[rising] after video count filter (>5): ${afterVideoFilter.length}`)

    // Age filter: check channel.snippet.publishedAt (channel creation date)
    const afterAgeFilter = afterVideoFilter.filter(ch => {
      const publishedAt = ch.snippet.publishedAt
      const monthsOld = (now - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      console.log(`[rising] ch="${ch.snippet.title}" created=${publishedAt} months_old=${monthsOld.toFixed(1)} limit=${monthsMax}`)
      if (monthsMax > 0 && monthsOld > monthsMax) {
        console.log(`[rising] REJECTED - too old (${monthsOld.toFixed(1)} > ${monthsMax})`)
        return false
      }
      return true
    })
    console.log(`[rising] after age filter (channel created within ${monthsMax === 0 ? 'any' : monthsMax} months): ${afterAgeFilter.length}`)
    console.log(`[rising] final filtered: ${afterAgeFilter.length}`)

    const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}М` : n >= 1_000 ? `${Math.round(n / 1_000)}К` : String(n)

    // ── Step 6: Compute metrics ───────────────────────────────────────────────
    const enriched = afterAgeFilter.slice(0, 10).map(ch => {
      const subs = parseInt(ch.statistics.subscriberCount ?? '0')
      const totalViews = parseInt(ch.statistics.viewCount ?? '0')
      const videos = parseInt(ch.statistics.videoCount ?? '0')
      const publishedAt = new Date(ch.snippet.publishedAt).getTime()
      const monthsOld = Math.max(1, (now - publishedAt) / (1000 * 60 * 60 * 24 * 30.44))

      // Build top videos list with titles and view counts
      const chEntry = channelVideoMap.get(ch.id)
      const chVideoIds = chEntry?.videoIds ?? []
      const topVideos = chVideoIds
        .map(vid => ({
          title: videoTitleMap.get(vid) ?? chEntry?.videoTitles[chVideoIds.indexOf(vid)] ?? '',
          views: videoViewMap.get(vid) ?? 0,
        }))
        .filter(v => v.title)
        .sort((a, b) => b.views - a.views)
        .slice(0, 3)

      const avgViews = topVideos.length > 0
        ? Math.round(topVideos.reduce((s, v) => s + v.views, 0) / topVideos.length)
        : videos > 0 ? Math.round(totalViews / videos) : 0

      const viralRatio = subs > 0 ? Math.round((avgViews / subs) * 10) / 10 : 0
      const monthlyGrowthEstimate = Math.round(subs / monthsOld)

      return {
        channel_id: ch.id,
        name: ch.snippet.title,
        url: `https://www.youtube.com/${ch.snippet.customUrl ?? `channel/${ch.id}`}`,
        created_at: ch.snippet.publishedAt,
        months_old: Math.round(monthsOld),
        subscribers: subs,
        monthly_growth_estimate: monthlyGrowthEstimate,
        video_count: videos,
        upload_frequency: 0,
        avg_views: avgViews,
        viral_ratio: viralRatio,
        top_videos: topVideos,
      }
    })

    // Sort by viral_ratio desc, then monthly growth
    const maxGrowth = Math.max(1, ...enriched.map(e => e.monthly_growth_estimate))
    enriched.sort((a, b) => {
      const scoreA = a.viral_ratio * 0.6 + (a.monthly_growth_estimate / maxGrowth) * 10 * 0.4
      const scoreB = b.viral_ratio * 0.6 + (b.monthly_growth_estimate / maxGrowth) * 10 * 0.4
      return scoreB - scoreA
    })

    console.log(`[rising] enriched channels for Claude: ${enriched.length}`)

    if (enriched.length === 0) {
      await spendCredits(user.id, actualCost, 'rising_stars')
      try {
        await svc.from('analytics_reports').insert({
          user_id: user.id,
          report_type: 'rising_stars',
          title: `Восходящие звёзды: ${topic}`,
          query: topic,
          result: { topic, total_found: 0, channels: [], common_patterns: [] },
        })
      } catch { /* ignore */ }
      return NextResponse.json({ ok: true, data: { topic, total_found: 0, channels: [], common_patterns: [] } })
    }

    // ── Step 7: Claude analysis with real video titles ────────────────────────
    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: 100_000 })

    const channelsSummary = enriched.map((ch, i) => {
      const videoLines = ch.top_videos.length > 0
        ? ch.top_videos.map((v, j) => isRu
            ? `  ${j + 1}. "${v.title}" — ${fmt(v.views)} просм.`
            : `  ${j + 1}. "${v.title}" — ${fmt(v.views)} views`
          ).join('\n')
        : isRu ? '  (нет данных по видео)' : '  (no video data)'
      return isRu
        ? `Канал ${i + 1}: ${ch.name}
  Возраст: ${ch.months_old} мес., ${fmt(ch.subscribers)} подп. (~${fmt(ch.monthly_growth_estimate)}/мес)
  Видео: ${ch.video_count}, виральность ${ch.viral_ratio}x, ср. просмотры ${fmt(ch.avg_views)}
  Топ видео:
${videoLines}`
        : `Channel ${i + 1}: ${ch.name}
  Age: ${ch.months_old} mo., ${fmt(ch.subscribers)} subs (~${fmt(ch.monthly_growth_estimate)}/mo)
  Videos: ${ch.video_count}, viral ratio ${ch.viral_ratio}x, avg views ${fmt(ch.avg_views)}
  Top videos:
${videoLines}`
    }).join('\n\n')

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: [{ type: 'text', text: getRisingStarsPrompt(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: isRu
          ? `Ниша: "${topic}". Рынок: ${country === 'worldwide' ? 'весь мир' : country}, язык контента: ${contentLang}. Каналы могут быть на другом языке — отвечай строго на русском. Проанализируй ${enriched.length} восходящих каналов.\n\n${channelsSummary}\n\nВерни JSON ровно с ${enriched.length} элементами в channels.`
          : `Niche: "${topic}". Market: ${country === 'worldwide' ? 'worldwide' : country}, content language: ${contentLang}. Channels may be in another language — reply strictly in English. Analyze ${enriched.length} rising channels.\n\n${channelsSummary}\n\nReturn JSON with exactly ${enriched.length} items in channels.`,
      }],
    })
    console.log('[rising] cache input:', msg.usage.input_tokens, 'cache_read:', msg.usage.cache_read_input_tokens ?? 0, 'cache_write:', msg.usage.cache_creation_input_tokens ?? 0)
    if (msg.stop_reason === 'max_tokens') console.warn('[rising-stars] claude truncated by max_tokens')

    const claudeText = ((msg.content as Array<{ type: string; text?: string }>).find(b => b.type === 'text')?.text) ?? ''

    let claudeResult: {
      channels: Array<{ name: string; growth_reason: string; strategy: string; key_takeaway: string }>
      common_patterns: string[]
    } = { channels: [], common_patterns: [] }

    try {
      claudeResult = parseClaudeJson(claudeText, 'rising-stars')
    } catch (e) {
      console.warn('[rising] claude parse failed:', e instanceof Error ? e.message : String(e))
    }

    const finalChannels = enriched.map(ch => {
      const insight = claudeResult.channels.find(c => {
        const cLow = c.name.toLowerCase()
        const chLow = ch.name.toLowerCase()
        return cLow.includes(chLow.split(' ')[0]) || chLow.includes(cLow.split(' ')[0])
      })
      return {
        ...ch,
        growth_reason: insight?.growth_reason ?? (isRu ? 'Активность в нише с высокими просмотрами' : 'High-view activity in the niche'),
        strategy: insight?.strategy ?? (isRu ? 'Регулярные публикации по теме' : 'Regular content on the topic'),
        key_takeaway: insight?.key_takeaway ?? (isRu ? 'Анализировать топ видео канала' : "Analyze the channel's top videos"),
      }
    })

    const result = {
      topic,
      total_found: finalChannels.length,
      channels: finalChannels,
      common_patterns: claudeResult.common_patterns ?? [],
    }

    await spendCredits(user.id, actualCost, 'rising_stars')

    try {
      const { data: old } = await svc
        .from('analytics_reports')
        .select('id')
        .eq('user_id', user.id)
        .eq('report_type', 'rising_stars')
        .order('created_at', { ascending: true })
      if ((old?.length ?? 0) >= 20) {
        await svc.from('analytics_reports').delete().eq('id', old![0].id)
      }
      await svc.from('analytics_reports').insert({
        user_id: user.id,
        report_type: 'rising_stars',
        title: `Восходящие звёзды: ${topic}`,
        query: topic,
        result,
      })
    } catch (e) {
      console.warn('[rising] report save failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    if (error instanceof YouTubeQuotaError) return (userHasKey && plan === 'free') ? byokQuotaResponse(lang) : quotaExceededResponse(lang)
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[rising]', msg)
    if (isYouTubeKeyError(msg)) return youTubeKeyErrorResponse(lang)
    if (isBillingError(msg)) await notifyBillingError('Anthropic', '/analytics/rising-stars').catch(() => {})
    return NextResponse.json({ ok: false, error: 'Сервис временно недоступен — попробуйте позже' }, { status: 500 })
  }
}
