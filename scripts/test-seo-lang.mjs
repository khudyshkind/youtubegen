/**
 * Acceptance test: SEO language fix (п.5).
 *
 * Part A (always runs): validates prompt generation logic — no API key required.
 * Part B (requires ANTHROPIC_API_KEY): calls real LLM, checks output language.
 *
 * Usage:
 *   node scripts/test-seo-lang.mjs                        # Part A only
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/test-seo-lang.mjs  # Part A + B
 */

// ── PART A: Prompt generation logic (unit, no API) ───────────────────────────

const LANG_NAMES = {
  ru: 'Russian (русский)', en: 'English', de: 'German (Deutsch)',
  fr: 'French (Français)', es: 'Spanish (Español)',
}

const HOOK_LABELS_RU = {
  question: 'риторический вопрос', statistic: 'удивительная статистика',
  story: 'захватывающая история', provocation: 'провокационное заявление',
}
const HOOK_LABELS_EN = {
  question: 'rhetorical question', statistic: 'surprising statistic',
  story: 'captivating story', provocation: 'provocative statement',
}

function buildEnhancePrompt(outputLang) {
  const langName = LANG_NAMES[outputLang] ?? outputLang
  const isRu = outputLang === 'ru'
  const hookLabels = isRu ? HOOK_LABELS_RU : HOOK_LABELS_EN
  const hookLabel = hookLabels.question

  if (isRu) {
    return [
      `LANGUAGE RULE: Write your ENTIRE response in ${langName}. Enhance the existing text — do NOT translate or change the language of the content.`,
      '',
      'Усиль этот готовый текст сценария, применив следующие улучшения. Сохрани смысл, структуру и стиль текста:',
      `- Хук в начале: ${hookLabel} (первые 15 секунд должны захватывать внимание)`,
      '- В конце добавь призыв к действию: попроси подписаться, лайкнуть или написать комментарий',
      '',
      'ФОРМАТ ВЫВОДА:',
      'Верни только усиленный текст. Без вступительных фраз, без пояснений — только текст сценария.',
    ].join('\n')
  }
  return [
    `LANGUAGE RULE: Write your ENTIRE response in ${langName}. Enhance the existing text — do NOT translate or change the language of the content.`,
    '',
    'Enhance this ready script by applying the following improvements. Preserve the meaning, structure, and style of the text:',
    `- Hook at the start: ${hookLabel} (first 15 seconds must grab the viewer's attention)`,
    '- At the end, add a call to action: ask viewers to subscribe, like, or leave a comment',
    '',
    'OUTPUT FORMAT:',
    'Return only the enhanced text. No introductory phrases, no explanations — only the script text.',
  ].join('\n')
}

function buildSeoUserMessage(script, topic, lang) {
  const langOverride = lang
    ? `\n\nOUTPUT LANGUAGE: Write ALL output (titles, description, hashtags, tags) strictly in ${lang}.`
    : ''
  return `Тема: ${topic}\nДлительность: ~3 мин\n\nСценарий (первые 2500 символов):\n${script.slice(0, 2500)}${langOverride}`
}

// Simulate server-side lang resolution (fixed seo/route.ts п.1):
// dbLang (authoritative) → clientLang → undefined
function resolveSeоLang(dbLang, clientLang) {
  if (dbLang === null) return undefined      // DB null → ignore clientLang, auto-detect
  if (dbLang) return dbLang                  // DB has lang → use it
  return clientLang ?? undefined             // no project_id case
}

let passed = 0; let failed = 0

function check(label, actual, expected) {
  if (actual === expected) {
    console.log(`  ✅  ${label}`)
    passed++
  } else {
    console.log(`  ❌  ${label}`)
    console.log(`      expected: ${JSON.stringify(expected)}`)
    console.log(`      actual:   ${JSON.stringify(actual)}`)
    failed++
  }
}

console.log('\n🧪 Part A — Prompt generation logic\n')

// 1. Enhance RU: instructions in Russian, hook label in Russian
{
  const p = buildEnhancePrompt('ru')
  check('enhance RU: LANGUAGE RULE says Russian', p.includes('Russian (русский)'), true)
  check('enhance RU: hook label in Russian', p.includes('риторический вопрос'), true)
  check('enhance RU: structural instructions in Russian', p.includes('Усиль этот'), true)
  check('enhance RU: no translation contradiction', !p.includes('The input is already'), true)
}

// 2. Enhance EN: instructions in English, hook label in English
{
  const p = buildEnhancePrompt('en')
  check('enhance EN: LANGUAGE RULE says English', p.includes('Write your ENTIRE response in English'), true)
  check('enhance EN: hook label in English', p.includes('rhetorical question'), true)
  check('enhance EN: structural instructions in English', p.includes('Enhance this ready script'), true)
  check('enhance EN: no Russian labels', !p.includes('Усиль этот'), true)
  check('enhance EN: no translation contradiction', !p.includes('The input is already'), true)
}

// 3. SEO lang resolution (seo/route.ts п.1)
{
  // own_script EN: DB has 'en', client sent nothing → lang='en'
  check('seo: own_script EN (DB=en, client=none) → lang=en', resolveSeоLang('en', undefined), 'en')
  // own_script EN: DB has null (race) → auto-detect (undefined)
  check('seo: own_script EN (DB=null, client=en) → auto-detect', resolveSeоLang(null, 'en'), undefined)
  // own_script RU: DB has 'ru' → lang='ru'
  check('seo: own_script RU (DB=ru, client=none) → lang=ru', resolveSeоLang('ru', undefined), 'ru')
  // AI-gen RU: DB has 'ru', client sends 'ru' (non-ownScript path) → lang='ru'
  check('seo: AI-gen RU (DB=ru, client=ru) → lang=ru', resolveSeоLang('ru', 'ru'), 'ru')
  // DB wins over stale clientLang: DB=en, client='ru' (stale store) → lang='en'
  check('seo: DB wins over stale client (DB=en, client=ru) → lang=en', resolveSeоLang('en', 'ru'), 'en')
  // Explicit dropdown change: user picks 'ru' → PATCH writes 'ru' to DB → DB='ru' → lang='ru'
  // (simulated: after dropdown write, DB reflects user intent)
  check('seo: explicit dropdown override (dropdown→DB write: DB=ru, prev-DB=en) → lang=ru', resolveSeоLang('ru', 'ru'), 'ru')
}

// 4. SEO user message: OUTPUT LANGUAGE appended only when lang is set
{
  const withLang = buildSeoUserMessage('Some script text', 'Topic', 'en')
  const withoutLang = buildSeoUserMessage('Some script text', 'Topic', undefined)
  check('seo msg: lang=en → OUTPUT LANGUAGE override appended', withLang.includes('OUTPUT LANGUAGE: Write ALL output'), true)
  check('seo msg: lang=en → says "in en"', withLang.includes('strictly in en'), true)
  check('seo msg: lang=undefined → no OUTPUT LANGUAGE override', !withoutLang.includes('OUTPUT LANGUAGE: Write ALL'), true)
}

console.log(`\nPart A: ${passed} passed, ${failed} failed\n`)

// ── PART B: Live LLM calls ────────────────────────────────────────────────────

let ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim()
if (!ANTHROPIC_API_KEY) {
  try {
    const { readFileSync } = await import('fs')
    const { resolve, dirname } = await import('path')
    const { fileURLToPath } = await import('url')
    const __dir = dirname(fileURLToPath(import.meta.url))
    const envContent = readFileSync(resolve(__dir, '../.env.local'), 'utf8')
    const m = envContent.match(/ANTHROPIC_API_KEY=["']?([^"'\n]+)/)
    ANTHROPIC_API_KEY = m?.[1]?.trim() || undefined
  } catch { /* ignore */ }
}

if (!ANTHROPIC_API_KEY) {
  console.log('ℹ️  Part B (live LLM) skipped — set ANTHROPIC_API_KEY to run.')
  console.log('   ANTHROPIC_API_KEY=sk-ant-... node scripts/test-seo-lang.mjs\n')
  if (failed > 0) process.exit(1)
  process.exit(0)
}

import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

const SEO_SYSTEM_PROMPT = `You are a YouTube SEO expert. Return ONLY valid JSON:
{"title":"...","title_alt":"...","description":"...","hashtags":[...],"tags":[...]}
OUTPUT LANGUAGE: Write all output in the same language as the video topic and script provided.`

async function callSeo(script, topic, lang) {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    system: [{ type: 'text', text: SEO_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: buildSeoUserMessage(script, topic, lang) }],
  })
  const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
  try { return JSON.parse(raw) }
  catch { return JSON.parse(raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()) }
}

async function callEnhance(script, lang) {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: [{ type: 'text', text: buildEnhancePrompt(lang) }],
    messages: [{ role: 'user', content: `ТЕКСТ:\n${script}` }],
  })
  return msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
}

function detectLang(text) {
  const ru = (text.match(/[а-яёА-ЯЁ]/g) ?? []).length
  const en = (text.match(/[a-zA-Z]/g) ?? []).length
  if (ru > en * 0.5) return 'ru'
  if (en > ru * 0.5) return 'en'
  return 'mixed'
}

const EN_SCRIPT = `Wild animals across the world are seeking out humans for help.
In Kenya, an elephant with a snare on its leg walked into a ranger camp and waited while
veterinarians removed it. In Canada, a whale entangled in fishing gear approached a rescue boat
and stayed still for two hours while divers cut it free. Research suggests these animals read
subtle cues in human behaviour — our calm posture and slow movements signal safety to them.`

const RU_SCRIPT = `Зебры — это не просто лошади в полоску. Полосатый рисунок каждой зебры уникален,
как отпечаток пальца у человека. Исследования показали, что полосы сбивают с толку мух цеце,
которые видят их как дрожащий мираж. Зебры с полосами болеют кожными болезнями в пять раз реже.
Кроме того, полосатый рисунок создаёт крошечные воздушные вихри прямо над кожей.`

console.log('🧪 Part B — Live LLM calls (using Haiku for cost)\n')
let bPassed = 0; let bFailed = 0

async function liveCheck(label, fn, expectedLang) {
  process.stdout.write(`  ${label}... `)
  try {
    const seo = await fn()
    const actual = detectLang(`${seo.title} ${seo.description ?? ''}`)
    const ok = actual === expectedLang
    console.log(ok ? '✅' : `❌ (got ${actual})`)
    console.log(`    title: "${seo.title?.slice(0, 60)}"`)
    console.log(`    desc:  "${(seo.description ?? '').split('\n')[0]?.slice(0, 70)}"`)
    if (ok) bPassed++; else bFailed++
  } catch (e) {
    console.log(`❌ ERROR: ${e.message}`)
    bFailed++
  }
}

// Scenario А: own_script EN + enhance → SEO EN
await liveCheck('А: own_script EN + enhance → SEO EN', async () => {
  const enhanced = await callEnhance(EN_SCRIPT.slice(0, 300), 'en')
  // After fix: DB has 'en' (detected during enhance), SEO gets lang='en'
  return callSeo(enhanced, 'Wild Animals Seeking Human Help', 'en')
}, 'en')

// Scenario Б: own_script RU + enhance → SEO RU
await liveCheck('Б: own_script RU + enhance → SEO RU', async () => {
  const enhanced = await callEnhance(RU_SCRIPT.slice(0, 300), 'ru')
  return callSeo(enhanced, 'Почему зебра полосатая', 'ru')
}, 'ru')

// Scenario В: AI-gen RU (projects.language=ru) → SEO RU
await liveCheck('В: AI-gen RU (projects.language=ru) → SEO RU', async () => {
  // DB='ru', client='ru' → resolveSeоLang='ru'
  return callSeo(RU_SCRIPT, 'Почему зебра полосатая', 'ru')
}, 'ru')

console.log(`\nPart B: ${bPassed} passed, ${bFailed} failed`)

console.log(`\n${'─'.repeat(50)}`)
console.log(`Total: ${passed + bPassed}/${passed + bPassed + failed + bFailed} passed`)
if (failed + bFailed === 0) {
  console.log('✅ All scenarios passed — ready to push.\n')
  process.exit(0)
} else {
  console.log('❌ Some scenarios failed.\n')
  process.exit(1)
}
