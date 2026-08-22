import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'
import { parseClaudeJson } from '@/lib/parse-claude-json'
import {
  YouTubeQuotaError,
  isYouTubeKeyError, youTubeKeyErrorResponse,
} from '@/lib/youtube-quota'
import { resolveAnalyticsContext, byokRequiredResponse } from '@/lib/analytics-gate'
import { isBillingError, notifyBillingError } from '@/lib/telegram'

export const maxDuration = 120

const YT_BASE               = 'https://www.googleapis.com/youtube/v3'
const BATCH_SIZE            = 5
const BATCH_DELAY           = 600  // ms
const SPREAD_OUTLIER_THRESHOLD = 100  // spread above this = single viral outlier, unreproducible

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChannelRaw {
  id:               string
  title:            string
  subs:             number
  age_months:       number
  uploads_playlist: string
}

interface VideoRaw {
  id:         string
  title:      string
  published:  string  // ISO
  views:      number
  duration_s: number
}

interface ChannelMetrics {
  id:                  string
  title:               string
  age_months:          number
  subs:                number
  months_to_1k:        number | null
  views_per_video:     number | null
  upload_frequency:    number | null
  spread:              number | null
  days_to_first_hit:   number | null
  videos_to_first_hit: number | null  // horizontal vids published before first hit
  shorts_share:        number
  horizontal_count:    number
  shorts_count:        number
  is_shorts_only:      boolean        // 100% Shorts, no horizontal content
  is_spread_outlier:   boolean        // spread > SPREAD_OUTLIER_THRESHOLD
  top_videos:          Array<{ title: string; views: number; days_from_start: number }>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDurationSeconds(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return (parseInt(m[1] ?? '0') * 3600) + (parseInt(m[2] ?? '0') * 60) + parseInt(m[3] ?? '0')
}

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)) }

async function ytFetch(path: string, params: Record<string, string | number>, apiKey: string): Promise<unknown> {
  const url = new URL(YT_BASE + path)
  url.searchParams.set('key', apiKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const res = await fetch(url.toString())
  if (res.status === 403) {
    const body = await res.json().catch(() => ({})) as { error?: { errors?: Array<{ reason?: string }> } }
    const reasons = body.error?.errors?.map(e => e.reason ?? '') ?? []
    if (reasons.includes('quotaExceeded') || reasons.includes('dailyLimitExceeded')) throw new YouTubeQuotaError()
    if (reasons.includes('keyInvalid')) throw new Error('keyInvalid')
  }
  if (res.status === 429) throw Object.assign(new Error('rateLimited'), { status: 429 })
  if (!res.ok) throw new Error(`YouTube ${res.status}`)
  return res.json()
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
}

// ─── Verdict prompt ───────────────────────────────────────────────────────────

function getBreakoutVerdictPrompt(
  lang: string,
  sub_niche_name: string,
  channelMetrics: ChannelMetrics[],
  summary: {
    newcomer_count:             number
    under_5mo_past_1k:          number
    median_months_to_1k:        number | null
    median_views_per_video:     number | null
    median_upload_frequency:    number | null
    median_shorts_share:        number
    median_videos_to_first_hit: number | null
    shorts_only_count:          number
    spread_outlier_count:       number
  },
  niche_context?: {
    newcomer_share: number | null
    median_views:   number
    growth_ratio:   number | null
  }
): string {
  const isRu = lang !== 'en'

  // Main channels (not Shorts-only, not outliers) — reliable for patterns
  const mainChannels  = channelMetrics.filter(c => !c.is_shorts_only && !c.is_spread_outlier)
  const shortsOnly    = channelMetrics.filter(c => c.is_shorts_only)
  const outliers      = channelMetrics.filter(c => c.is_spread_outlier)

  const formatChannel = (c: ChannelMetrics) => {
    const lines: string[] = [
      `• ${c.title} (${c.age_months.toFixed(1)} мес., ${c.subs.toLocaleString()} подп.)`,
    ]
    if (c.months_to_1k !== null)        lines.push(`  до 1 000 подп.: ${c.months_to_1k.toFixed(1)} мес.`)
    if (c.views_per_video !== null)     lines.push(`  просм./видео (медиана горизонт.): ${Math.round(c.views_per_video).toLocaleString()}`)
    if (c.upload_frequency !== null)    lines.push(`  частота: ${c.upload_frequency.toFixed(2)} вид/нед`)
    if (c.spread !== null)              lines.push(`  разброс (макс/медиана): ${c.spread.toFixed(1)}×`)
    if (c.videos_to_first_hit !== null) lines.push(`  горизонт. видео до первого хита: ${c.videos_to_first_hit}`)
    if (c.days_to_first_hit !== null)   lines.push(`  дней до первого хита: ${c.days_to_first_hit}`)
    lines.push(`  Shorts: ${(c.shorts_share * 100).toFixed(0)}%`)
    if (c.top_videos.length) {
      lines.push(`  топ видео:`)
      c.top_videos.forEach(v => lines.push(`    - "${v.title}" — ${v.views.toLocaleString()} просм. (+${v.days_from_start} дн.)`))
    }
    return lines.join('\n')
  }

  const mainList    = mainChannels.map(formatChannel).join('\n\n')
  const outlierList = outliers.map(c =>
    `• ${c.title} (${c.age_months.toFixed(1)} мес.) — разброс ${c.spread?.toFixed(0)}×, исключён из сводки`
  ).join('\n')
  const shortsList  = shortsOnly.map(c =>
    `• ${c.title} (${c.age_months.toFixed(1)} мес., ${c.subs.toLocaleString()} подп.) — только Shorts`
  ).join('\n')

  const shareStr = (nc: { newcomer_share: number | null }, isRu: boolean): string =>
    nc.newcomer_share !== null
      ? (isRu ? `пробиваемость ${Math.round(nc.newcomer_share * 100)}%` : `penetration ${Math.round(nc.newcomer_share * 100)}%`)
      : (isRu ? 'пробиваемость: нет данных' : 'penetration: no data')
  const nicheCtxLine = niche_context
    ? isRu
      ? `Обещанное поднишей (L2): ${shareStr(niche_context, true)}, медиана просмотров ${Math.round(niche_context.median_views).toLocaleString()}, рост ${niche_context.growth_ratio !== null ? niche_context.growth_ratio.toFixed(2) + '×' : 'нет данных'}`
      : `Sub-niche (L2) promise: ${shareStr(niche_context, false)}, median views ${Math.round(niche_context.median_views).toLocaleString()}, growth ${niche_context.growth_ratio !== null ? niche_context.growth_ratio.toFixed(2) + '×' : 'no data'}`
    : ''

  if (isRu) {
    return `Ты аналитик YouTube. Дай аналитический вывод по новичковым каналам в нише «${sub_niche_name}».

${nicheCtxLine ? 'КОНТЕКСТ НИШИ:\n' + nicheCtxLine + '\n' : ''}
ДАННЫЕ СВОДКИ (медианы — только по основным каналам, без Shorts-only и без выбросов разброса):
- Всего новичков (< 12 мес.): ${summary.newcomer_count}
- Из них только Shorts: ${summary.shorts_only_count}; вирусных выбросов (разброс > ${SPREAD_OUTLIER_THRESHOLD}×): ${summary.spread_outlier_count}
- Набрали 1 000 подп. до 5 мес.: ${summary.under_5mo_past_1k}
- Медиана времени до 1 000 подп.: ${summary.median_months_to_1k !== null ? summary.median_months_to_1k.toFixed(1) + ' мес.' : 'нет данных'}
- Медиана просмотров/видео: ${summary.median_views_per_video !== null ? Math.round(summary.median_views_per_video).toLocaleString() : 'нет данных'}
- Медиана частоты публикаций: ${summary.median_upload_frequency !== null ? summary.median_upload_frequency.toFixed(2) + ' вид/нед' : 'нет данных'}
- Медиана видео до первого хита: ${summary.median_videos_to_first_hit !== null ? String(Math.round(summary.median_videos_to_first_hit)) : 'нет данных'}

ОСНОВНЫЕ КАНАЛЫ (${mainChannels.length}):
${mainList || 'нет'}

${outliers.length > 0 ? `ВИРУСНЫЕ ВЫБРОСЫ (исключены из сводки, ${outliers.length}):\n${outlierList}\n` : ''}
${shortsOnly.length > 0 ? `ТОЛЬКО SHORTS (исключены из сводки, ${shortsOnly.length}):\n${shortsList}\n` : ''}
ТРЕБОВАНИЯ:
1. Опирайся только на числа выше. Упомяни конкретные каналы и их числа там, где это подкрепляет вывод.
2. Заголовки видео указывай только как факт (жанр, тема) — без интерпретации, почему они сработали.
3. ЗАПРЕЩЕНО рассуждать о причинах успеха: ни обложки, ни хуки, ни подача, ни монтаж — если этого нет в числах, не упоминай.
4. ЗАПРЕЩЕНО использовать машинные имена полей. Переводи в естественный русский.
5. Если данных недостаточно — скажи об этом явно.
6. Подзаголовки в JSON пиши на РУССКОМ языке.
7. Ответ — только JSON без markdown:
{
  "growth_speed": "...",
  "content_cadence": "...",
  "view_concentration": "...",
  "shorts_role": "...",
  "overall": "..."
}`
  }

  return `You are a YouTube analyst. Provide an analytical verdict on newcomer channels in the niche "${sub_niche_name}".

${nicheCtxLine ? 'NICHE CONTEXT:\n' + nicheCtxLine + '\n' : ''}
SUMMARY DATA (medians exclude Shorts-only and spread-outlier channels):
- Total newcomers (< 12 months): ${summary.newcomer_count}
- Of which Shorts-only: ${summary.shorts_only_count}; viral outliers (spread > ${SPREAD_OUTLIER_THRESHOLD}×): ${summary.spread_outlier_count}
- Reached 1,000 subs within 5 months: ${summary.under_5mo_past_1k}
- Median time to 1,000 subs: ${summary.median_months_to_1k !== null ? summary.median_months_to_1k.toFixed(1) + ' months' : 'no data'}
- Median views/video: ${summary.median_views_per_video !== null ? Math.round(summary.median_views_per_video).toLocaleString() : 'no data'}
- Median upload frequency: ${summary.median_upload_frequency !== null ? summary.median_upload_frequency.toFixed(2) + ' vids/week' : 'no data'}
- Median videos before first hit: ${summary.median_videos_to_first_hit !== null ? String(Math.round(summary.median_videos_to_first_hit)) : 'no data'}

MAIN CHANNELS (${mainChannels.length}):
${mainList || 'none'}

${outliers.length > 0 ? `VIRAL OUTLIERS (excluded from summary, ${outliers.length}):\n${outlierList}\n` : ''}
${shortsOnly.length > 0 ? `SHORTS-ONLY (excluded from summary, ${shortsOnly.length}):\n${shortsList}\n` : ''}
REQUIREMENTS:
1. Rely only on the numbers above. Cite specific channels when they support a claim.
2. Video titles are facts only (genre, topic) — no interpretation of why they worked.
3. PROHIBITED: speculation about success causes — thumbnails, hooks, presentation, editing style. Not in numbers = not mentioned.
4. PROHIBITED: machine field names. Use natural language.
5. If data is insufficient on some aspect, say so explicitly.
6. Write section labels in ENGLISH.
7. Return only JSON, no markdown:
{
  "growth_speed": "...",
  "content_cadence": "...",
  "view_concentration": "...",
  "shorts_role": "...",
  "overall": "..."
}`
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let lang = 'ru'

  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as {
      channel_ids?:        string[]
      sub_niche_name?:     string
      niche_median_views?: number
      niche_context?:      { newcomer_share: number | null; median_views: number; growth_ratio: number | null }
      limit?:              20 | 50
      ui_lang?:            string
    }

    const channel_ids        = Array.isArray(body.channel_ids) ? body.channel_ids.slice(0, 50) : []
    const sub_niche_name     = body.sub_niche_name?.trim() ?? ''
    const niche_median_views = typeof body.niche_median_views === 'number' ? body.niche_median_views : 0
    const niche_context      = body.niche_context ?? undefined
    const limit: 20 | 50    = body.limit === 50 ? 50 : 20
    lang                     = body.ui_lang ?? 'ru'

    if (!channel_ids.length) {
      return NextResponse.json(
        { ok: false, error: lang !== 'en' ? 'Список каналов пуст' : 'Channel list is empty' },
        { status: 400 }
      )
    }
    if (!sub_niche_name) {
      return NextResponse.json(
        { ok: false, error: lang !== 'en' ? 'Укажите название подниши' : 'Provide sub-niche name' },
        { status: 400 }
      )
    }

    // ── Auth & billing gate ───────────────────────────────────────────────
    const svc = await createServiceClient()
    const ctx = await resolveAnalyticsContext(user.id, svc, lang)

    if (ctx.gateRes) return ctx.gateRes
    if (!ctx.userHasKey) return byokRequiredResponse(lang)

    const apiKey     = ctx.apiKey
    const actualCost = ctx.cost(CREDIT_COSTS.channel_breakout)

    const creditCheck = await requireCreditsAmount(user.id, actualCost, svc)
    if (!creditCheck.ok) {
      return NextResponse.json(
        { ok: false, error: creditCheck.error, code: 'insufficient_credits' },
        { status: 402 }
      )
    }

    // ── Step 1: channels.list ─────────────────────────────────────────────
    const idsToFetch = channel_ids.slice(0, limit)
    const channelRaws: ChannelRaw[] = []

    const CH_BATCH = 50
    for (let i = 0; i < idsToFetch.length; i += CH_BATCH) {
      const batch = idsToFetch.slice(i, i + CH_BATCH)
      const data = await ytFetch('/channels', {
        part: 'snippet,statistics,contentDetails',
        id:   batch.join(','),
      }, apiKey) as {
        items?: Array<{
          id: string
          snippet: { title?: string; publishedAt?: string }
          statistics: { subscriberCount?: string }
          contentDetails: { relatedPlaylists?: { uploads?: string } }
        }>
      }

      for (const ch of data.items ?? []) {
        const publishedAt = ch.snippet.publishedAt
        if (!publishedAt) continue
        const ageMs      = Date.now() - new Date(publishedAt).getTime()
        const ageMonths  = ageMs / (1000 * 60 * 60 * 24 * 30.44)
        const uploadsId  = ch.contentDetails.relatedPlaylists?.uploads ?? ''
        if (!uploadsId) continue
        channelRaws.push({
          id:               ch.id,
          title:            ch.snippet.title ?? ch.id,
          subs:             parseInt(ch.statistics.subscriberCount ?? '0'),
          age_months:       ageMonths,
          uploads_playlist: uploadsId,
        })
      }
    }

    if (!channelRaws.length) {
      return NextResponse.json(
        { ok: false, error: lang !== 'en' ? 'Каналы не найдены в YouTube API' : 'No channels found in YouTube API' },
        { status: 404 }
      )
    }

    // ── Step 2: Per-channel video fetch (batched with delay + retry) ──────
    const channelMetricsAll: ChannelMetrics[] = []

    for (let i = 0; i < channelRaws.length; i += BATCH_SIZE) {
      if (i > 0) await sleep(BATCH_DELAY)
      const batch = channelRaws.slice(i, i + BATCH_SIZE)

      await Promise.all(batch.map(async ch => {
        try {
          const channelCreatedMs = Date.now() - ch.age_months * 30.44 * 24 * 3600 * 1000

          // 2a: playlistItems
          let piData: { items?: Array<{ snippet?: { resourceId?: { videoId?: string }; publishedAt?: string } }> } = {}
          for (let r = 0; r < 3; r++) {
            try {
              piData = await ytFetch('/playlistItems', {
                part:       'snippet',
                playlistId: ch.uploads_playlist,
                maxResults: 50,
              }, apiKey) as typeof piData
              break
            } catch (e: unknown) {
              if (e instanceof YouTubeQuotaError) throw e
              const status = (e as { status?: number }).status
              if (status === 429 && r < 2) { await sleep(BATCH_DELAY * (r + 2)); continue }
              throw e
            }
          }

          const videoItems = (piData.items ?? [])
            .filter(it => it.snippet?.resourceId?.videoId)
            .map(it => ({ videoId: it.snippet!.resourceId!.videoId!, published: it.snippet!.publishedAt ?? '' }))

          if (!videoItems.length) return

          // 2b: videos.list
          const videosRaw: VideoRaw[] = []
          for (let vi = 0; vi < videoItems.length; vi += 50) {
            const vbatch = videoItems.slice(vi, vi + 50)
            const vids   = vbatch.map(v => v.videoId).join(',')
            const pubMap = new Map(vbatch.map(v => [v.videoId, v.published]))

            let vData: { items?: Array<{
              id: string
              snippet?: { title?: string }
              statistics?: { viewCount?: string }
              contentDetails?: { duration?: string }
            }> } = {}
            for (let r = 0; r < 3; r++) {
              try {
                vData = await ytFetch('/videos', {
                  part: 'snippet,statistics,contentDetails',
                  id:   vids,
                }, apiKey) as typeof vData
                break
              } catch (e: unknown) {
                if (e instanceof YouTubeQuotaError) throw e
                const status = (e as { status?: number }).status
                if (status === 429 && r < 2) { await sleep(BATCH_DELAY * (r + 2)); continue }
                throw e
              }
            }

            for (const v of vData.items ?? []) {
              videosRaw.push({
                id:         v.id,
                title:      v.snippet?.title ?? '',
                published:  pubMap.get(v.id) ?? '',
                views:      parseInt(v.statistics?.viewCount ?? '0'),
                duration_s: parseDurationSeconds(v.contentDetails?.duration ?? ''),
              })
            }
          }

          // Deduplicate by video ID (uploads playlist can list the same video twice)
          const videos = Array.from(new Map(videosRaw.map(v => [v.id, v])).values())

          // Separate Shorts (<180s) vs horizontal
          const horizontal = videos.filter(v => v.duration_s >= 180)
          const shorts      = videos.filter(v => v.duration_s > 0 && v.duration_s < 180)
          const hViews      = horizontal.map(v => v.views)
          const medH        = median(hViews)
          const maxH        = hViews.length ? Math.max(...hViews) : null
          const sampleWeeks = Math.max(1, ch.age_months * 4.33)
          const spread      = medH && maxH ? maxH / medH : null

          // days_to_first_hit — earliest horizontal video exceeding niche median
          let days_to_first_hit: number | null = null
          if (niche_median_views > 0) {
            const hits = horizontal
              .filter(v => v.views > niche_median_views && v.published)
              .map(v => (new Date(v.published).getTime() - channelCreatedMs) / 86400000)
              .filter(d => d >= 0)
              .sort((a, b) => a - b)
            if (hits.length) days_to_first_hit = Math.round(hits[0])
          }

          // videos_to_first_hit — count of horizontal videos published BEFORE the first hit
          let videos_to_first_hit: number | null = null
          if (niche_median_views > 0) {
            const sortedHoriz = horizontal
              .filter(v => v.published)
              .sort((a, b) => new Date(a.published).getTime() - new Date(b.published).getTime())
            const firstHitIdx = sortedHoriz.findIndex(v => v.views > niche_median_views)
            if (firstHitIdx >= 0) videos_to_first_hit = firstHitIdx
          }

          const top_videos = [...horizontal]
            .sort((a, b) => b.views - a.views)
            .slice(0, 3)
            .map(v => ({
              title:           v.title,
              views:           v.views,
              days_from_start: v.published
                ? Math.max(0, Math.round((new Date(v.published).getTime() - channelCreatedMs) / 86400000))
                : 0,
            }))

          const totalVids      = horizontal.length + shorts.length
          const is_shorts_only = horizontal.length === 0 && shorts.length > 0
          const is_spread_outlier = spread !== null && spread > SPREAD_OUTLIER_THRESHOLD

          channelMetricsAll.push({
            id:                  ch.id,
            title:               ch.title,
            age_months:          ch.age_months,
            subs:                ch.subs,
            months_to_1k:        ch.subs >= 1000 ? ch.age_months : null,
            views_per_video:     medH,
            upload_frequency:    horizontal.length ? horizontal.length / sampleWeeks : null,
            spread,
            days_to_first_hit,
            videos_to_first_hit,
            shorts_share:        totalVids > 0 ? shorts.length / totalVids : 0,
            horizontal_count:    horizontal.length,
            shorts_count:        shorts.length,
            is_shorts_only,
            is_spread_outlier,
            top_videos,
          })
        } catch (err) {
          if (err instanceof YouTubeQuotaError) throw err
          console.warn('[channel-breakout] channel fetch error', ch.id, err instanceof Error ? err.message : String(err))
        }
      }))
    }

    if (!channelMetricsAll.length) {
      return NextResponse.json(
        { ok: false, error: lang !== 'en' ? 'Не удалось получить данные ни по одному каналу' : 'Failed to fetch data for any channel' },
        { status: 422 }
      )
    }

    // ── Step 3: Summary ────────────────────────────────────────────────────
    // Base = channels without Shorts-only and without spread outliers → used for all medians
    const base = channelMetricsAll.filter(c => !c.is_shorts_only && !c.is_spread_outlier)

    const m2ks  = base.map(c => c.months_to_1k).filter((x): x is number => x !== null)
    const vpvs  = base.map(c => c.views_per_video).filter((x): x is number => x !== null)
    const freqs = base.map(c => c.upload_frequency).filter((x): x is number => x !== null)
    const sshs  = base.map(c => c.shorts_share)
    const vtfhs = base.map(c => c.videos_to_first_hit).filter((x): x is number => x !== null)

    const allM2ks = channelMetricsAll.map(c => c.months_to_1k).filter((x): x is number => x !== null)

    const summary = {
      newcomer_count:             channelMetricsAll.length,
      under_5mo_past_1k:          allM2ks.filter(x => x <= 5).length,
      median_months_to_1k:        median(m2ks),
      median_views_per_video:     median(vpvs),
      median_upload_frequency:    median(freqs),
      median_shorts_share:        median(sshs) ?? 0,
      median_videos_to_first_hit: median(vtfhs),
      shorts_only_count:          channelMetricsAll.filter(c => c.is_shorts_only).length,
      spread_outlier_count:       channelMetricsAll.filter(c => c.is_spread_outlier).length,
    }

    // ── Step 4: Sonnet verdict ─────────────────────────────────────────────
    const anthropicApiKey = env('ANTHROPIC_API_KEY')
    const claude = new Anthropic({ apiKey: anthropicApiKey })

    const verdictPrompt = getBreakoutVerdictPrompt(lang, sub_niche_name, channelMetricsAll, summary, niche_context)

    const msg = await claude.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 1800,
      messages:   [{ role: 'user', content: verdictPrompt }],
    })

    interface VerdictJson {
      growth_speed?:       string
      content_cadence?:    string
      view_concentration?: string
      shorts_role?:        string
      overall?:            string
    }
    const verdictRaw = parseClaudeJson<VerdictJson>(extractText(msg.content), 'breakout-verdict')

    const verdict = {
      growth_speed:       verdictRaw?.growth_speed       ?? '',
      content_cadence:    verdictRaw?.content_cadence    ?? '',
      view_concentration: verdictRaw?.view_concentration ?? '',
      shorts_role:        verdictRaw?.shorts_role        ?? '',
      overall:            verdictRaw?.overall            ?? '',
      source:             'estimate' as const,
    }

    // ── Build result ───────────────────────────────────────────────────────
    const result = {
      sub_niche_name,
      limit,
      analyzed_at:   new Date().toISOString(),
      niche_context: niche_context ?? null,
      summary,
      channels:      channelMetricsAll,
      verdict,
    }

    // ── Spend credits ──────────────────────────────────────────────────────
    const { ok: cbSpendOk } = await spendCredits(user.id, actualCost, 'channel_breakout')
    if (!cbSpendOk) {
      console.error(`[analytics/channel-breakout] spendCredits failed: cost=${actualCost} user=${user.id}`)
      return NextResponse.json({ ok: false, error: 'Ошибка списания кредитов' }, { status: 402 })
    }

    // ── Save to analytics_reports (non-fatal, cap 20) ─────────────────────
    try {
      const { data: old } = await svc
        .from('analytics_reports').select('id')
        .eq('user_id', user.id).eq('report_type', 'channel_breakout')
        .order('created_at', { ascending: true })
      if ((old?.length ?? 0) >= 20) await svc.from('analytics_reports').delete().eq('id', old![0].id)
      await svc.from('analytics_reports').insert({
        user_id:     user.id,
        report_type: 'channel_breakout',
        title:       sub_niche_name,
        query:       JSON.stringify({ sub_niche_name, limit }),
        result,
        created_at:  new Date().toISOString(),
      })
    } catch (e) {
      console.warn('[channel-breakout] save report failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: result })

  } catch (err) {
    if (err instanceof YouTubeQuotaError) {
      return NextResponse.json({ ok: false, error: 'YouTube quota exceeded', code: 'quota_exceeded' }, { status: 429 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    if (isYouTubeKeyError(msg)) return youTubeKeyErrorResponse(lang)
    if (isBillingError(msg)) {
      await notifyBillingError('channel-breakout', 'channel_breakout').catch(() => {})
      return NextResponse.json({ ok: false, error: 'billing_error' }, { status: 500 })
    }
    console.error('[channel-breakout]', err)
    return NextResponse.json(
      { ok: false, error: lang !== 'en' ? 'Внутренняя ошибка' : 'Internal error' },
      { status: 500 }
    )
  }
}
