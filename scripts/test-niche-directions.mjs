#!/usr/bin/env node
/**
 * Level-1 / niche-directions live test.
 *
 * Tests:
 *  1. niche-directions: "музыка" and "личные финансы" — quota_used must be 0
 *  2. sub-niche-finder with direction="музыка для прослушивания" — sub-niches narrower than full run
 *
 * Requires ANTHROPIC_API_KEY (Haiku). YOUTUBE_API_KEY also needed for step 2.
 *
 * Run from project root:  node scripts/test-niche-directions.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// ─── Load .env.local ──────────────────────────────────────────────────────────
const envPath = join(ROOT, '.env.local')
if (!existsSync(envPath)) { console.error('ERROR: .env.local not found in', ROOT); process.exit(1) }
const ENV = {}
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i < 1) continue
  let v = t.slice(i + 1).trim()
  if (v.charCodeAt(0) === 0xfeff) v = v.slice(1)
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  ENV[t.slice(0, i).trim()] = v
}

// Fall back to process.env so `railway run node scripts/...` works too
const YT_KEY        = ENV.YOUTUBE_API_KEY    ?? process.env.YOUTUBE_API_KEY
const ANTHROPIC_KEY = ENV.ANTHROPIC_API_KEY  ?? process.env.ANTHROPIC_API_KEY

if (!ANTHROPIC_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY not found in .env.local or process.env')
  console.error('  Option A: add ANTHROPIC_API_KEY=sk-ant-... to .env.local')
  console.error('  Option B: railway run node scripts/test-niche-directions.mjs')
  process.exit(1)
}
if (!YT_KEY) {
  console.warn('WARN: YOUTUBE_API_KEY not set — step 2 (sub-niche-finder with direction) will be skipped')
}

// ─── Constants ────────────────────────────────────────────────────────────────
const YT_BASE    = 'https://www.googleapis.com/youtube/v3'
const FRESH_DAYS = 90
const OLD_DAYS   = 365
const MIN_CHANNELS_RELIABLE = 5
const MIN_OLD_SAMPLE_GROWTH = 10

// ─── Helpers ──────────────────────────────────────────────────────────────────
function medianOf(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}
function daysOld(iso) { return (Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000) }
function chunks(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
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
  const s = t.indexOf('{'), e = t.lastIndexOf('}')
  if (s !== -1 && e !== -1) { try { return JSON.parse(t.slice(s, e + 1)) } catch {} }
  throw new Error(`${label}: cannot parse JSON`)
}
function fmtN(n) {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'k'
  return String(n)
}

const LINE  = '─'.repeat(88)
const DLINE = '═'.repeat(88)

// ─── Step 1: niche-directions ─────────────────────────────────────────────────

async function testNicheDirections(broadNiche, lang = 'ru') {
  console.log(`\n${DLINE}`)
  console.log(`  УРОВЕНЬ 1 — НАПРАВЛЕНИЯ: "${broadNiche}"`)
  console.log(DLINE)

  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY, timeout: 60_000 })

  const isRu = lang !== 'en'
  const systemPrompt = isRu
    ? `Ты эксперт по YouTube-стратегии. Разбей широкую нишу на 5–7 крупных РЫНОЧНЫХ СЕГМЕНТОВ.

Сегменты — это разные аудитории с разными мотивациями, а не подтемы.
Для «музыки»: Слушатели и аудитория / Обучение и инструменты / Производство и оборудование / Индустрия и культура — НЕ «рок, поп, джаз».
Для «личных финансов»: Начинающие инвесторы / Бизнес и самозанятость / Экономия и бюджет / Пассивный доход / Налоги и право.

По каждому сегменту:
• name — короткое название (3–6 слов)
• description — 1–2 предложения: что входит и кто аудитория
• examples — 3–5 конкретных примеров подниш внутри (только перечисление, без метрик)

ФОРМАТ — строго JSON без markdown:
{"directions":[{"name":"Слушатели и аудитория","description":"Люди, которые слушают и открывают музыку, а не играют сами. Контент — плейлисты, разборы альбомов, подборки.","examples":["Музыка для сна и медитации","Плейлисты по настроению","Разборы альбомов"]},...]}

Верни ровно 5–7 сегментов. Только JSON. Начни с {.`
    : `You are a YouTube strategy expert. Break a broad niche into 5–7 major MARKET SEGMENTS.

Segments are different audiences with different motivations, not sub-topics.
Format: {"directions":[{"name":"...","description":"...","examples":["..."]},...]}
Return exactly 5–7 segments. JSON only.`

  const t0  = Date.now()
  const msg = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Ниша: "${broadNiche}".` }],
  })
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\nHaiku: ${elapsed}s | in:${msg.usage.input_tokens} out:${msg.usage.output_tokens}`)
  console.log('quota_used: 0 (нет вызовов YouTube API)')

  const raw = msg.content.find(b => b.type === 'text')?.text ?? ''
  const { directions } = parseJson(raw, 'niche-directions')

  for (const d of directions ?? []) {
    console.log(`\n${LINE}`)
    console.log(`  ${d.name}`)
    console.log(`  ${d.description}`)
    console.log(`  Примеры: ${d.examples?.join(' · ')}`)
  }

  return { broadNiche, directions: directions ?? [], quota_used: 0 }
}

// ─── Step 2: sub-niche-finder with direction ─────────────────────────────────

async function testSubNicheFinderWithDirection(broadNiche, direction, country = 'RU', contentLang = 'ru') {
  if (!YT_KEY) {
    console.log(`\n[sub-niche с direction] ПРОПУЩЕН — нет YOUTUBE_API_KEY`)
    return null
  }

  const nowMs = Date.now()
  let quotaUsed = 0

  console.log(`\n${DLINE}`)
  console.log(`  УРОВЕНЬ 2 — ПОДНИШИ: ниша="${broadNiche}" направление="${direction}"`)
  console.log(DLINE)

  // Haiku — sub-niches within direction
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY, timeout: 120_000 })

  const directionHint = ` Направление: "${direction}". Генерируй подниши ТОЛЬКО внутри этого направления, не выходи за его рамки.`
  const t1 = Date.now()
  const msg1 = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 2500,
    system: `Ты YouTube-аналитик. Разбей нишу (или конкретное направление внутри неё) на 15-20 КОНКРЕТНЫХ подниш для YouTube-канала.

Если указано направление — генерируй подниши ТОЛЬКО внутри него, не выходи за его рамки.
Без направления — разбивай всю широкую нишу.

Для каждой подниши:
• name — полное название подниши для человека
• search_query — КОРОТКИЙ поисковый запрос из 2-3 слов, как реально ищут на YouTube
• rpm_level: "низкий" | "средний" | "высокий"
• rpm_reason: одна строка — ОЦЕНКА модели

ФОРМАТ — строго JSON без markdown:
{"sub_niches":[{"name":"...","search_query":"...","rpm_level":"...","rpm_reason":"..."},...]}

Верни ровно 15-20 подниш. Только JSON. Начни с {.`,
    messages: [{ role: 'user', content: `Ниша: "${broadNiche}".${directionHint} Рынок: ${country}. Язык: ${contentLang}.` }],
  })
  console.log(`\nHaiku: ${((Date.now()-t1)/1000).toFixed(1)}s | in:${msg1.usage.input_tokens} out:${msg1.usage.output_tokens}`)
  const raw1 = msg1.content.find(b => b.type === 'text')?.text ?? ''
  const { sub_niches: rawNiches } = parseJson(raw1, 'haiku-dir-gen')
  const subNiches = (rawNiches ?? []).slice(0, 20).map(n => ({ ...n, search_query: n.search_query?.trim() || n.name }))
  console.log(`Получено: ${subNiches.length} подниш`)

  // Search + enrich
  const publishedAfterFresh = new Date(nowMs - FRESH_DAYS * 24 * 3600 * 1000).toISOString()
  const searchBase = {
    part: 'snippet', type: 'video', order: 'viewCount',
    maxResults: '50', publishedAfter: publishedAfterFresh,
    regionCode: country, relevanceLanguage: contentLang,
  }

  console.log(`\n[2-3/6] YouTube search+enrich (${subNiches.length} подниш)...`)
  const t23 = Date.now()
  const enriched = await Promise.all(subNiches.map(async (niche) => {
    const r = { ...niche, fresh_video_count: 0, views: [], channel_ages_months: [], subs: [] }
    try {
      const search = await ytFetch('/search', { ...searchBase, q: niche.search_query })
      quotaUsed += 100
      r.fresh_video_count = search.pageInfo?.totalResults ?? 0
      const videoIds   = (search.items ?? []).map(v => v.id?.videoId).filter(Boolean)
      const channelIds = [...new Set((search.items ?? []).map(v => v.snippet?.channelId).filter(Boolean))]
      for (const batch of chunks(videoIds, 50)) {
        const vRes = await ytFetch('/videos', { part: 'statistics', id: batch.join(',') })
        quotaUsed += 1
        for (const v of vRes.items ?? []) { const vc = parseInt(v.statistics.viewCount ?? '0'); if (vc > 0) r.views.push(vc) }
      }
      for (const batch of chunks(channelIds, 50)) {
        const cRes = await ytFetch('/channels', { part: 'statistics,snippet', id: batch.join(',') })
        quotaUsed += 1
        for (const c of cRes.items ?? []) {
          if (c.snippet?.publishedAt) r.channel_ages_months.push(daysOld(c.snippet.publishedAt) / 30)
          const sc = parseInt(c.statistics?.subscriberCount ?? '0'); if (sc > 0) r.subs.push(sc)
        }
      }
    } catch (e) { console.warn(`  ! enrich "${niche.name}": ${e.message?.slice(0, 80)}`) }
    return r
  }))
  console.log(`   -> ${((Date.now()-t23)/1000).toFixed(1)}s | quota after step 3: ${quotaUsed}`)

  // Compute
  const computed = enriched.map(n => {
    const sv = n.views.length, sc = n.channel_ages_months.length
    return {
      name: n.name, search_query: n.search_query,
      fresh_video_count: n.fresh_video_count,
      median_views: medianOf(n.views),
      newcomer_share: sc > 0 ? Math.round(n.channel_ages_months.filter(m => m < 12).length / sc * 100) / 100 : 0,
      top_subs_median: medianOf(n.subs),
      sample_videos: sv, sample_channels: sc,
      reliable: sv >= 5 && sc >= MIN_CHANNELS_RELIABLE,
      growth_ratio: null,
    }
  })

  const reliableCount = computed.filter(n => n.reliable).length
  console.log(`\nReliable: ${reliableCount}/${computed.length}`)

  // Top-5 growth
  const top5 = [...computed]
    .filter(n => n.reliable && n.fresh_video_count > 0 && n.median_views > 0)
    .sort((a, b) => b.newcomer_share - a.newcomer_share || b.median_views - a.median_views)
    .slice(0, 5)
  const top5Names = new Set(top5.map(n => n.name))
  const publishedAfterOld = new Date(nowMs - OLD_DAYS * 24 * 3600 * 1000).toISOString()

  await Promise.all(computed.filter(n => top5Names.has(n.name)).map(async (niche) => {
    try {
      const sOld = await ytFetch('/search', { ...searchBase, q: niche.search_query, publishedAfter: publishedAfterOld })
      quotaUsed += 100
      const oldVideoIds = (sOld.items ?? []).filter(v => v.snippet?.publishedAt && daysOld(v.snippet.publishedAt) >= FRESH_DAYS).map(v => v.id?.videoId).filter(Boolean)
      const oldViews = []
      for (const batch of chunks(oldVideoIds, 50)) {
        const vOld = await ytFetch('/videos', { part: 'statistics', id: batch.join(',') })
        quotaUsed += 1
        for (const v of vOld.items ?? []) { const vc = parseInt(v.statistics.viewCount ?? '0'); if (vc > 0) oldViews.push(vc) }
      }
      const mo = medianOf(oldViews)
      if (mo > 0 && oldViews.length >= MIN_OLD_SAMPLE_GROWTH) niche.growth_ratio = Math.round((niche.median_views / mo) * 100) / 100
    } catch (e) { console.warn(`  ! growth "${niche.name}": ${e.message?.slice(0, 80)}`) }
  }))

  console.log(`quota_used=${quotaUsed}`)

  // Print table
  const sorted = [
    ...computed.filter(n => n.reliable).sort((a, b) => b.newcomer_share - a.newcomer_share),
    ...computed.filter(n => !n.reliable).sort((a, b) => b.newcomer_share - a.newcomer_share),
  ]
  console.log(`\n${LINE}`)
  console.log(`  ПОДНИШИ ВНУТРИ НАПРАВЛЕНИЯ "${direction}"`)
  console.log(`  quota_used=${quotaUsed}  reliable=${reliableCount}/${computed.length}`)
  console.log(LINE)

  const cols = [44, 5, 8, 9, 8, 6, 4, 4, 3]
  const H = ['Подниша', 'ns', 'med_v', 'fvc_90d', 'subs', 'gr', 'v_s', 'c_s', 'ok']
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
  console.log('\nЛегенда: ns=newcomer_share | med_v=median_views | fvc_90d=видео за 90д | ok=reliable | *=топ-5')

  return { direction, quotaUsed, computed, reliableCount }
}

// ─── Run ──────────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(88))
console.log('  NICHE DIRECTIONS + SUB-NICHE-FINDER WITH DIRECTION — LIVE TEST')
console.log(`  Date: ${new Date().toISOString()}`)
console.log('='.repeat(88))

// Part 1: Level 1 — niche-directions (quota=0)
const dir1 = await testNicheDirections('музыка')
const dir2 = await testNicheDirections('личные финансы')

// Part 2: Level 2 — sub-niche-finder with direction (compares with full run)
console.log('\n\n' + '='.repeat(88))
console.log('  СРАВНЕНИЕ: ВЕСЬ «музыка» vs НАПРАВЛЕНИЕ «музыка для прослушивания»')
console.log('='.repeat(88))
console.log('\nПолный прогон (previous run, from memory):')
console.log('  15 подниш: гитара, домашняя студия, сон, рок-история, пение, синтезаторы,')
console.log('  теория, DJ, рэп, классика, табулатуры, каверы, учёба, альбомы, инструменты')
console.log('  → охватывает все 4 рынка (слушатели + обучение + производство + индустрия)')

const res2 = await testSubNicheFinderWithDirection('музыка', 'музыка для прослушивания')

// Summary
console.log('\n\n' + '='.repeat(88))
console.log('  ИТОГ')
console.log('='.repeat(88))
console.log(`\n  Уровень 1 (niche-directions):`)
console.log(`    "музыка":          ${dir1.directions.length} направлений, quota=0`)
console.log(`    "личные финансы":  ${dir2.directions.length} направлений, quota=0`)
if (res2) {
  const onlyListeners = res2.computed.filter(n => {
    const name = n.name.toLowerCase()
    return !name.includes('студи') && !name.includes('оборудован') && !name.includes('бит') &&
           !name.includes('продакшн') && !name.includes('теор') && !name.includes('гитар') &&
           !name.includes('синтез') && !name.includes('инструмент')
  }).length
  console.log(`\n  Уровень 2 с direction="музыка для прослушивания":`)
  console.log(`    Подниш получено: ${res2.computed.length}`)
  console.log(`    Reliable: ${res2.reliableCount}/${res2.computed.length}`)
  console.log(`    Quota: ${res2.quotaUsed}`)
  console.log(`    Подниши о прослушивании (не обучение/производство): ~${onlyListeners}/${res2.computed.length}`)
}

console.log('\nDone.')
