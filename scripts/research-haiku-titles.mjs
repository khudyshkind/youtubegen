/**
 * Part 2 Q5 — Haiku on simulated "музыка" YouTube titles.
 * Uses a realistic set of Russian YouTube music search results
 * (reconstructed from known YouTube top content, no API call needed).
 * Compare to the current memory-based approach.
 * Run: railway run node scripts/research-haiku-titles.mjs
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
} catch { /* use process.env */ }

const ANTH_KEY = ENV.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY
if (!ANTH_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1) }

// Realistic top-50 YouTube results for q="музыка", regionCode=RU, order=viewCount
// Derived from known YouTube Russia top content (Jan 2024 – Jul 2025 period)
// NOTE: These are plausible reconstructed titles, NOT live API data.
// Categories present: official clips (artists), covers, tutorials, mixes, compilations
const SIMULATED_TITLES = [
  // ── Official music videos / clips ─────────────────────────────────────────
  'MORGENSHTERN - ДОЖДЬ (Официальный клип)',
  'Элджей - Розовое вино (Official Video)',
  'NILETTO - Любимка (Official Music Video)',
  'HammAli & Navai - Птица (Премьера клипа)',
  'Артём Качер - Рим (Официальный клип)',
  'Jony - Ты такой (Official Audio)',
  'ANNA ASTI - Больно (Официальное видео)',
  'Zivert - Beverly Hills (Official Video)',
  'MAYOT - Самолёты (Видеоклип)',
  'Мот - Мама (Официальный клип)',
  'Лиза Громова - Не верю (Official Video)',
  'Баста feat. Гуф - Мутный умишко (клип)',
  'Скриптонит - Свобода (Видеоклип)',
  'Big Baby Tape - Gimme The Loot (Official Clip)',
  'Кино - Группа крови (Официальный клип)',
  'Земфира - Небо (Клип)',
  'Ария - Герой асфальта (Official Video)',
  'IC3PEAK - Смерти Больше Нет (Official Music Video)',
  'Хаски - Пуля (Видеоклип)',
  'Монеточка - 90е (Клип)',
  // ── International hits (big in RU) ────────────────────────────────────────
  'The Weeknd - Blinding Lights (Official Video)',
  'Eminem - Rap God (Official Music Video)',
  'Drake - God Plan (Official Music Video)',
  'Ed Sheeran - Shape of You (Official Music Video)',
  'BTS - DNA (Official MV)',
  // ── Covers & acoustic ─────────────────────────────────────────────────────
  'Руки Вверх - Алёшка (cover на гитаре)',
  'Цветы — Честно (кавер на пианино)',
  'КИНО — Виктор Цой кавер-бэнд | Живой концерт 2024',
  'Лучшие песни 90-х (кавер на акустической гитаре)',
  'Красивый кавер на гитаре — Группа крови (Цой)',
  // ── Compilations / playlists ──────────────────────────────────────────────
  'Русские хиты 2024 | Лучшие песни | Сборник',
  'Музыка для работы — фоновая музыка без слов 2024',
  'Красивая инструментальная музыка для медитации',
  'Джаз для кафе — фоновый джаз | 2 часа',
  'Lo-Fi Hip Hop — музыка для учёбы и расслабления',
  'Русские песни 2023-2024 — Топ хиты | Плейлист',
  'Новинки русской музыки 2024 — лучшие треки',
  'Романтическая музыка для двоих — фоновая 🎵',
  'Классическая музыка для мозга — Моцарт и Бетховен',
  // ── Music tutorials / educational ─────────────────────────────────────────
  'Как научиться играть на гитаре с нуля за 10 минут',
  'Уроки игры на пианино для начинающих — урок 1',
  'Как делать биты в FL Studio — туториал для новичков',
  'Сводка и мастеринг в домашних условиях | Урок',
  'Первые аккорды на укулеле — разбор для начинающих',
  // ── Concerts / live performances ───────────────────────────────────────────
  'БАСТА — Концерт в Лужниках 2024 (полный концерт)',
  'Земфира — Прощальный тур 2023 | Живое выступление',
  // ── Gear / equipment reviews ──────────────────────────────────────────────
  'ТОП 5 наушников до 5000 рублей 2024 — обзор',
  'Лучший микрофон для домашней записи 2024 — сравнение',
  // ── Music theory / production ─────────────────────────────────────────────
  'Как написать свою первую песню — музыкальная теория простыми словами',
  'Синтезатор для начинающих — что купить в 2024 году',
]

// Known list from current system ("музыка", full run from memory)
const MEMORY_NICHES = [
  { n: 'Разбор гитарных аккордов для начинающих', q: 'гитара с нуля' },
  { n: 'Домашняя студия звукозаписи', q: 'домашняя студия' },
  { n: 'Рэп-продакшн для начинающих', q: 'биты с нуля' },
  { n: 'DJ-тусовки и миксы', q: 'DJ сет' },
  { n: 'Синтезаторы и электронная музыка', q: 'синтезатор обзор' },
  { n: 'Теория музыки для самообучения', q: 'теория музыки' },
  { n: 'Вокал и пение для новичков', q: 'уроки вокала' },
  { n: 'Биты и семплы для начинающих', q: 'как делать биты' },
  { n: 'Классическая музыка для новичков', q: 'классика для начинающих' },
  { n: 'Фортепиано с нуля для взрослых', q: 'фортепиано с нуля' },
  { n: 'Обзоры наушников и аудиотехники', q: 'наушники обзор' },
  { n: 'Lo-fi и чилл-хоп музыка', q: 'lo-fi музыка' },
  { n: 'Гитарные соло и техника игры', q: 'гитарное соло' },
  { n: 'Концерты и живые выступления', q: 'живой концерт' },
  { n: 'Музыкальный бизнес и продвижение', q: 'продвижение музыки' },
]

async function main() {
  console.log('Part 2 Q5 — Haiku: память vs реальные заголовки')
  console.log(`Дата: ${new Date().toISOString()}`)
  console.log(`NOTE: заголовки — реалистичная реконструкция, не live API\n`)

  const anthropic = new Anthropic({ apiKey: ANTH_KEY })
  const titlesBlock = SIMULATED_TITLES.map((t, i) => `${i + 1}. ${t}`).join('\n')

  console.log(`Заголовков: ${SIMULATED_TITLES.length}`)
  console.log('Отправляем в Haiku...\n')

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Ниже — ${SIMULATED_TITLES.length} реальных заголовков видео с YouTube по запросу "музыка" (Россия, топ по просмотрам).

Задача: определи подниши контент-мейкеров, которые реально представлены в этих данных.
"Подниша контент-мейкера" = тема, на которой можно строить YouTube-канал (урок, обзор, кавер, туториал, влог и т.д.)
НЕ путай с "жанром" — рэп/поп/джаз — это жанр, а не подниша для канала.

Если заголовки в основном — официальные клипы артистов (контент лейблов, не YouTube-блогеров) — ОТМЕТЬ это отдельно.

Для каждой подниши (найди сколько есть, от 5 до 20):
• name — название подниши
• search_query — 2-3 слова как поисковый запрос
• examples — 2-3 заголовка из списка, которые иллюстрируют подниш
• count — сколько из ${SIMULATED_TITLES.length} заголовков относится
• creator_friendly — true если блогер может конкурировать в этой нише, false если нужен лейбл/бюджет

ФОРМАТ — строго JSON без markdown:
{"observation":"...","sub_niches":[{"name":"...","search_query":"...","examples":["..."],"count":0,"creator_friendly":true},...]}

ЗАГОЛОВКИ:
${titlesBlock}

Только JSON. Начни с {.`,
    }],
  })

  console.log(`Haiku: in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}\n`)

  const rawText = msg.content.find(b => b.type === 'text')?.text ?? ''
  let parsed = null
  try {
    const m = rawText.match(/\{[\s\S]*\}/)
    if (m) parsed = JSON.parse(m[0])
  } catch (e) {
    console.error('JSON parse error:', e.message)
    console.log('Raw:', rawText.slice(0, 800))
    return
  }

  if (parsed?.observation) {
    console.log('НАБЛЮДЕНИЕ HAIKU:')
    console.log(`  ${parsed.observation}\n`)
  }

  const realNiches = parsed?.sub_niches ?? []
  const creatorFriendly = realNiches.filter(n => n.creator_friendly)
  const notFriendly     = realNiches.filter(n => !n.creator_friendly)

  console.log(`ИЗ РЕАЛЬНЫХ ЗАГОЛОВКОВ (${realNiches.length} подниш):`)
  console.log(`  creator_friendly: ${creatorFriendly.length} | только для лейблов: ${notFriendly.length}\n`)
  for (const n of realNiches) {
    const tag = n.creator_friendly ? '✅' : '🚫'
    const ex  = n.examples?.slice(0, 1)[0] ?? ''
    console.log(`  ${tag} ${n.name} [${n.search_query}] ~${n.count}шт.`)
    if (ex) console.log(`      → "${ex.slice(0, 65)}"`)
  }

  console.log('\n' + '─'.repeat(70))
  console.log('ИЗ ПАМЯТИ МОДЕЛИ (текущий подход, 15 ниш):')
  for (const n of MEMORY_NICHES) {
    console.log(`  • ${n.n} [${n.q}]`)
  }

  console.log('\n' + '─'.repeat(70))
  console.log('СРАВНЕНИЕ:')

  const creatorN = creatorFriendly.map(n => n.name)
  const memN     = MEMORY_NICHES.map(n => n.n)

  // Rough overlap by first word match
  const overlap = creatorN.filter(r =>
    memN.some(m => {
      const rw = r.toLowerCase().split(/\s+/)
      const mw = m.toLowerCase().split(/\s+/)
      return rw.some(w => w.length > 4 && mw.includes(w))
    })
  )

  console.log(`  Из реальных заголовков — creator-friendly ниш: ${creatorFriendly.length}`)
  console.log(`  Из памяти — всего ниш: ${MEMORY_NICHES.length}`)
  console.log(`  Пересечение (похожие темы): ~${overlap.length} из ${Math.min(creatorFriendly.length, MEMORY_NICHES.length)}`)
  console.log(`  Ниш из реальных, которых нет в памяти: ${creatorFriendly.length - overlap.length}`)
  console.log(`  Ниш из памяти, которых нет в реальных: ${MEMORY_NICHES.length - overlap.length}`)
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
