import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'
import { resolveUserLang, langNote } from '@/lib/user-lang'
import { parseClaudeJson } from '@/lib/parse-claude-json'
import {
  YouTubeQuotaError, checkYouTubeQuota,
  byokQuotaResponse, isYouTubeKeyError, youTubeKeyErrorResponse,
} from '@/lib/youtube-quota'
import { resolveAnalyticsContext } from '@/lib/analytics-gate'
import { isBillingError, notifyBillingError } from '@/lib/telegram'

export const maxDuration = 300

const YT_BASE    = 'https://www.googleapis.com/youtube/v3'
const QUOTA_BUDGET = 2600
const FRESH_DAYS   = 90
const OLD_DAYS     = 365

// Reliability thresholds — metrics below these are statistical noise, not market signals.
const MIN_CHANNELS_RELIABLE = 5   // newcomer_share unreliable below this
const MIN_OLD_SAMPLE_GROWTH = 10  // growth_ratio unreliable below this

// Concurrency limits to avoid YouTube 429 rate-limit (edge-rejected; no quota consumed on 429).
const ENRICH_CONCURRENCY = 4    // niches enriched in parallel in Step 2+3
const ENRICH_BATCH_DELAY = 400  // ms between Step 2+3 batches
const GROWTH_CONCURRENCY = 3    // niches in parallel in Step 5 growth-ratio
const GROWTH_BATCH_DELAY = 500  // ms between Step 5 batches
const RATE_LIMIT_DELAYS  = [2000, 4000] as const  // back-off delays for 429 retries

// ─── Helpers ──────────────────────────────────────────────────────────────────

class YouTubeRateLimitError extends Error {
  constructor(path: string) {
    super(`YouTube rate-limit (429) on ${path}`)
    this.name = 'YouTubeRateLimitError'
  }
}

async function ytFetch(path: string, params: Record<string, string>, apiKey: string): Promise<unknown> {
  const qs  = new URLSearchParams({ ...params, key: apiKey }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  const text = await res.text()
  if (!res.ok) {
    if (res.status === 429) throw new YouTubeRateLimitError(path)
    checkYouTubeQuota(res.status, text)
    throw new Error(`YouTube API ${res.status} on ${path}: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text)
}

function medianOf(arr: number[]): number {
  if (!arr.length) return 0
  const s   = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

function daysOld(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000)
}

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

function getSubNicheGenPrompt(lang: string, count: number): string {
  const isRu = lang !== 'en'
  return isRu
    ? `Ты YouTube-аналитик. Разбей нишу (или конкретное направление внутри неё) на КОНКРЕТНЫЕ подниши для YouTube-канала.

Если указано направление — генерируй подниши ТОЛЬКО внутри него, не выходи за его рамки.
Без направления — разбивай всю широкую нишу.

Подниши должны быть специфичными (не "личные финансы", а "кредитные карты с кэшбэком"),
охватывать разные форматы и угол зрения внутри заданного сегмента.

Для каждой подниши дай:
• name — полное название подниши для человека
• search_query — КОРОТКИЙ поисковый запрос из 2-3 слов, как реально ищут на YouTube
  (не описание, а то, что вводит пользователь в поиск)
  Примеры: «гитара с нуля», «накопительный счёт сравнение», «ИП налоги 2024»
• rpm_level: "низкий" | "средний" | "высокий"
• rpm_range: диапазон RPM в долларах за 1 000 просмотров, формат "$X–Y"
  Примеры: "$0.5–1.5" (низкий), "$2–5" (средний), "$5–15" (высокий)
• rpm_reason: одна строка — почему именно так (это ОЦЕНКА модели, не данные API)

ФОРМАТ — строго JSON без markdown:
{"sub_niches":[{"name":"Разбор гитарных аккордов для начинающих","search_query":"гитара с нуля","rpm_level":"низкий","rpm_range":"$0.5–1.5","rpm_reason":"Конкурентная ниша, низкий CPC"},{"name":"...","search_query":"...","rpm_level":"средний","rpm_range":"$2–5","rpm_reason":"..."}]}

Верни ровно ${count} подниш. Только JSON. Начни с {.`
    : `You are a YouTube analyst. Break a niche (or a specific direction within it) into SPECIFIC sub-niches for a YouTube channel.

If a direction is given — generate sub-niches ONLY within that direction, do not go outside its scope.
Without a direction — break down the entire broad niche.

Sub-niches must be specific (not "personal finance" but "cashback credit cards"),
covering different formats and angles within the given segment.

For each sub-niche provide:
• name — full sub-niche name for humans
• search_query — SHORT 2-3 word YouTube search term, as users actually type it
  (not a description, the actual search string)
  Examples: "guitar for beginners", "best savings account", "LLC taxes 2024"
• rpm_level: "low" | "medium" | "high"
• rpm_range: estimated RPM range in dollars per 1,000 views, format "$X–Y"
  Examples: "$0.5–1.5" (low), "$2–5" (medium), "$5–15" (high)
• rpm_reason: one line — why (MODEL ESTIMATE, not API data)

FORMAT — strict JSON without markdown:
{"sub_niches":[{"name":"Guitar chords breakdown for beginners","search_query":"guitar for beginners","rpm_level":"low","rpm_range":"$0.5–1.5","rpm_reason":"Competitive niche, low CPC"},{"name":"...","search_query":"...","rpm_level":"medium","rpm_range":"$2–5","rpm_reason":"..."}]}

Return exactly ${count} sub-niches. JSON only. Start with {.`
}

function getVerdictPrompt(lang: string): string {
  const isRu = lang !== 'en'
  return isRu
    ? `Ты YouTube-аналитик. Ты получишь данные по поднишам с реальными числами из YouTube API.
Задача: проранжировать и дать рекомендации НА ОСНОВЕ чисел, а не вместо них.

Значения метрик (все source: "api"):
• fresh_video_count — видео за 90 дней → насыщенность. Много = конкурентно. Мало = узко.
• median_views_per_video — медиана просмотров свежих видео → потенциал охвата
• newcomer_share — доля каналов в топе, созданных < 12 мес. → пробиваемость (0.0–1.0)
• top_subs_median — медиана подписчиков топ-каналов → сила конкурентов
• growth_ratio — (медиана просм/день свежих) / (медиана просм/день старых): нормировано на возраст видео; >1 растёт, <1 стагнирует, null = нет данных
• reliable — true/false. Если false — выборка слишком мала (< 5 каналов или < 5 видео).
  Такие подниши НЕЛЬЗЯ рекомендовать как рыночный факт — только упомянуть с оговоркой.

Признак «пробиваемой растущей» ниши: newcomer_share > 0.3, growth_ratio > 1.0, reliable = true.
Признак «закрытой» ниши: newcomer_share < 0.1, top_subs_median > 500 000.

ЗАПРЕТ: Никогда не использовать машинные имена полей (newcomer_share, median_views_per_video, top_subs_median, growth_ratio, fresh_video_count) в тексте вывода.
Пиши по-русски: «доля новых каналов», «медиана просмотров», «медиана подписчиков», «коэффициент роста», «видео за 90 дней».
Правильно: «Доля новых каналов — 88%, медиана просмотров — 2 463.»
Неправильно: «newcomer_share = 0.88, median_views = 2 463.»

ФОРМАТ — строго JSON без markdown:
{"ranking":[{"name":"Название","summary":"2-3 предложения с реальными числами: почему эта позиция в рейтинге","recommendation":"Конкретный совет: что снимать, как часто, на что акцент"}],"overall_advice":"2-3 предложения: общий вывод по рынку ниши"}

Включи 5 лучших надёжных ниш и 2-3 «избегать» (пометь их в summary: «Избегать: ...»).
Если все топ-5 кандидаты ненадёжны — напиши об этом в overall_advice.
Только JSON. Начни с {.`
    : `You are a YouTube analyst. You'll receive sub-niche data with real YouTube API numbers.
Task: rank and recommend BASED ON the numbers, not instead of them.

Metric meanings (all source: "api"):
• fresh_video_count — videos in 90 days → saturation. High = competitive. Low = niche too narrow.
• median_views_per_video — median views of fresh videos → reach potential
• newcomer_share — fraction of top channels created < 12 months → entry openness (0.0–1.0)
• top_subs_median — median subscribers of top channels → competitor strength
• growth_ratio — median fresh views / median old views: >1 growing, <1 stagnating, null = no data
• reliable — true/false. If false — sample too small (< 5 channels or < 5 videos).
  Such niches CANNOT be recommended as market facts — only mention with a caveat.

"Open growing" niche signal: newcomer_share > 0.3, growth_ratio > 1.0, reliable = true.
"Closed" niche signal: newcomer_share < 0.1, top_subs_median > 500 000.

PROHIBITION: Never use machine field names (newcomer_share, median_views_per_video, top_subs_median, growth_ratio, fresh_video_count) in output text.
Use plain English: "newcomer share", "median views", "median subscribers", "growth ratio", "videos in 90 days".
Correct: "Newcomer share is 88%, median views 2,463."
Incorrect: "newcomer_share = 0.88, median_views = 2,463."

FORMAT — strict JSON without markdown:
{"ranking":[{"name":"Name","summary":"2-3 sentences with real numbers: why this ranking position","recommendation":"Specific advice: what to film, how often, where to focus"}],"overall_advice":"2-3 sentences: overall market takeaway for this niche"}

Include top 5 reliable niches and 2-3 "avoid" entries (mark them in summary: "Avoid: ...").
If all top-5 candidates are unreliable — state so in overall_advice.
JSON only. Start with {.`
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubNicheInput {
  name:         string
  search_query: string  // short 2-3 word YouTube search term (new in v2)
  rpm_level:    string
  rpm_range?:   string
  rpm_reason:   string
}

type Source = 'api' | 'estimate'

interface MetricValue<T> { value: T; source: Source }

interface SubNicheResult {
  name:         string
  search_query: string
  reliable:     boolean
  fetch_error:  string | null
  sample_size:  { videos: number; channels: number }
  metrics: {
    fresh_video_count:      MetricValue<number>
    median_views_per_video: MetricValue<number>
    newcomer_share:         MetricValue<number>
    top_subs_median:        MetricValue<number>
    growth_ratio:           MetricValue<number | null>
    sample_age_days:        { fresh: number | null; old: number | null }
  }
  rpm_estimate: {
    level:  MetricValue<string>
    range?: MetricValue<string>
    reason: MetricValue<string>
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let lang       = 'ru'
  let userHasKey = false
  let plan       = 'free'
  let quotaUsed  = 0

  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as {
      broad_niche?: string; country?: string; content_lang?: string; ui_lang?: string; direction?: string; niche_count?: number
    }
    const broad_niche  = body.broad_niche?.trim() ?? ''
    lang               = body.ui_lang ?? 'ru'
    const country      = body.country      ?? 'RU'
    const content_lang = body.content_lang ?? 'ru'
    const direction    = body.direction?.trim() || undefined
    const niche_count: 20 | 30 | 40 = ([20, 30, 40] as const).includes(body.niche_count as 20 | 30 | 40)
      ? body.niche_count as 20 | 30 | 40
      : 20

    if (!broad_niche) {
      return NextResponse.json(
        { ok: false, error: lang !== 'en' ? 'Укажите широкую нишу' : 'Enter a broad niche' },
        { status: 400 }
      )
    }

    const svc = createServiceClient()
    const ctx = await resolveAnalyticsContext(user.id, svc, lang)
    const { gateRes, apiKey, cost } = ctx
    userHasKey = ctx.userHasKey
    plan       = ctx.plan
    if (gateRes) return gateRes

    // BYOK-only gate: quota per run scales with niche_count, too much to draw from shared key.
    if (!userHasKey) {
      const isRu = lang !== 'en'
      const quotaEst = niche_count * 105
      return NextResponse.json({
        ok:           false,
        error:        isRu
          ? `Анализ подниш использует до ${quotaEst} единиц вашей дневной YouTube API-квоты и доступен только с вашим ключом. Добавьте ключ в Настройках — и получите скидку 30% на все аналитические отчёты.`
          : `Sub-niche analysis uses up to ${quotaEst} YouTube API units from your daily quota and requires your own key. Add your key in Settings — you'll also get a 30% discount on all analytics.`,
        code:         'byok_required',
        settings_url: '/settings',
        quota_budget: quotaEst,
      }, { status: 403 })
    }

    // ytf: BYOK key only, with exponential back-off on 429 rate-limit.
    // 429 = edge-rejected (no quota consumed); 403 = quota exhausted → do not retry.
    async function ytf(path: string, params: Record<string, string>): Promise<unknown> {
      for (let attempt = 0; ; attempt++) {
        try {
          return await ytFetch(path, params, apiKey)
        } catch (e) {
          if (e instanceof YouTubeRateLimitError && attempt < RATE_LIMIT_DELAYS.length) {
            console.warn(`[sub-niche] 429 on ${path}, retry ${attempt + 1} after ${RATE_LIMIT_DELAYS[attempt]}ms`)
            await new Promise(r => setTimeout(r, RATE_LIMIT_DELAYS[attempt]))
            continue
          }
          throw e
        }
      }
    }

    // ── Cache check ────────────────────────────────────────────────────────
    // v2: cache key bumped because algorithm changed (search_query, reliable flag)
    // direction-scoped and count-scoped runs get their own cache entry
    const dirPart  = direction ? `|dir:${direction.toLowerCase().trim()}` : ''
    const cacheKey = `${broad_niche.toLowerCase().trim()}|${country}|${content_lang}${dirPart}|n:${niche_count}|v2`
    try {
      const { data: cached } = await svc
        .from('analytics_cache')
        .select('result, created_at')
        .eq('cache_type', 'sub_niche_finder')
        .eq('cache_key', cacheKey)
        .gt('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
        .maybeSingle()
      if (cached) {
        console.log('[sub-niche] cache hit')
        try {
          const { data: existing } = await svc
            .from('analytics_reports')
            .select('id')
            .eq('user_id', user.id)
            .eq('report_type', 'sub_niche_finder')
            .eq('query', broad_niche)
            .gte('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
            .maybeSingle()
          if (!existing) {
            const { data: old } = await svc
              .from('analytics_reports').select('id')
              .eq('user_id', user.id).eq('report_type', 'sub_niche_finder')
              .order('created_at', { ascending: true })
            if ((old?.length ?? 0) >= 20) await svc.from('analytics_reports').delete().eq('id', old![0].id)
            await svc.from('analytics_reports').insert({
              user_id: user.id, report_type: 'sub_niche_finder',
              title: direction ? `Подниши: ${broad_niche} → ${direction}` : `Подниши: ${broad_niche}`,
              query: broad_niche, result: cached.result,
            })
          } else {
            console.log('[sub-niche] cache-hit: report already saved recently, skip')
          }
        } catch (e) {
          console.warn('[sub-niche] cache-hit report save failed:', e instanceof Error ? e.message : String(e))
        }
        return NextResponse.json({ ok: true, data: cached.result, cached: true })
      }
    } catch (e) {
      console.warn('[sub-niche] cache check skipped:', e instanceof Error ? e.message : String(e))
    }

    // ── Credits gate ───────────────────────────────────────────────────────
    const actualCost = cost(CREDIT_COSTS.sub_niche_finder)
    const check = await requireCreditsAmount(user.id, actualCost, supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    const uiLangFull = resolveUserLang(req, lang)
    const anthropic  = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: 120_000 })

    // ── Step 1: Haiku — broad niche (+ optional direction) → niche_count sub-niches ──
    console.log(`[sub-niche] step 1: haiku gen | broad="${broad_niche}" dir="${direction ?? ''}" count=${niche_count} country=${country} lang=${content_lang}`)
    const directionHint = direction
      ? ` Направление: "${direction}". Генерируй подниши ТОЛЬКО внутри этого направления, не выходи за его рамки.`
      : ''
    const haikuMaxTokens = niche_count >= 40 ? 4000 : niche_count >= 30 ? 3000 : 2500
    const msg1 = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: haikuMaxTokens,
      system: [{ type: 'text', text: getSubNicheGenPrompt(lang, niche_count), cache_control: { type: 'ephemeral' } }],
      messages: [{
        role:    'user',
        content: `Ниша: "${broad_niche}".${directionHint} Рынок: ${country}. Язык контента: ${content_lang}.${langNote(uiLangFull)}`,
      }],
    })
    console.log('[sub-niche] haiku tokens in:', msg1.usage.input_tokens, 'out:', msg1.usage.output_tokens)
    if (msg1.stop_reason === 'max_tokens') console.warn('[sub-niche] haiku truncated')

    const { sub_niches: rawNiches } = parseClaudeJson<{ sub_niches: SubNicheInput[] }>(
      extractText(msg1.content), 'haiku-gen'
    )
    if (!rawNiches?.length) throw new Error('Haiku returned no sub-niches')
    // Ensure search_query falls back to name if Haiku omitted it
    const sub_niches: SubNicheInput[] = rawNiches.slice(0, niche_count).map(n => ({
      ...n,
      search_query: n.search_query?.trim() || n.name,
    }))
    console.log(`[sub-niche] haiku: ${sub_niches.length} sub-niches generated`)

    // ── Steps 2 + 3: search.list + videos.list + channels.list (parallel per niche) ──
    const nowMs               = Date.now()
    const publishedAfterFresh = new Date(nowMs - FRESH_DAYS * 24 * 3600 * 1000).toISOString()

    const searchBase: Record<string, string> = {
      part: 'snippet', type: 'video', order: 'viewCount',
      maxResults: '50', publishedAfter: publishedAfterFresh,
    }
    if (country !== 'worldwide') searchBase.regionCode = country
    if (content_lang && content_lang !== 'auto') searchBase.relevanceLanguage = content_lang

    interface RawEnriched {
      name:                string
      search_query:        string
      rpm_level:           string
      rpm_range:           string
      rpm_reason:          string
      fresh_video_count:   number
      views:               number[]   // raw view counts for median_views_per_video
      views_vpd:           number[]   // views/day per video (age-normalized, for growth_ratio)
      fresh_ages:          number[]   // video age in days, parallel to views_vpd
      channel_ages_months: number[]
      subs:                number[]
      fetch_error:         string | null  // non-null when data collection failed after retries
    }

    console.log(`[sub-niche] step 2+3: enrich ${sub_niches.length} niches (concurrency=${ENRICH_CONCURRENCY})`)
    const enriched: RawEnriched[] = []
    for (let eBatch = 0; eBatch < sub_niches.length; eBatch += ENRICH_CONCURRENCY) {
      const batchNiches = sub_niches.slice(eBatch, eBatch + ENRICH_CONCURRENCY)
      enriched.push(...await Promise.all(batchNiches.map(async (niche) => {
      const base: RawEnriched = {
        name: niche.name, search_query: niche.search_query,
        rpm_level: niche.rpm_level, rpm_range: niche.rpm_range ?? '', rpm_reason: niche.rpm_reason,
        fresh_video_count: 0, views: [], views_vpd: [], fresh_ages: [], channel_ages_months: [], subs: [],
        fetch_error: null,
      }
      try {
        // Step 2: search by search_query (short, user-like term) — 100 units
        const search = await ytf('/search', { ...searchBase, q: niche.search_query }) as {
          items?:    Array<{ id: { videoId?: string }; snippet: { channelId?: string; publishedAt?: string } }>
          pageInfo?: { totalResults: number }
        }
        quotaUsed += 100
        base.fresh_video_count = search.pageInfo?.totalResults ?? 0

        // Build publishedAt map for age-normalized views/day computation (zero extra API calls)
        const freshPubMap = new Map<string, string>()
        for (const item of search.items ?? []) {
          if (item.id?.videoId && item.snippet?.publishedAt) {
            freshPubMap.set(item.id.videoId, item.snippet.publishedAt)
          }
        }

        const videoIds   = (search.items ?? []).map(v => v.id?.videoId).filter((id): id is string => !!id)
        const channelIds = [...new Set(
          (search.items ?? []).map(v => v.snippet?.channelId).filter((id): id is string => !!id)
        )]

        // Step 3a: videos.list — 1 unit per batch of 50
        for (const batch of chunks(videoIds, 50)) {
          const vRes = await ytf('/videos', { part: 'statistics', id: batch.join(',') }) as {
            items?: Array<{ id: string; statistics: { viewCount?: string } }>
          }
          quotaUsed += 1
          for (const v of vRes.items ?? []) {
            const vc = parseInt(v.statistics.viewCount ?? '0')
            if (vc > 0) {
              base.views.push(vc)
              const pub = freshPubMap.get(v.id)
              if (pub) {
                const age = Math.max(1, daysOld(pub))
                base.views_vpd.push(vc / age)
                base.fresh_ages.push(age)
              }
            }
          }
        }

        // Step 3b: channels.list — 1 unit per batch of 50
        for (const batch of chunks(channelIds, 50)) {
          const cRes = await ytf('/channels', { part: 'statistics,snippet', id: batch.join(',') }) as {
            items?: Array<{
              snippet:    { publishedAt?: string }
              statistics: { subscriberCount?: string }
            }>
          }
          quotaUsed += 1
          for (const c of cRes.items ?? []) {
            if (c.snippet.publishedAt) base.channel_ages_months.push(daysOld(c.snippet.publishedAt) / 30)
            const sc = parseInt(c.statistics.subscriberCount ?? '0')
            if (sc > 0) base.subs.push(sc)
          }
        }
      } catch (e) {
        if (e instanceof YouTubeQuotaError) throw e
        const msg = e instanceof Error ? e.message : String(e)
        base.fetch_error = msg.slice(0, 120)
        console.warn(`[sub-niche] enrich failed for "${niche.name}":`, msg.slice(0, 120))
      }
      return base
    })))
      if (eBatch + ENRICH_CONCURRENCY < sub_niches.length) {
        await new Promise(r => setTimeout(r, ENRICH_BATCH_DELAY))
      }
    }

    console.log(`[sub-niche] after step 3: quota_used=${quotaUsed}`)

    // ── Step 4: Compute API-sourced metrics (no model) ─────────────────────
    interface ComputedNiche {
      name:             string
      search_query:     string
      rpm_level:        string
      rpm_range:        string
      rpm_reason:       string
      fresh_video_count: number
      median_views:     number
      newcomer_share:   number
      top_subs_median:  number
      growth_ratio:     number | null
      median_age_fresh: number | null  // median age of fresh cohort (days); visible in response to catch future bias
      median_age_old:   number | null  // median age of old cohort (days); set in Step 5
      views_vpd:        number[]       // views/day per fresh video; consumed by Step 5 growth ratio
      fetch_error:      string | null  // non-null if data collection failed
      sample_videos:    number
      sample_channels:  number
      reliable:         boolean
    }

    const computed: ComputedNiche[] = enriched.map(n => {
      const sample_videos   = n.views.length
      const sample_channels = n.channel_ages_months.length
      const reliable        = sample_videos >= 5 && sample_channels >= MIN_CHANNELS_RELIABLE
      return {
        name:              n.name,
        search_query:      n.search_query,
        rpm_level:         n.rpm_level,
        rpm_range:         n.rpm_range,
        rpm_reason:        n.rpm_reason,
        fresh_video_count: n.fresh_video_count,
        median_views:      medianOf(n.views),
        newcomer_share:    sample_channels > 0
          ? Math.round(n.channel_ages_months.filter(m => m < 12).length / sample_channels * 100) / 100
          : 0,
        top_subs_median:   medianOf(n.subs),
        growth_ratio:      null,
        median_age_fresh:  n.fresh_ages.length > 0 ? Math.round(medianOf(n.fresh_ages)) : null,
        median_age_old:    null,
        views_vpd:         n.views_vpd,
        fetch_error:       n.fetch_error,
        sample_videos,
        sample_channels,
        reliable,
      }
    })

    const reliableCount = computed.filter(n => n.reliable).length
    console.log(`[sub-niche] step 4: ${reliableCount}/${computed.length} reliable niches`)

    // ── Step 5: Growth ratio for top 5 (reliable niches only, by newcomer_share) ──
    // Exclude unreliable niches from growth analysis — their newcomer_share is noise.
    const top5 = [...computed]
      .filter(n => n.reliable && n.fresh_video_count > 0 && n.median_views > 0)
      .sort((a, b) => b.newcomer_share - a.newcomer_share || b.median_views - a.median_views)
      .slice(0, 5)
    const top5Names = new Set(top5.map(n => n.name))

    const publishedAfterOld = new Date(nowMs - OLD_DAYS * 24 * 3600 * 1000).toISOString()
    console.log(`[sub-niche] step 5: growth ratio for ${top5Names.size} reliable top niches`)

    const top5Niches = computed.filter(n => top5Names.has(n.name))
    for (let gBatch = 0; gBatch < top5Niches.length; gBatch += GROWTH_CONCURRENCY) {
      await Promise.all(top5Niches.slice(gBatch, gBatch + GROWTH_CONCURRENCY).map(async (niche) => {
          try {
            const searchOld = await ytf('/search', {
              ...searchBase,
              q:              niche.search_query,
              publishedAfter: publishedAfterOld,
            }) as {
              items?: Array<{ id: { videoId?: string }; snippet: { publishedAt?: string } }>
            }
            quotaUsed += 100

            // Build old publishedAt map for age-normalized growth ratio (zero extra API calls)
            const oldPubMap = new Map<string, string>()
            const oldVideoIds = (searchOld.items ?? [])
              .filter(v => v.snippet?.publishedAt && daysOld(v.snippet.publishedAt) >= FRESH_DAYS)
              .map(v => {
                if (v.id?.videoId && v.snippet?.publishedAt) {
                  oldPubMap.set(v.id.videoId, v.snippet.publishedAt)
                }
                return v.id?.videoId
              })
              .filter((id): id is string => !!id)

            const oldViews: number[] = []   // raw views — for MIN_OLD_SAMPLE_GROWTH guard
            const oldVpd:   number[] = []   // views/day — for age-normalized growth_ratio
            const oldAges:  number[] = []   // ages in days — for median_age_old
            for (const batch of chunks(oldVideoIds, 50)) {
              const vOld = await ytf('/videos', { part: 'statistics', id: batch.join(',') }) as {
                items?: Array<{ id: string; statistics: { viewCount?: string } }>
              }
              quotaUsed += 1
              for (const v of vOld.items ?? []) {
                const vc = parseInt(v.statistics.viewCount ?? '0')
                if (vc > 0) {
                  oldViews.push(vc)
                  const pub = oldPubMap.get(v.id)
                  if (pub) {
                    const age = Math.max(1, daysOld(pub))
                    oldVpd.push(vc / age)
                    oldAges.push(age)
                  }
                }
              }
            }

            // growth_ratio = median(fresh vpd) / median(old vpd): measures velocity not accumulation
            const medianFreshVpd = medianOf(niche.views_vpd)
            const medianOldVpd   = medianOf(oldVpd)
            // Require minimum sample for growth_ratio to be meaningful
            if (medianOldVpd > 0 && oldViews.length >= MIN_OLD_SAMPLE_GROWTH) {
              niche.growth_ratio   = Math.round((medianFreshVpd / medianOldVpd) * 100) / 100
              niche.median_age_old = Math.round(medianOf(oldAges))
            }
          } catch (e) {
            if (e instanceof YouTubeQuotaError) throw e
            console.warn(`[sub-niche] growth failed for "${niche.name}":`, e instanceof Error ? e.message : String(e))
          }
      }))
      if (gBatch + GROWTH_CONCURRENCY < top5Niches.length) {
        await new Promise(r => setTimeout(r, GROWTH_BATCH_DELAY))
      }
    }

    console.log(`[sub-niche] after step 5: quota_used=${quotaUsed}`)

    // ── Step 6: Sonnet verdict — ranks based on computed numbers ──────────
    const dataForVerdict = computed.map(n => ({
      name:                   n.name,
      reliable:               n.reliable,
      sample_size:            { videos: n.sample_videos, channels: n.sample_channels },
      fresh_video_count:      n.fresh_video_count,
      median_views_per_video: n.median_views,
      newcomer_share:         n.newcomer_share,
      top_subs_median:        n.top_subs_median,
      growth_ratio:           n.growth_ratio,
    }))

    const dirCtx = direction
      ? (lang === 'en' ? `\nDirection: "${direction}"` : `\nНаправление: "${direction}"`)
      : ''
    const dataCtx = lang === 'en'
      ? `Broad niche: "${broad_niche}"${dirCtx}\nMarket: ${country}\n\nSub-niche data (real YouTube API numbers):\n${JSON.stringify(dataForVerdict, null, 2)}`
      : `Широкая ниша: "${broad_niche}"${dirCtx}\nРынок: ${country}\n\nДанные подниш (реальные числа из YouTube API):\n${JSON.stringify(dataForVerdict, null, 2)}`

    console.log('[sub-niche] step 6: sonnet verdict')
    const msg2 = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2500,
      system: [{ type: 'text', text: getVerdictPrompt(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: dataCtx + langNote(uiLangFull) }],
    })
    console.log('[sub-niche] sonnet tokens in:', msg2.usage.input_tokens, 'out:', msg2.usage.output_tokens)
    if (msg2.stop_reason === 'max_tokens') console.warn('[sub-niche] sonnet truncated')

    const { ranking, overall_advice } = parseClaudeJson<{
      ranking:        Array<{ name: string; summary: string; recommendation: string }>
      overall_advice: string
    }>(extractText(msg2.content), 'sonnet-verdict')

    // ── Build result — every field tagged with source ──────────────────────
    const sub_niche_results: SubNicheResult[] = computed.map(n => ({
      name:         n.name,
      search_query: n.search_query,
      reliable:     n.reliable,
      fetch_error:  n.fetch_error,
      sample_size:  { videos: n.sample_videos, channels: n.sample_channels },
      metrics: {
        fresh_video_count:      { value: n.fresh_video_count, source: 'api'      as const },
        median_views_per_video: { value: n.median_views,      source: 'api'      as const },
        newcomer_share:         { value: n.newcomer_share,    source: 'api'      as const },
        top_subs_median:        { value: n.top_subs_median,   source: 'api'      as const },
        growth_ratio:           { value: n.growth_ratio,      source: 'api'      as const },
        sample_age_days:        { fresh: n.median_age_fresh,  old: n.median_age_old },
      },
      rpm_estimate: {
        level:  { value: n.rpm_level,  source: 'estimate' as const },
        range:  { value: n.rpm_range,  source: 'estimate' as const },
        reason: { value: n.rpm_reason, source: 'estimate' as const },
      },
    }))

    const result = {
      broad_niche,
      direction:      direction ?? null,
      quota_used:    quotaUsed,
      analyzed_at:   new Date().toISOString(),
      reliable_count: reliableCount,
      sub_niches:    sub_niche_results,
      verdict: {
        ranking:        ranking        ?? [],
        overall_advice: overall_advice ?? '',
        source:         'estimate'     as const,
      },
    }

    // ── Spend credits ────────────────────────────────────────────────────
    await spendCredits(user.id, actualCost, 'sub_niche_finder')

    // ── Cache write (non-fatal) ──────────────────────────────────────────
    try {
      await svc.from('analytics_cache').upsert({
        cache_type:  'sub_niche_finder',
        cache_key:   cacheKey,
        result,
        created_at:  new Date().toISOString(),
      }, { onConflict: 'cache_type,cache_key' })
    } catch (e) {
      console.warn('[sub-niche] cache write failed:', e instanceof Error ? e.message : String(e))
    }

    // ── Save to analytics_reports (non-fatal, cap 20) ────────────────────
    try {
      const { data: old } = await svc
        .from('analytics_reports').select('id')
        .eq('user_id', user.id).eq('report_type', 'sub_niche_finder')
        .order('created_at', { ascending: true })
      if ((old?.length ?? 0) >= 20) await svc.from('analytics_reports').delete().eq('id', old![0].id)
      const { error: saveErr } = await svc.from('analytics_reports').insert({
        user_id:     user.id,
        report_type: 'sub_niche_finder',
        title:       direction ? `Подниши: ${broad_niche} → ${direction}` : `Подниши: ${broad_niche}`,
        query:       broad_niche,
        result,
      })
      if (saveErr) console.warn('[sub-niche] report save error:', JSON.stringify(saveErr))
    } catch (e) {
      console.warn('[sub-niche] report save exception:', e instanceof Error ? e.message : String(e))
    }

    // ── Cleanup stale cache entries for this type (non-fatal) ────────────
    try {
      await svc.from('analytics_cache')
        .delete()
        .eq('cache_type', 'sub_niche_finder')
        .lt('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
    } catch { /* ignore */ }

    console.log(`[sub-niche] done. quota_used=${quotaUsed} cost=${actualCost}cr reliable=${reliableCount}/${sub_niche_results.length}`)
    return NextResponse.json({ ok: true, data: result })

  } catch (error) {
    if (error instanceof YouTubeQuotaError) return byokQuotaResponse(lang)
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/sub-niche-finder] error:', msg)
    if (isYouTubeKeyError(msg)) return youTubeKeyErrorResponse(lang)
    if (isBillingError(msg)) {
      await notifyBillingError('Anthropic', '/analytics/sub-niche-finder').catch(() => {})
    }
    return NextResponse.json({ ok: false, error: 'Сервис временно недоступен — попробуйте позже' }, { status: 500 })
  }
}
