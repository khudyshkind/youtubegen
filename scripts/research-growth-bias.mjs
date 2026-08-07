/**
 * RESEARCH ONLY — no production changes.
 * Run: railway run node scripts/research-growth-bias.mjs
 *
 * Answers:
 *   Part 1 — growth_ratio age bias (4 sub-questions)
 *   Part 2 — can real video titles replace Haiku memory? (5 sub-questions)
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import Anthropic from '@anthropic-ai/sdk'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ENV = {}
try {
  const lines = readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) ENV[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* will use process.env */ }

const YT_KEY       = ENV.YOUTUBE_API_KEY    ?? process.env.YOUTUBE_API_KEY
const ANTH_KEY     = ENV.ANTHROPIC_API_KEY  ?? process.env.ANTHROPIC_API_KEY

if (!YT_KEY)   { console.error('YOUTUBE_API_KEY missing'); process.exit(1) }
if (!ANTH_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1) }

const YT_BASE  = 'https://www.googleapis.com/youtube/v3'
let totalQuota = 0

async function ytGet(path, params, units = 100) {
  const qs  = new URLSearchParams({ ...params, key: YT_KEY }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  const txt = await res.text()
  if (!res.ok) throw new Error(`YouTube ${res.status}: ${txt.slice(0, 300)}`)
  totalQuota += units
  return JSON.parse(txt)
}

function medianOf(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function daysOld(iso) {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000
}

function hr(ch = '═', n = 70) { console.log(ch.repeat(n)) }
function fmt(n) { return n == null ? 'null' : n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) }


// ══════════════════════════════════════════════════════════════
// ЧАСТЬ 1 — growth_ratio age-bias analysis
// ══════════════════════════════════════════════════════════════

async function part1(query) {
  hr()
  console.log(`ЧАСТЬ 1: age-bias в growth_ratio | запрос: "${query}"`)
  hr()

  const now       = Date.now()
  const FRESH     = 90        // days
  const OLD_MAX   = 365       // days
  const baseParams = {
    part: 'snippet', type: 'video', order: 'viewCount',
    maxResults: '50', regionCode: 'RU', relevanceLanguage: 'ru',
  }

  // ── 1. Fresh window ──────────────────────────────────────────
  console.log('\n[Q1] Свежие видео (publishedAfter = now−90d) ...')
  const freshSearch = await ytGet('/search', {
    ...baseParams, q: query,
    publishedAfter: new Date(now - FRESH * 86_400_000).toISOString(),
  })
  console.log(`     search.list cost: 100 units`)
  console.log(`     Параметры: publishedAfter=${new Date(now - FRESH * 86_400_000).toISOString().slice(0, 10)} … now`)
  console.log(`     order=viewCount → топ 50 по просмотрам внутри окна`)

  const freshItems = (freshSearch.items ?? [])
    .filter(v => v.id?.videoId && v.snippet?.publishedAt)
    .map(v => ({ id: v.id.videoId, pub: v.snippet.publishedAt }))

  // Get view counts
  const freshStats = freshItems.length
    ? await ytGet('/videos', { part: 'statistics', id: freshItems.map(v => v.id).join(',') }, 1)
    : { items: [] }

  const freshVids = freshItems.map(fi => {
    const st   = (freshStats.items ?? []).find(s => s.id === fi.id)
    const views = parseInt(st?.statistics?.viewCount ?? '0')
    const age   = daysOld(fi.pub)
    return { views, age, vpd: age > 0 && views > 0 ? views / age : 0 }
  }).filter(v => v.views > 0)

  // ── 2. Old window ────────────────────────────────────────────
  console.log('\n[Q1] Старые видео (publishedAfter = now−365d, фильтр ≥90d) ...')
  const oldSearch = await ytGet('/search', {
    ...baseParams, q: query,
    publishedAfter: new Date(now - OLD_MAX * 86_400_000).toISOString(),
  })
  console.log(`     Параметры: publishedAfter=${new Date(now - OLD_MAX * 86_400_000).toISOString().slice(0, 10)} … now`)
  console.log(`     Затем фильтруем: daysOld(publishedAt) >= ${FRESH} → окно [90d, 365d]`)

  const oldItems = (oldSearch.items ?? [])
    .filter(v => v.id?.videoId && v.snippet?.publishedAt && daysOld(v.snippet.publishedAt) >= FRESH)
    .map(v => ({ id: v.id.videoId, pub: v.snippet.publishedAt }))

  console.log(`     После фильтра ≥90d: ${oldItems.length} из ${oldSearch.items?.length ?? 0} видео`)

  const oldStats = oldItems.length
    ? await ytGet('/videos', { part: 'statistics', id: oldItems.map(v => v.id).join(',') }, 1)
    : { items: [] }

  const oldVids = oldItems.map(fi => {
    const st   = (oldStats.items ?? []).find(s => s.id === fi.id)
    const views = parseInt(st?.statistics?.viewCount ?? '0')
    const age   = daysOld(fi.pub)
    return { views, age, vpd: age > 0 && views > 0 ? views / age : 0 }
  }).filter(v => v.views > 0)

  // ── 3. Age profile ───────────────────────────────────────────
  console.log('\n[Q2] Возрастной профиль выборок:')

  const mFreshAge = medianOf(freshVids.map(v => v.age))
  const mOldAge   = medianOf(oldVids.map(v => v.age))
  const minOldAge = oldVids.reduce((mn, v) => Math.min(mn, v.age), Infinity)
  const maxOldAge = oldVids.reduce((mx, v) => Math.max(mx, v.age), 0)
  const minFreshAge = freshVids.reduce((mn, v) => Math.min(mn, v.age), Infinity)
  const maxFreshAge = freshVids.reduce((mx, v) => Math.max(mx, v.age), 0)

  console.log(`     Свежие (n=${freshVids.length}): мин=${fmt(minFreshAge)}д, медиана=${fmt(mFreshAge)}д, макс=${fmt(maxFreshAge)}д`)
  console.log(`     Старые  (n=${oldVids.length}): мин=${fmt(minOldAge)}д, медиана=${fmt(mOldAge)}д, макс=${fmt(maxOldAge)}д`)
  console.log(`     ► Разрыв медиан: ${fmt(mOldAge / mFreshAge)}x`)

  // ── 4. Comparison ────────────────────────────────────────────
  console.log('\n[Q3] Сравнение метрик — текущий vs нормированный на возраст:')

  const mFreshViews = medianOf(freshVids.map(v => v.views))
  const mOldViews   = medianOf(oldVids.map(v => v.views))
  const mFreshVpd   = medianOf(freshVids.map(v => v.vpd))
  const mOldVpd     = medianOf(oldVids.map(v => v.vpd))

  const grRaw = mOldViews > 0 ? mFreshViews / mOldViews : null
  const grAdj = mOldVpd   > 0 ? mFreshVpd   / mOldVpd   : null

  console.log(``)
  console.log(`                              Свежие          Старые`)
  console.log(`     Медиана просмотров:  ${String(fmt(mFreshViews)).padStart(12)}   ${String(fmt(mOldViews)).padStart(12)}`)
  console.log(`     Медиана возраст (д): ${String(fmt(mFreshAge)).padStart(12)}   ${String(fmt(mOldAge)).padStart(12)}`)
  console.log(`     Медиана просм/день:  ${String(fmt(mFreshVpd)).padStart(12)}   ${String(fmt(mOldVpd)).padStart(12)}`)
  console.log(``)
  console.log(`     growth_ratio ТЕКУЩИЙ  (fresh_views / old_views)     = ${fmt(grRaw)}`)
  console.log(`     growth_ratio СКОРРЕКТ (fresh_vpd   / old_vpd)       = ${fmt(grAdj)}`)

  if (grRaw != null && grAdj != null) {
    console.log(``)
    console.log(`     ► Поправочный множитель: ${fmt(grAdj / grRaw)}x`)
    console.log(`     ► То есть gr=0.26 в прогоне "музыка" → реально gr_adj≈${fmt(0.26 * grAdj / grRaw)}`)
    console.log(`     ► То есть gr=0.58 (Инстр. музыка)   → реально gr_adj≈${fmt(0.58 * grAdj / grRaw)}`)
  }

  // ── 5. Verdict ───────────────────────────────────────────────
  console.log('\n[Q4] Вывод — что с этим делать:')
  if (grAdj != null && grAdj > 0.8 && grRaw != null && grRaw < 0.5) {
    console.log(`     ✅ ПОДТВЕРЖДЕНО: growth_ratio систематически занижен из-за разницы возрастов.`)
    console.log(`        Нормировка на views/day исправляет картину без доп. quota.`)
    console.log(`        Исправление: сохранять publishedAt из snippet поиска → делить views/age.`)
    console.log(`        Цена изменения: 0 extra quota units (данные уже есть в search.list).`)
  } else if (grAdj != null && grAdj < 0.5) {
    console.log(`     ⚠️  Даже с нормировкой ниша стагнирует. Bias частично есть, но не определяющий.`)
  } else {
    console.log(`     ℹ️  Результаты неоднозначны. Нужно больше данных.`)
  }

  return { mFreshAge, mOldAge, mFreshViews, mOldViews, grRaw, grAdj }
}


// ══════════════════════════════════════════════════════════════
// ЧАСТЬ 2 — real YouTube titles vs Haiku memory
// ══════════════════════════════════════════════════════════════

// Known list from the current system ("музыка", full run, no direction)
const MEMORY_NICHES = [
  'Разбор гитарных аккордов для начинающих',
  'Домашняя студия звукозаписи',
  'Рэп-продакшн для начинающих',
  'DJ-тусовки и миксы',
  'Синтезаторы и электронная музыка',
  'Теория музыки для самообучения',
  'Вокал и пение для новичков',
  'Биты и семплы для начинающих',
  'Классическая музыка для новичков',
  'Фортепиано с нуля для взрослых',
  'Обзоры наушников и аудиотехники',
  'Lo-fi и чилл-хоп музыка',
  'Гитарные соло и техника игры',
  'Концерты и живые выступления',
  'Музыкальный бизнес и продвижение',
]

async function part2(broadQuery) {
  hr()
  console.log(`ЧАСТЬ 2: Реальные заголовки vs Haiku-память | запрос: "${broadQuery}"`)
  hr()

  // ── Q1: search.list snippet fields ──────────────────────────
  console.log('\n[Q1] Поля search.list snippet (topSearch без даты):')
  const searchResult = await ytGet('/search', {
    part: 'snippet', type: 'video', order: 'viewCount',
    maxResults: '50', q: broadQuery, regionCode: 'RU', relevanceLanguage: 'ru',
  })

  const items = searchResult.items ?? []
  if (items[0]) {
    const s = items[0].snippet
    const fields = Object.keys(s)
    console.log(`     Поля в snippet: ${fields.join(', ')}`)
    console.log(`     title:        "${(s.title ?? '').slice(0, 70)}"`)
    console.log(`     description:  "${(s.description ?? '').slice(0, 80)}..."`)
    console.log(`     tags в search.list: ${s.tags ? s.tags.slice(0,3).join(', ') : 'ОТСУТСТВУЮТ — только в videos.list'}`)
    console.log(`     categoryId:   ${s.categoryId ?? 'ОТСУТСТВУЕТ — только в videos.list'}`)
  }

  const videoIds = items.map(v => v.id?.videoId).filter(Boolean)

  // ── Q2: videos.list — tags + categoryId в практике ──────────
  console.log('\n[Q2] videos.list part=statistics,snippet,topicDetails:')
  const vResult = await ytGet('/videos', {
    part: 'statistics,snippet,topicDetails',
    id: videoIds.join(','),
  }, 1)

  const vItems = vResult.items ?? []
  const withTags   = vItems.filter(v => (v.snippet?.tags?.length ?? 0) > 0)
  const withCat    = vItems.filter(v => v.snippet?.categoryId)
  const withTopics = vItems.filter(v => (v.topicDetails?.topicCategories?.length ?? 0) > 0)

  console.log(`     Видео в ответе: ${vItems.length}`)
  console.log(`     С tags:             ${withTags.length}/${vItems.length} (${Math.round(withTags.length/vItems.length*100)}%)`)
  console.log(`     С categoryId:       ${withCat.length}/${vItems.length} (${Math.round(withCat.length/vItems.length*100)}%)`)
  console.log(`     С topicCategories:  ${withTopics.length}/${vItems.length} (${Math.round(withTopics.length/vItems.length*100)}%)`)

  if (withTags.length) {
    console.log(`\n     Пример тегов (3 видео):`)
    for (const v of withTags.slice(0, 3)) {
      console.log(`       "${(v.snippet?.title ?? '').slice(0, 50)}": [${(v.snippet?.tags ?? []).slice(0, 4).join(' | ')}]`)
    }
  }
  if (withCat.length) {
    const cats = [...new Set(withCat.map(v => v.snippet.categoryId))]
    console.log(`     categoryId значения: ${cats.join(', ')} (10=Music, 28=Science&Tech, 22=People&Blogs...)`)
  }
  if (withTopics.length) {
    const topics = withTopics[0]?.topicDetails?.topicCategories ?? []
    console.log(`     Пример topicCategories: ${topics.slice(0, 3).join(', ')}`)
  }

  // ── Q3+Q5: 50 titles for Haiku sub-niche extraction ─────────
  const titles = vItems.map(v => v.snippet?.title).filter(Boolean)

  console.log(`\n[Q3+Q5] ${titles.length} заголовков (топ по просмотрам):`)
  titles.forEach((t, i) => console.log(`   ${String(i+1).padStart(2)}. ${t}`))

  // ── Haiku: sub-niches from real titles ───────────────────────
  console.log('\n[Q5] Haiku: определяет подниши из реальных заголовков...')
  const anthropic = new Anthropic({ apiKey: ANTH_KEY })
  const titlesBlock = titles.map((t, i) => `${i+1}. ${t}`).join('\n')

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Ниже — ${titles.length} реальных заголовков видео с YouTube по запросу "${broadQuery}" (Россия, топ по просмотрам за всё время).

Задача: определи 12-18 различных **подниш контент-мейкеров**, которые реально представлены в этих данных.
"Подниша контент-мейкера" — это тема, на которой можно строить YouTube-канал (урок, обзор, туториал, влог и т.д.).
Если большинство заголовков — это клипы/песни без образовательного контента — честно скажи об этом в поле "note".

Для каждой подниши:
• name — название
• search_query — 2-3 слова как поисковый запрос на YouTube
• examples — 2-3 заголовка из списка, иллюстрирующих подниш (или "(нет примеров)" если не нашёл)
• count — сколько примерно из ${titles.length} заголовков относится

ФОРМАТ — строго JSON:
{"note":"...(опционально)...","sub_niches":[{"name":"...","search_query":"...","examples":["..."],"count":0},...]}

ЗАГОЛОВКИ:
${titlesBlock}

Только JSON. Начни с {.`,
    }],
  })

  console.log(`     Haiku: in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}`)

  const rawText = msg.content.find(b => b.type === 'text')?.text ?? ''
  let parsed = null
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0])
  } catch (e) { console.error('     JSON parse error:', e.message, '\nRaw:', rawText.slice(0, 500)) }

  const realNiches = parsed?.sub_niches ?? []
  const note = parsed?.note

  if (note) {
    console.log(`\n     Haiku NOTE: ${note}`)
  }

  console.log(`\n     Подниши из реальных заголовков (${realNiches.length}):`)
  for (const n of realNiches) {
    const ex = n.examples?.filter(e => e !== '(нет примеров)').slice(0, 1)[0] ?? ''
    console.log(`       • ${n.name} [${n.search_query}] ~${n.count}шт.${ex ? ` → "${ex.slice(0,50)}"` : ''}`)
  }

  // ── Q3: достаточно ли 50 заголовков? ────────────────────────
  console.log('\n[Q3] Оценка: достаточно ли 50 заголовков для 15-18 подниш?')
  if (realNiches.length >= 12) {
    console.log(`     Да: Haiku выделил ${realNiches.length} подниш из ${titles.length} заголовков.`)
  } else {
    console.log(`     Частично: только ${realNiches.length} подниш. Вероятно, ${broadQuery} возвращает однородный контент.`)
    console.log(`     Для 15-18 подниш нужно 2-3 поиска с разными запросами или сортировками.`)
  }

  // ── Q4: quota estimate ───────────────────────────────────────
  console.log('\n[Q4] Расход quota для "из заголовков" варианта:')
  console.log(`     1× search.list (50 видео из широкой ниши): +100 юнитов`)
  console.log(`     1× videos.list (statistics+snippet):        +1 юнит`)
  console.log(`     Итого добавка к текущим 2035:              +101 юнитов = ~5% overhead`)
  console.log(`     Альтернатива с 3 поисками: +300+3 = 303 юниц (~15% overhead)`)

  // ── Q5 comparison ────────────────────────────────────────────
  console.log('\n[Q5] Сравнение: из памяти модели vs из реальных заголовков:')
  console.log('\n     ИЗ ПАМЯТИ (текущий подход):')
  MEMORY_NICHES.forEach((n, i) => console.log(`       ${i+1}. ${n}`))

  console.log('\n     ИЗ РЕАЛЬНЫХ ЗАГОЛОВКОВ:')
  realNiches.forEach((n, i) => console.log(`       ${i+1}. ${n.name}`))

  const memSet  = new Set(MEMORY_NICHES.map(n => n.toLowerCase()))
  const realSet = new Set(realNiches.map(n => n.name.toLowerCase()))
  const overlap = [...realSet].filter(n => [...memSet].some(m =>
    m.includes(n.split(' ')[0]) || n.includes(m.split(' ')[0])
  ))
  console.log(`\n     Примерное пересечение: ${overlap.length} из ${Math.max(memSet.size, realSet.size)}`)

  return { titles, realNiches }
}


// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════

;(async () => {
  console.log('РАЗВЕДКА: growth_ratio bias + реальные заголовки')
  console.log(`Дата: ${new Date().toISOString()}\n`)

  const p1 = await part1('лаунж музыка')
  const p2 = await part2('музыка')

  hr('═')
  console.log('ИТОГ ПО ОБЕИМ ЧАСТЯМ')
  hr('═')

  console.log(`\nЧАСТЬ 1 — growth_ratio bias:`)
  console.log(`  Медиана возраста свежих: ${fmt(p1.mFreshAge)} дней`)
  console.log(`  Медиана возраста старых: ${fmt(p1.mOldAge)} дней`)
  console.log(`  Разрыв: ${fmt(p1.mOldAge / p1.mFreshAge)}x`)
  console.log(`  Текущий gr: ${fmt(p1.grRaw)}  →  views/day gr: ${fmt(p1.grAdj)}`)

  console.log(`\nЧАСТЬ 2 — реальные заголовки:`)
  console.log(`  Заголовков получено: ${p2.titles.length}`)
  console.log(`  Подниш Haiku нашёл: ${p2.realNiches.length}`)

  console.log(`\nИтого YouTube quota: ${totalQuota} юнитов`)
})().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
