#!/usr/bin/env node
/**
 * Live test for /api/analytics/sub-niche-finder — YouTube metrics validation.
 * Mirrors steps 2-5 from route.ts exactly; Haiku step uses hardcoded sub-niches
 * to avoid requiring ANTHROPIC_API_KEY locally (only YOUTUBE_API_KEY needed).
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
  // Strip BOM and surrounding quotes
  let v = t.slice(i + 1).trim()
  if (v.charCodeAt(0) === 0xfeff) v = v.slice(1)
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  ENV[t.slice(0, i).trim()] = v
}

const YT_KEY       = ENV.YOUTUBE_API_KEY
const ANTHROPIC_KEY = ENV.ANTHROPIC_API_KEY  // optional

if (!YT_KEY) {
  console.error('ERROR: YOUTUBE_API_KEY not set in .env.local')
  process.exit(1)
}
if (!ANTHROPIC_KEY) {
  console.log('ℹ  ANTHROPIC_API_KEY not found in .env.local — Sonnet verdict will be skipped')
  console.log('   (Add ANTHROPIC_API_KEY=sk-ant-... to .env.local for full run)')
}

// ─── Constants ────────────────────────────────────────────────────────────────
const YT_BASE    = 'https://www.googleapis.com/youtube/v3'
const FRESH_DAYS = 90
const OLD_DAYS   = 365

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

// 3-pass JSON extractor (mirrors parseClaudeJson)
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

const LINE  = '─'.repeat(80)
const DLINE = '═'.repeat(80)

// ─── Hardcoded sub-niches (Haiku replacement) ─────────────────────────────────
// In production, Haiku generates these dynamically. Here we pre-seed them
// to test YouTube metric quality without requiring ANTHROPIC_API_KEY.

const NICHES = {
  'музыка': [
    { name: 'Разбор гитарных аккордов для начинающих', rpm_level: 'низкий',  rpm_reason: 'Конкурентная ниша, низкий CPC музыкального контента' },
    { name: 'Домашняя студия звукозаписи',             rpm_level: 'средний', rpm_reason: 'Аудиооборудование — высокий CPC' },
    { name: 'Музыка для медитации и сна',              rpm_level: 'низкий',  rpm_reason: 'Много конкурентов, низкий CPM' },
    { name: 'История рок-музыки СССР и России',        rpm_level: 'низкий',  rpm_reason: 'Ностальгия, низкий CPC' },
    { name: 'Уроки пения для начинающих',              rpm_level: 'средний', rpm_reason: 'Образовательный контент' },
    { name: 'Синтезаторы и электронная музыка',        rpm_level: 'средний', rpm_reason: 'Дорогое оборудование, высокий CPC' },
    { name: 'Музыкальная теория с нуля',               rpm_level: 'низкий',  rpm_reason: 'Образовательный, низкий CPM' },
    { name: 'DJ-миксинг и техники диджеинга',          rpm_level: 'средний', rpm_reason: 'Оборудование + обучение' },
    { name: 'Рэп-биты и продакшн треков',              rpm_level: 'низкий',  rpm_reason: 'Молодая аудитория, низкий CPM' },
    { name: 'Классическая музыка — разборы и история', rpm_level: 'низкий',  rpm_reason: 'Узкая образованная аудитория' },
    { name: 'Ноты и табулатуры — урок на слух',        rpm_level: 'низкий',  rpm_reason: 'Бесплатный контент, конкурент нотных сайтов' },
    { name: 'Каверы популярных песен на гитаре',       rpm_level: 'низкий',  rpm_reason: 'Конкурентно, авторские права' },
    { name: 'Музыка для концентрации и учёбы',         rpm_level: 'низкий',  rpm_reason: 'Lofi-ниша перенасыщена' },
    { name: 'Обзоры музыкальных альбомов',             rpm_level: 'низкий',  rpm_reason: 'Аудитория не покупательная' },
    { name: 'Музыкальные инструменты — выбор и обзор', rpm_level: 'высокий', rpm_reason: 'Высокий CPC магазинов инструментов' },
  ],
  'личные финансы': [
    { name: 'Инвестиции для начинающих: ОФЗ и акции',  rpm_level: 'высокий', rpm_reason: 'Брокеры платят высокий CPC' },
    { name: 'Кредитные карты с кэшбэком — сравнение',  rpm_level: 'высокий', rpm_reason: 'Банки платят очень высокий CPC' },
    { name: 'Накопительные счета: актуальные ставки',   rpm_level: 'высокий', rpm_reason: 'Банки активно рекламируются' },
    { name: 'Недвижимость как пассивный доход',         rpm_level: 'высокий', rpm_reason: 'Высокий CPC риелторов и застройщиков' },
    { name: 'Налоговые вычеты 13% — как получить',      rpm_level: 'высокий', rpm_reason: 'Высококонверсионная аудитория' },
    { name: 'ИП и самозанятость: налоги и учёт',        rpm_level: 'высокий', rpm_reason: 'Бухгалтерские сервисы платят высокий CPC' },
    { name: 'Облигации и ОФЗ для консерваторов',        rpm_level: 'высокий', rpm_reason: 'Финансовый контент, высокий CPC' },
    { name: 'Криптовалюты — осторожные инвестиции',     rpm_level: 'средний', rpm_reason: 'CPC падает, регуляторные риски' },
    { name: 'Ведение бюджета и трекер расходов',        rpm_level: 'средний', rpm_reason: 'Финансовые приложения платят CPC' },
    { name: 'Избавление от кредитов и долгов',          rpm_level: 'высокий', rpm_reason: 'Финансовые консультанты, высокий CPC' },
    { name: 'FIRE-движение: ранняя пенсия в России',    rpm_level: 'средний', rpm_reason: 'Нишевая, но думающая аудитория' },
    { name: 'Страхование жизни — что выбрать',          rpm_level: 'высокий', rpm_reason: 'Страховщики платят очень высокий CPC' },
    { name: 'Инвестиции для детей: как начать',         rpm_level: 'высокий', rpm_reason: 'Родители — покупательная аудитория' },
    { name: 'Пенсия и государственные накопления',      rpm_level: 'средний', rpm_reason: 'Зрелая аудитория, умеренный CPC' },
    { name: 'Фриланс и налоги — не потерять деньги',    rpm_level: 'средний', rpm_reason: 'Самозанятые — активная аудитория' },
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
  for (const n of subNiches) console.log(`   • ${n.name}  [RPM:${n.rpm_level}]`)

  // ── Steps 2+3: parallel search + videos + channels ─────────────────────────
  console.log(`\n[2-3/6] YouTube — search + enrich (${subNiches.length} ниш параллельно)...`)
  const t23 = Date.now()
  const publishedAfterFresh = new Date(nowMs - FRESH_DAYS * 24 * 3600 * 1000).toISOString()

  const searchBase = {
    part: 'snippet', type: 'video', order: 'viewCount',
    maxResults: '50', publishedAfter: publishedAfterFresh,
    regionCode: country, relevanceLanguage: contentLang,
  }

  const enriched = await Promise.all(subNiches.map(async (niche) => {
    const r = {
      name: niche.name, rpm_level: niche.rpm_level, rpm_reason: niche.rpm_reason,
      fresh_video_count: 0, views: [], channel_ages_months: [], subs: [],
    }
    try {
      const search = await ytFetch('/search', { ...searchBase, q: niche.name })
      quotaUsed += 100
      r.fresh_video_count = search.pageInfo?.totalResults ?? 0

      const videoIds   = (search.items ?? []).map(v => v.id?.videoId).filter(Boolean)
      const channelIds = [...new Set((search.items ?? []).map(v => v.snippet?.channelId).filter(Boolean))]

      for (const batch of chunks(videoIds, 50)) {
        const vRes = await ytFetch('/videos', { part: 'statistics', id: batch.join(',') })
        quotaUsed += 1
        for (const v of vRes.items ?? []) {
          const vc = parseInt(v.statistics.viewCount ?? '0')
          if (vc > 0) r.views.push(vc)
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
      console.warn(`   ⚠ enrich error "${niche.name}": ${e.message.slice(0, 120)}`)
    }
    return r
  }))

  console.log(`   → ${((Date.now() - t23) / 1000).toFixed(1)}s | quota after step 3: ${quotaUsed}`)

  // ── Step 4: compute metrics ────────────────────────────────────────────────
  const computed = enriched.map(n => ({
    name:              n.name,
    rpm_level:         n.rpm_level,
    rpm_reason:        n.rpm_reason,
    fresh_video_count: n.fresh_video_count,
    median_views:      medianOf(n.views),
    newcomer_share:    n.channel_ages_months.length > 0
      ? Math.round(n.channel_ages_months.filter(m => m < 12).length / n.channel_ages_months.length * 100) / 100
      : 0,
    top_subs_median:   medianOf(n.subs),
    sample_videos:     n.views.length,
    sample_channels:   n.channel_ages_months.length,
    growth_ratio:      null,
  }))

  // ── Step 5: growth ratio for top-5 ────────────────────────────────────────
  const top5 = [...computed]
    .filter(n => n.fresh_video_count > 0 && n.median_views > 0)
    .sort((a, b) => b.newcomer_share - a.newcomer_share || b.median_views - a.median_views)
    .slice(0, 5)
  const top5Names = new Set(top5.map(n => n.name))

  console.log(`\n[4-5/6] Growth ratio — топ-5 по newcomer_share:`)
  for (const n of top5) console.log(`   ★ "${n.name}"  ns=${n.newcomer_share.toFixed(2)}  med=${fmtN(n.median_views)}`)

  const t5 = Date.now()
  const publishedAfterOld = new Date(nowMs - OLD_DAYS * 24 * 3600 * 1000).toISOString()

  await Promise.all(
    computed.filter(n => top5Names.has(n.name)).map(async (niche) => {
      try {
        const searchOld = await ytFetch('/search', {
          ...searchBase, q: niche.name, publishedAfter: publishedAfterOld,
        })
        quotaUsed += 100

        const oldVideoIds = (searchOld.items ?? [])
          .filter(v => v.snippet?.publishedAt && daysOld(v.snippet.publishedAt) >= FRESH_DAYS)
          .map(v => v.id?.videoId).filter(Boolean)

        const oldViews = []
        for (const batch of chunks(oldVideoIds, 50)) {
          const vOld = await ytFetch('/videos', { part: 'statistics', id: batch.join(',') })
          quotaUsed += 1
          for (const v of vOld.items ?? []) {
            const vc = parseInt(v.statistics.viewCount ?? '0')
            if (vc > 0) oldViews.push(vc)
          }
        }

        const medianOld = medianOf(oldViews)
        niche.growth_ratio = medianOld > 0
          ? Math.round((niche.median_views / medianOld) * 100) / 100
          : null

        console.log(
          `   "${niche.name}":` +
          `  fresh_med=${fmtN(niche.median_views)}  old_med=${fmtN(medianOld)}  ` +
          `old_sample=${oldViews.length}  ratio=${niche.growth_ratio ?? 'null (no old data)'}`
        )
      } catch (e) {
        console.warn(`   ⚠ growth error "${niche.name}": ${e.message.slice(0, 120)}`)
      }
    })
  )
  console.log(`   → ${((Date.now() - t5) / 1000).toFixed(1)}s | quota after step 5: ${quotaUsed}`)

  // ── Step 6: Sonnet verdict (optional) ────────────────────────────────────
  let verdict = null
  if (ANTHROPIC_KEY) {
    console.log('\n[6/6] Sonnet — вердикт...')
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY, timeout: 180_000 })
    const t6 = Date.now()

    const dataForVerdict = computed.map(n => ({
      name: n.name,
      fresh_video_count: n.fresh_video_count,
      median_views_per_video: n.median_views,
      newcomer_share: n.newcomer_share,
      top_subs_median: n.top_subs_median,
      growth_ratio: n.growth_ratio,
    }))

    const msg2 = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: `Ты YouTube-аналитик. Данные подниш с реальными числами из YouTube API.
Задача: проранжировать НА ОСНОВЕ чисел.

Метрики (source: api):
• fresh_video_count — видео за 90 дней: много = конкурентно, мало = слишком узко
• median_views_per_video — медиана просмотров: потенциал охвата
• newcomer_share — доля каналов < 12 мес. в топе: пробиваемость (0–1)
• top_subs_median — медиана подписчиков топ: сила конкурентов
• growth_ratio — fresh/old: >1 растёт, <1 стагнирует, null = нет данных

ФОРМАТ — строго JSON без markdown:
{"ranking":[{"name":"Название","summary":"2-3 предложения с числами","recommendation":"Что снимать"}],"overall_advice":"2-3 предложения итог"}

Включи топ-5 и 2-3 "избегать" (в summary начиная с «Избегать:»). Только JSON. Начни с {.`,
      messages: [{
        role:    'user',
        content: `Широкая ниша: "${broadNiche}"\nРынок: ${country}\n\nДанные:\n${JSON.stringify(dataForVerdict, null, 2)}`,
      }],
    })
    console.log(`   → ${((Date.now() - t6) / 1000).toFixed(1)}s | in:${msg2.usage.input_tokens} out:${msg2.usage.output_tokens}`)
    const raw2 = msg2.content.find(b => b.type === 'text')?.text ?? ''
    verdict = parseJson(raw2, 'sonnet-verdict')
  } else {
    console.log('\n[6/6] Sonnet вердикт — пропущен (ANTHROPIC_API_KEY не задан)')
  }

  // ── Print results ──────────────────────────────────────────────────────────
  console.log(`\n${LINE}`)
  console.log(`  РЕЗУЛЬТАТЫ: "${broadNiche}"`)
  console.log(`  quota_used=${quotaUsed}  (оценка ~2600)`)
  console.log(LINE)

  // Sort by newcomer_share DESC
  const sorted = [...computed].sort((a, b) => b.newcomer_share - a.newcomer_share)

  // Header
  const W = [40, 5, 8, 9, 8, 6, 5, 5]
  const H = ['Подниша', 'ns', 'med_v', 'fvc_90d', 'subs', 'gr', 'v_s', 'c_s']
  let hdr = ''
  H.forEach((h, i) => { hdr += (i === 0 ? h.padEnd(W[0]) : h.padStart(W[i])) + ' ' })
  console.log('\n' + hdr.trimEnd())
  console.log('─'.repeat(hdr.trimEnd().length))

  for (const n of sorted) {
    const star  = top5Names.has(n.name) ? '★ ' : '  '
    const label = (star + n.name).padEnd(W[0])
    const ns    = n.newcomer_share.toFixed(2).padStart(W[1])
    const mv    = fmtN(n.median_views).padStart(W[2])
    const fvc   = fmtN(n.fresh_video_count).padStart(W[3])
    const sub   = fmtN(n.top_subs_median).padStart(W[4])
    const gr    = (n.growth_ratio !== null ? n.growth_ratio.toFixed(2) : '—').padStart(W[5])
    const vs    = String(n.sample_videos).padStart(W[6])
    const cs    = String(n.sample_channels).padStart(W[7])
    console.log(`${label} ${ns} ${mv} ${fvc} ${sub} ${gr} ${vs} ${cs}`)
  }

  console.log(`\nЛегенда: ns=newcomer_share(0-1) | med_v=median_views | fvc_90d=кол-во видео за 90д`)
  console.log(`         subs=top_subs_median | gr=growth_ratio | v_s=видео в выборке | c_s=каналов`)
  console.log(`         ★ = вошёл в топ-5 для growth_ratio`)

  // RPM estimates
  console.log(`\nRPM-оценки (source: estimate, Haiku-hardcoded):`)
  for (const n of computed) {
    console.log(`  [${n.rpm_level.padEnd(7)}] ${n.name}`)
  }

  // Sonnet verdict
  if (verdict) {
    console.log(`\nВЕРДИКТ SONNET (source: estimate):`)
    console.log(LINE)
    for (const r of (verdict.ranking ?? [])) {
      const isAvoid = (r.summary ?? '').startsWith('Избегать')
      console.log(`\n${isAvoid ? '🚫' : '✅'} ${r.name}`)
      console.log(`   ${r.summary}`)
      if (r.recommendation) console.log(`   → ${r.recommendation}`)
    }
    console.log(`\nОбщий совет:\n   ${verdict.overall_advice}`)
  }

  return { broadNiche, quotaUsed, computed, top5Names }
}

// ─── Run ──────────────────────────────────────────────────────────────────────
console.log('\n' + '█'.repeat(80))
console.log('  SUB-NICHE FINDER — LIVE METRICS TEST')
console.log(`  Дата: ${new Date().toISOString()}`)
console.log(`  Ключ: YOUTUBE_API_KEY (shared key) из .env.local`)
console.log('█'.repeat(80))

const results = []

for (const niche of ['музыка', 'личные финансы']) {
  try {
    results.push(await analyzeNiche(niche, 'RU', 'ru'))
  } catch (e) {
    console.error(`\n❌ Ошибка для "${niche}":`, e.message)
  }
}

// Cross-niche summary
if (results.length > 0) {
  console.log(`\n${'█'.repeat(80)}`)
  console.log('  СВОДКА')
  console.log('█'.repeat(80))
  let total = 0
  for (const r of results) {
    console.log(`  "${r.broadNiche}": ${r.quotaUsed} юнитов`)
    total += r.quotaUsed
  }
  console.log(`  Итого: ${total} из 10 000 дневных (${(total / 100).toFixed(0)}%)`)
}

console.log('\nDone.')
