#!/usr/bin/env node
/**
 * Live test for /api/analytics/sub-niche-finder — YouTube metrics validation.
 * Mirrors steps 2-5 from route.ts exactly; Haiku step uses hardcoded sub-niches
 * to avoid requiring ANTHROPIC_API_KEY locally (only YOUTUBE_API_KEY needed).
 *
 * v2 changes: search_query field, reliable flag, growth_ratio min-10 sample.
 *
 * Run from project root:  node scripts/test-sub-niche-finder.mjs
 * Reads YOUTUBE_API_KEY (required) and ANTHROPIC_API_KEY (optional) from .env.local
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// ─── Load .env.local ──────────────────────────────────────────────────────────
const envPath = join(ROOT, '.env.local')
if (!existsSync(envPath)) {
  console.error('ERROR: .env.local not found in', ROOT)
  process.exit(1)
}
const ENV = {}
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i < 1) continue
  let v = t.slice(i + 1).trim()
  if (v.charCodeAt(0) === 0xfeff) v = v.slice(1)
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  ENV[t.slice(0, i).trim()] = v
}

const YT_KEY        = ENV.YOUTUBE_API_KEY
const ANTHROPIC_KEY = ENV.ANTHROPIC_API_KEY  // optional

if (!YT_KEY) {
  console.error('ERROR: YOUTUBE_API_KEY not set in .env.local')
  process.exit(1)
}
if (!ANTHROPIC_KEY) {
  console.log('i  ANTHROPIC_API_KEY not found in .env.local — Sonnet verdict will be skipped')
  console.log('   (Add ANTHROPIC_API_KEY=sk-ant-... to .env.local for full run)')
}

// ─── Constants ────────────────────────────────────────────────────────────────
const YT_BASE               = 'https://www.googleapis.com/youtube/v3'
const FRESH_DAYS            = 90
const OLD_DAYS              = 365
const MIN_CHANNELS_RELIABLE = 5   // newcomer_share unreliable below this
const MIN_OLD_SAMPLE_GROWTH = 10  // growth_ratio unreliable below this

// ─── Helpers (identical to route.ts) ─────────────────────────────────────────
function medianOf(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

function daysOld(iso) {
  return (Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000)
}

function chunks(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function ytFetch(path, params) {
  const qs  = new URLSearchParams({ ...params, key: YT_KEY }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  const text = await res.text()
  if (!res.ok) throw new Error(`YouTube ${res.status} on ${path}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

function parseJson(text, label) {
  const t = text.trim()
  try { return JSON.parse(t) } catch {}
  const start = t.indexOf('{')
  const end   = t.lastIndexOf('}')
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(t.slice(start, end + 1)) } catch {}
  }
  throw new Error(`${label}: cannot parse JSON (${t.length} chars)`)
}

// ─── Display ──────────────────────────────────────────────────────────────────
function fmtN(n) {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'k'
  return String(n)
}

const LINE  = '─'.repeat(88)
const DLINE = '═'.repeat(88)

// ─── Hardcoded sub-niches (Haiku replacement) ─────────────────────────────────
// v2: each niche has both `name` (display) and `search_query` (short YT search term).
// YouTube API calls use search_query — not name — to match how users actually search.

const NICHES = {
  'музыка': [
    { name: 'Разбор гитарных аккордов для начинающих', search_query: 'гитара с нуля',           rpm_level: 'низкий',  rpm_reason: 'Конкурентная ниша, низкий CPC музыкального контента' },
    { name: 'Домашняя студия звукозаписи',             search_query: 'домашняя студия',          rpm_level: 'средний', rpm_reason: 'Аудиооборудование — высокий CPC' },
    { name: 'Музыка для медитации и сна',              search_query: 'музыка для сна',           rpm_level: 'низкий',  rpm_reason: 'Много конкурентов, низкий CPM' },
    { name: 'История рок-музыки СССР и России',        search_query: 'рок музыка СССР',          rpm_level: 'низкий',  rpm_reason: 'Ностальгия, низкий CPC' },
    { name: 'Уроки пения для начинающих',              search_query: 'уроки пения',              rpm_level: 'средний', rpm_reason: 'Образовательный контент' },
    { name: 'Синтезаторы и электронная музыка',        search_query: 'синтезатор обзор',         rpm_level: 'средний', rpm_reason: 'Дорогое оборудование, высокий CPC' },
    { name: 'Музыкальная теория с нуля',               search_query: 'музыкальная теория',       rpm_level: 'низкий',  rpm_reason: 'Образовательный, низкий CPM' },
    { name: 'DJ-миксинг и техники диджеинга',          search_query: 'DJ миксинг',               rpm_level: 'средний', rpm_reason: 'Оборудование + обучение' },
    { name: 'Рэп-биты и продакшн треков',              search_query: 'рэп продакшн',             rpm_level: 'низкий',  rpm_reason: 'Молодая аудитория, низкий CPM' },
    { name: 'Классическая музыка — разборы и история', search_query: 'классическая музыка',      rpm_level: 'низкий',  rpm_reason: 'Узкая образованная аудитория' },
    { name: 'Ноты и табулатуры — урок на слух',        search_query: 'табулатуры гитара',        rpm_level: 'низкий',  rpm_reason: 'Бесплатный контент, конкурент нотных сайтов' },
    { name: 'Каверы популярных песен на гитаре',       search_query: 'кавер гитара',             rpm_level: 'низкий',  rpm_reason: 'Конкурентно, авторские права' },
    { name: 'Музыка для концентрации и учёбы',         search_query: 'музыка для учёбы',         rpm_level: 'низкий',  rpm_reason: 'Lofi-ниша перенасыщена' },
    { name: 'Обзоры музыкальных альбомов',             search_query: 'обзор альбома',            rpm_level: 'низкий',  rpm_reason: 'Аудитория не покупательная' },
    { name: 'Музыкальные инструменты — выбор и обзор', search_query: 'музыкальный инструмент',   rpm_level: 'высокий', rpm_reason: 'Высокий CPC магазинов инструментов' },
  ],
  'личные финансы': [
    { name: 'Инвестиции для начинающих: ОФЗ и акции',  search_query: 'инвестиции с нуля',       rpm_level: 'высокий', rpm_reason: 'Брокеры платят высокий CPC' },
    { name: 'Кредитные карты с кэшбэком — сравнение',  search_query: 'кредитная карта кэшбэк',  rpm_level: 'высокий', rpm_reason: 'Банки платят очень высокий CPC' },
    { name: 'Накопительные счета: актуальные ставки',   search_query: 'накопительный счёт',      rpm_level: 'высокий', rpm_reason: 'Банки активно рекламируются' },
    { name: 'Недвижимость как пассивный доход',         search_query: 'недвижимость доход',      rpm_level: 'высокий', rpm_reason: 'Высокий CPC риелторов и застройщиков' },
    { name: 'Налоговые вычеты 13% — как получить',      search_query: 'налоговый вычет',         rpm_level: 'высокий', rpm_reason: 'Высококонверсионная аудитория' },
    { name: 'ИП и самозанятость: налоги и учёт',        search_query: 'ИП налоги',               rpm_level: 'высокий', rpm_reason: 'Бухгалтерские сервисы платят высокий CPC' },
    { name: 'Облигации и ОФЗ для консерваторов',        search_query: 'ОФЗ инвестиции',          rpm_level: 'высокий', rpm_reason: 'Финансовый контент, высокий CPC' },
    { name: 'Криптовалюты — осторожные инвестиции',     search_query: 'криптовалюта инвестиции', rpm_level: 'средний', rpm_reason: 'CPC падает, регуляторные риски' },
    { name: 'Ведение бюджета и трекер расходов',        search_query: 'ведение бюджета',         rpm_level: 'средний', rpm_reason: 'Финансовые приложения платят CPC' },
    { name: 'Избавление от кредитов и долгов',          search_query: 'закрыть кредит',          rpm_level: 'высокий', rpm_reason: 'Финансовые консультанты, высокий CPC' },
    { name: 'FIRE-движение: ранняя пенсия в России',    search_query: 'ранняя пенсия FIRE',      rpm_level: 'средний', rpm_reason: 'Нишевая, но думающая аудитория' },
    { name: 'Страхование жизни — что выбрать',          search_query: 'страхование жизни',       rpm_level: 'высокий', rpm_reason: 'Страховщики платят очень высокий CPC' },
    { name: 'Инвестиции для детей: как начать',         search_query: 'инвестиции детям',        rpm_level: 'высокий', rpm_reason: 'Родители — покупательная аудитория' },
    { name: 'Пенсия и государственные накопления',      search_query: 'пенсионные накопления',   rpm_level: 'средний', rpm_reason: 'Зрелая аудитория, умеренный CPC' },
    { name: 'Фриланс и налоги — не потерять деньги',    search_query: 'фриланс налоги',          rpm_level: 'средний', rpm_reason: 'Самозанятые — активная аудитория' },
  ],
  'музыка для прослушивания': [
    { name: 'Лаунж и чилл музыка',                    search_query: 'лаунж чилл',              rpm_level: 'низкий',  rpm_reason: 'Фоновый контент, низкий CPC' },
    { name: 'Соул и R&B для слушания',                search_query: 'соул музыка',             rpm_level: 'низкий',  rpm_reason: 'Нишевая аудитория' },
    { name: 'Ностальгические хиты 80-90х',            search_query: 'хиты 80 90',              rpm_level: 'низкий',  rpm_reason: 'Возрастная аудитория' },
    { name: 'Инструментальная музыка без слов',       search_query: 'инструментальная музыка', rpm_level: 'низкий',  rpm_reason: 'Фоновый контент, низкий CPC' },
    { name: 'Рок-баллады для прослушивания',          search_query: 'рок баллады',             rpm_level: 'низкий',  rpm_reason: 'Сентиментальная аудитория' },
    { name: 'Джазовая музыка для отдыха',             search_query: 'джаз расслабление',       rpm_level: 'низкий',  rpm_reason: 'Хорошая аудитория, маленькая' },
    { name: 'Классика для фонового слушания',         search_query: 'классическая музыка фон', rpm_level: 'низкий',  rpm_reason: 'Узкая аудитория' },
    { name: 'Фортепианные мелодии и пьесы',           search_query: 'фортепиано мелодии',      rpm_level: 'низкий',  rpm_reason: 'Фоновый контент' },
    { name: 'Медитативная и релакс музыка',           search_query: 'музыка медитация',        rpm_level: 'низкий',  rpm_reason: 'Конкурентная ниша' },
    { name: 'Амбиент и пространственный звук',        search_query: 'амбиент музыка',          rpm_level: 'низкий',  rpm_reason: 'Нишевая' },
    { name: 'Lo-fi для концентрации и учёбы',         search_query: 'lo fi музыка',            rpm_level: 'низкий',  rpm_reason: 'Конкурентная ниша' },
    { name: 'Инди-поп для настроения',                search_query: 'инди поп',                rpm_level: 'низкий',  rpm_reason: 'Молодая аудитория' },
    { name: 'Поп-хиты для фонового звука',            search_query: 'поп хиты фон',            rpm_level: 'низкий',  rpm_reason: 'Конкурентная' },
    { name: 'Этническая и фольклорная музыка',        search_query: 'этническая музыка',       rpm_level: 'низкий',  rpm_reason: 'Нишевая' },
    { name: 'Электронная музыка для слушания',        search_query: 'электронная музыка',      rpm_level: 'низкий',  rpm_reason: 'Молодая аудитория, низкий CPM' },
    { name: 'Фоновая музыка для работы и офиса',      search_query: 'фоновая музыка работа',   rpm_level: 'низкий',  rpm_reason: 'Конкурентно' },
    { name: 'Саундтреки и музыка из кино',            search_query: 'саундтреки кино',         rpm_level: 'низкий',  rpm_reason: 'Авторские права' },
    { name: 'Хип-хоп и биты для фона',               search_query: 'хип хоп биты',            rpm_level: 'низкий',  rpm_reason: 'Авторские права' },
  ],
}

// ─── Main algorithm ───────────────────────────────────────────────────────────
async function analyzeNiche(broadNiche, country = 'RU', contentLang = 'ru') {
  const nowMs = Date.now()
  let quotaUsed = 0

  console.log(`\n${DLINE}`)
  console.log(`  НИША: "${broadNiche}"  |  рынок: ${country}  |  язык: ${contentLang}`)
  console.log(DLINE)

  // ── Step 1 (bypassed): hardcoded sub-niches ────────────────────────────────
  const subNiches = NICHES[broadNiche]
  if (!subNiches) throw new Error(`No hardcoded sub-niches for "${broadNiche}"`)
  console.log(`\n[1/6] Подниши (hardcoded, ${subNiches.length} шт.):`)
  for (const n of subNiches) console.log(`   • [sq:"${n.search_query}"]  ${n.name}`)

  // ── Steps 2+3: parallel search + videos + channels ─────────────────────────
  // Fix 4: use search_query (short user-like term) instead of name for YouTube search
  console.log(`\n[2-3/6] YouTube — search(search_query) + enrich (${subNiches.length} ниш параллельно)...`)
  const t23 = Date.now()
  const publishedAfterFresh = new Date(nowMs - FRESH_DAYS * 24 * 3600 * 1000).toISOString()

  const searchBase = {
    part: 'snippet', type: 'video', order: 'viewCount',
    maxResults: '50', publishedAfter: publishedAfterFresh,
    regionCode: country, relevanceLanguage: contentLang,
  }

  const enriched = await Promise.all(subNiches.map(async (niche) => {
    const r = {
      name: niche.name, search_query: niche.search_query,
      rpm_level: niche.rpm_level, rpm_reason: niche.rpm_reason,
      fresh_video_count: 0, views: [], views_vpd: [], fresh_ages: [], channel_ages_months: [], subs: [],
    }
    try {
      const search = await ytFetch('/search', { ...searchBase, q: niche.search_query })
      quotaUsed += 100
      r.fresh_video_count = search.pageInfo?.totalResults ?? 0

      // Build publishedAt map for age-normalized views/day (zero extra API calls)
      const freshPubMap = new Map()
      for (const item of search.items ?? []) {
        if (item.id?.videoId && item.snippet?.publishedAt) {
          freshPubMap.set(item.id.videoId, item.snippet.publishedAt)
        }
      }

      const videoIds   = (search.items ?? []).map(v => v.id?.videoId).filter(Boolean)
      const channelIds = [...new Set((search.items ?? []).map(v => v.snippet?.channelId).filter(Boolean))]

      for (const batch of chunks(videoIds, 50)) {
        const vRes = await ytFetch('/videos', { part: 'statistics', id: batch.join(',') })
        quotaUsed += 1
        for (const v of vRes.items ?? []) {
          const vc = parseInt(v.statistics.viewCount ?? '0')
          if (vc > 0) {
            r.views.push(vc)
            const pub = freshPubMap.get(v.id)
            if (pub) {
              const age = Math.max(1, daysOld(pub))
              r.views_vpd.push(vc / age)
              r.fresh_ages.push(age)
            }
          }
        }
      }

      for (const batch of chunks(channelIds, 50)) {
        const cRes = await ytFetch('/channels', { part: 'statistics,snippet', id: batch.join(',') })
        quotaUsed += 1
        for (const c of cRes.items ?? []) {
          if (c.snippet?.publishedAt) r.channel_ages_months.push(daysOld(c.snippet.publishedAt) / 30)
          const sc = parseInt(c.statistics?.subscriberCount ?? '0')
          if (sc > 0) r.subs.push(sc)
        }
      }
    } catch (e) {
      console.warn(`   ! enrich error "${niche.name}" (sq:"${niche.search_query}"): ${e.message.slice(0, 120)}`)
    }
    return r
  }))

  console.log(`   -> ${((Date.now() - t23) / 1000).toFixed(1)}s | quota after step 3: ${quotaUsed}`)

  // ── Step 4: compute metrics + reliable flag ────────────────────────────────
  // Fix 3: reliable = sample_videos >= 5 AND sample_channels >= MIN_CHANNELS_RELIABLE
  const computed = enriched.map(n => {
    const sample_videos   = n.views.length
    const sample_channels = n.channel_ages_months.length
    const reliable        = sample_videos >= 5 && sample_channels >= MIN_CHANNELS_RELIABLE
    return {
      name:              n.name,
      search_query:      n.search_query,
      rpm_level:         n.rpm_level,
      rpm_reason:        n.rpm_reason,
      fresh_video_count: n.fresh_video_count,
      median_views:      medianOf(n.views),
      newcomer_share:    sample_channels > 0
        ? Math.round(n.channel_ages_months.filter(m => m < 12).length / sample_channels * 100) / 100
        : 0,
      top_subs_median:   medianOf(n.subs),
      views_vpd:         n.views_vpd,
      median_age_fresh:  n.fresh_ages.length > 0 ? Math.round(medianOf(n.fresh_ages)) : null,
      sample_videos,
      sample_channels,
      reliable,
      growth_ratio:      null,   // vpd-normalized, set in Step 5
      old_growth_ratio:  null,   // raw views ratio, set in Step 5 for comparison table
      median_age_old:    null,   // set in Step 5
    }
  })

  const reliableCount = computed.filter(n => n.reliable).length
  console.log(`\n   Reliable: ${reliableCount}/${computed.length} (sample_videos>=5 AND sample_channels>=${MIN_CHANNELS_RELIABLE})`)
  const unreliable = computed.filter(n => !n.reliable)
  if (unreliable.length) {
    console.log(`   Unreliable (excluded from top-5):`)
    for (const n of unreliable) {
      console.log(`     - "${n.name}" (v=${n.sample_videos} c=${n.sample_channels})`)
    }
  }

  // ── Step 5: growth ratio for top-5 reliable niches ────────────────────────
  // Fix 1: only reliable niches (sample_channels >= MIN_CHANNELS_RELIABLE) participate in top-5
  const top5 = [...computed]
    .filter(n => n.reliable && n.fresh_video_count > 0 && n.median_views > 0)
    .sort((a, b) => b.newcomer_share - a.newcomer_share || b.median_views - a.median_views)
    .slice(0, 5)
  const top5Names = new Set(top5.map(n => n.name))

  console.log(`\n[4-5/6] Growth ratio — топ-5 (только reliable) по newcomer_share:`)
  for (const n of top5) {
    console.log(`   * "${n.name}" (sq:"${n.search_query}")  ns=${n.newcomer_share.toFixed(2)}  med=${fmtN(n.median_views)}  c_s=${n.sample_channels}`)
  }

  const t5 = Date.now()
  const publishedAfterOld = new Date(nowMs - OLD_DAYS * 24 * 3600 * 1000).toISOString()

  await Promise.all(
    computed.filter(n => top5Names.has(n.name)).map(async (niche) => {
      try {
        // Fix 4: use search_query for old search too
        const searchOld = await ytFetch('/search', {
          ...searchBase, q: niche.search_query, publishedAfter: publishedAfterOld,
        })
        quotaUsed += 100

        // Build old publishedAt map for age-normalized growth ratio
        const oldPubMap = new Map()
        const oldVideoIds = (searchOld.items ?? [])
          .filter(v => v.snippet?.publishedAt && daysOld(v.snippet.publishedAt) >= FRESH_DAYS)
          .map(v => {
            if (v.id?.videoId && v.snippet?.publishedAt) oldPubMap.set(v.id.videoId, v.snippet.publishedAt)
            return v.id?.videoId
          }).filter(Boolean)

        const oldViews = []   // raw views — for old_growth_ratio (legacy) + sample guard
        const oldVpd   = []   // views/day — for new growth_ratio (vpd-normalized)
        const oldAges  = []   // ages in days — for median_age_old
        for (const batch of chunks(oldVideoIds, 50)) {
          const vOld = await ytFetch('/videos', { part: 'statistics', id: batch.join(',') })
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

        const medianOldRaw = medianOf(oldViews)
        const medianOldVpd = medianOf(oldVpd)
        if (oldViews.length >= MIN_OLD_SAMPLE_GROWTH) {
          // old method: raw views ratio (biased by cohort age gap ~3.8×)
          if (medianOldRaw > 0) {
            niche.old_growth_ratio = Math.round((niche.median_views / medianOldRaw) * 100) / 100
          }
          // new method: views/day ratio (age-normalized velocity)
          if (medianOldVpd > 0) {
            niche.growth_ratio   = Math.round((medianOf(niche.views_vpd) / medianOldVpd) * 100) / 100
            niche.median_age_old = Math.round(medianOf(oldAges))
          }
        }

        const grNote = niche.growth_ratio !== null
          ? `new_gr=${niche.growth_ratio.toFixed(2)}  old_gr=${niche.old_growth_ratio !== null ? niche.old_growth_ratio.toFixed(2) : '—'}  age_f=${niche.median_age_fresh ?? '?'}d  age_o=${niche.median_age_old ?? '?'}d`
          : `gr=null (old_sample=${oldViews.length} < ${MIN_OLD_SAMPLE_GROWTH})`
        console.log(`   "${niche.name.slice(0,30)}":  fresh_vpd=${medianOf(niche.views_vpd).toFixed(1)}  old_vpd=${medianOldVpd.toFixed(1)}  ${grNote}`)
      } catch (e) {
        console.warn(`   ! growth error "${niche.name}": ${e.message.slice(0, 120)}`)
      }
    })
  )
  console.log(`   -> ${((Date.now() - t5) / 1000).toFixed(1)}s | quota after step 5: ${quotaUsed}`)

  // ── Step 6: Sonnet verdict (optional) ────────────────────────────────────
  let verdict = null
  if (ANTHROPIC_KEY) {
    console.log('\n[6/6] Sonnet — вердикт...')
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY, timeout: 180_000 })
    const t6 = Date.now()

    // Fix 3: include reliable flag so Sonnet doesn't promote unreliable niches as market facts
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

    const msg2 = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: `Ты YouTube-аналитик. Данные подниш с реальными числами из YouTube API.
Задача: проранжировать НА ОСНОВЕ чисел.

Метрики (source: api):
• fresh_video_count — видео за 90 дней
• median_views_per_video — медиана просмотров
• newcomer_share — доля каналов < 12 мес. (0-1): пробиваемость
• top_subs_median — медиана подписчиков топ-каналов
• growth_ratio — fresh/old: >1 растёт, null = нет данных (old_sample < 10)
• reliable — true/false. Если false (sample < 5 видео или < 5 каналов) — не рекомендуй как рыночный факт, только упомяни с оговоркой.

ФОРМАТ — строго JSON без markdown:
{"ranking":[{"name":"Название","summary":"2-3 предложения с числами","recommendation":"Что снимать"}],"overall_advice":"2-3 предложения итог"}

Включи топ-5 надёжных ниш и 2-3 "избегать" (в summary: «Избегать:»). Только JSON. Начни с {.`,
      messages: [{
        role:    'user',
        content: `Широкая ниша: "${broadNiche}"\nРынок: ${country}\n\nДанные:\n${JSON.stringify(dataForVerdict, null, 2)}`,
      }],
    })
    console.log(`   -> ${((Date.now() - t6) / 1000).toFixed(1)}s | in:${msg2.usage.input_tokens} out:${msg2.usage.output_tokens}`)
    const raw2 = msg2.content.find(b => b.type === 'text')?.text ?? ''
    verdict = parseJson(raw2, 'sonnet-verdict')
  } else {
    console.log('\n[6/6] Sonnet вердикт — пропущен (ANTHROPIC_API_KEY не задан)')
  }

  // ── Print results ──────────────────────────────────────────────────────────
  console.log(`\n${LINE}`)
  console.log(`  РЕЗУЛЬТАТЫ: "${broadNiche}"`)
  console.log(`  quota_used=${quotaUsed}  reliable=${reliableCount}/${computed.length}`)
  console.log(LINE)

  // Sort: reliable first (by newcomer_share DESC), then unreliable (by newcomer_share DESC)
  const sorted = [
    ...computed.filter(n => n.reliable).sort((a, b) => b.newcomer_share - a.newcomer_share),
    ...computed.filter(n => !n.reliable).sort((a, b) => b.newcomer_share - a.newcomer_share),
  ]

  // Header
  //  col:  Подниша(44) ns(5) med_v(8) fvc(9) subs(8) gr(6) v_s(4) c_s(4) ok(3)
  const cols = [44, 5, 8, 9, 8, 6, 4, 4, 3]
  const H    = ['Подниша', 'ns', 'med_v', 'fvc_90d', 'subs', 'gr', 'v_s', 'c_s', 'ok']
  let hdr = H[0].padEnd(cols[0])
  for (let i = 1; i < H.length; i++) hdr += ' ' + H[i].padStart(cols[i])
  console.log('\n' + hdr)
  console.log('─'.repeat(hdr.length))

  for (const n of sorted) {
    const star  = top5Names.has(n.name) ? '* ' : '  '
    const label = (star + n.name).slice(0, cols[0]).padEnd(cols[0])
    const ns    = n.newcomer_share.toFixed(2).padStart(cols[1])
    const mv    = fmtN(n.median_views).padStart(cols[2])
    const fvc   = fmtN(n.fresh_video_count).padStart(cols[3])
    const sub   = fmtN(n.top_subs_median).padStart(cols[4])
    const gr    = (n.growth_ratio !== null ? n.growth_ratio.toFixed(2) : '—').padStart(cols[5])
    const vs    = String(n.sample_videos).padStart(cols[6])
    const cs    = String(n.sample_channels).padStart(cols[7])
    const ok    = (n.reliable ? 'Y' : 'N').padStart(cols[8])
    console.log(`${label} ${ns} ${mv} ${fvc} ${sub} ${gr} ${vs} ${cs} ${ok}`)
  }

  console.log('\nЛегенда: ns=newcomer_share | med_v=median_views | fvc_90d=видео за 90д')
  console.log(`         subs=top_subs_median | gr=growth_ratio(vpd-норм) | v_s=видео в выборке`)
  console.log(`         c_s=каналов в выборке | ok=reliable(Y/N) | *=вошёл в топ-5`)
  console.log(`         ok=N → ниша ненадёжна, не участвует в топ-5`)

  // Comparison table: old gr (raw views) vs new gr (vpd-normalized) for top-5
  const top5computed = computed.filter(n => top5Names.has(n.name))
    .sort((a, b) => b.newcomer_share - a.newcomer_share)
  if (top5computed.length > 0) {
    console.log(`\nСРАВНЕНИЕ growth_ratio (top-5): raw vs vpd-нормированный`)
    const cH = ['Подниша', 'old_gr', 'new_gr', 'age_f(д)', 'age_o(д)', 'коррекция']
    const cW = [38, 7, 7, 9, 9, 10]
    let ch = cH[0].padEnd(cW[0])
    for (let i = 1; i < cH.length; i++) ch += ' ' + cH[i].padStart(cW[i])
    console.log('\n' + ch)
    console.log('─'.repeat(ch.length))
    for (const n of top5computed) {
      const nm  = n.name.slice(0, cW[0]).padEnd(cW[0])
      const og  = (n.old_growth_ratio !== null ? n.old_growth_ratio.toFixed(2) : '—').padStart(cW[1])
      const ng  = (n.growth_ratio    !== null ? n.growth_ratio.toFixed(2)     : '—').padStart(cW[2])
      const af  = (n.median_age_fresh !== null ? String(n.median_age_fresh)    : '—').padStart(cW[3])
      const ao  = (n.median_age_old   !== null ? String(n.median_age_old)      : '—').padStart(cW[4])
      // correction factor = new_gr / old_gr (how much vpd-normalization changes the ratio)
      const corr = (n.old_growth_ratio && n.growth_ratio)
        ? (n.growth_ratio / n.old_growth_ratio).toFixed(1) + 'x'
        : '—'
      console.log(`${nm} ${og} ${ng} ${af} ${ao} ${corr.padStart(cW[5])}`)
    }
    console.log('Коррекция = new_gr / old_gr; теоретически ≈ age_o / age_f (≈3–4× для order=viewCount)')
  }

  if (verdict) {
    console.log(`\nВЕРДИКТ SONNET (source: estimate):`)
    console.log(LINE)
    for (const r of (verdict.ranking ?? [])) {
      const isAvoid = (r.summary ?? '').startsWith('Избегать')
      console.log(`\n${isAvoid ? 'X' : '+'} ${r.name}`)
      console.log(`   ${r.summary}`)
      if (r.recommendation) console.log(`   -> ${r.recommendation}`)
    }
    console.log(`\nОбщий совет:\n   ${verdict.overall_advice}`)
  }

  return { broadNiche, quotaUsed, computed, top5Names, reliableCount }
}

// ─── Run ──────────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(88))
console.log('  SUB-NICHE FINDER v3 — LIVE METRICS TEST (vpd-normalized growth_ratio)')
console.log('  Fix: growth_ratio = median(fresh vpd) / median(old vpd) — age-normalized velocity')
console.log(`  Date: ${new Date().toISOString()}`)
console.log('='.repeat(88))

const results = []

for (const niche of ['музыка для прослушивания']) {
  try {
    results.push(await analyzeNiche(niche, 'RU', 'ru'))
  } catch (e) {
    console.error(`\nERROR for "${niche}":`, e.message)
  }
}

// Cross-niche summary
if (results.length > 0) {
  console.log(`\n${'='.repeat(88)}`)
  console.log('  СВОДКА v2')
  console.log('='.repeat(88))
  let total = 0
  for (const r of results) {
    const all = r.computed.length
    console.log(`  "${r.broadNiche}": quota=${r.quotaUsed}  reliable=${r.reliableCount}/${all}  top5Names:[${[...r.top5Names].map(n => `"${n.slice(0,25)}"`).join(', ')}]`)
    total += r.quotaUsed
  }
  console.log(`  Total quota: ${total} of 10 000 daily (${(total / 100).toFixed(0)}%)`)
}

console.log('\nDone.')
