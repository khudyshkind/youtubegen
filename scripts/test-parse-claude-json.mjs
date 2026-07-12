/**
 * Unit tests for parseClaudeJson / parseClaudeJsonArray.
 *
 * Verifies that all Haiku markdown-wrapping patterns are handled correctly.
 * Run: node scripts/test-parse-claude-json.mjs
 */

// We can't import TypeScript directly — inline a JS port of the same logic.
function fixControlCharsInStrings(s) {
  let result = ''
  let inStr = false, esc = false
  for (const c of s) {
    if (esc) { result += c; esc = false; continue }
    if (c === '\\') { result += c; esc = true; continue }
    if (c === '"') { inStr = !inStr; result += c; continue }
    if (inStr) {
      if (c === '\n') { result += '\\n'; continue }
      if (c === '\r') { result += '\\r'; continue }
      if (c === '\t') { result += '\\t'; continue }
    }
    result += c
  }
  return result
}

function tryParse(slice, label) {
  try { return JSON.parse(slice) }
  catch {
    try { return JSON.parse(fixControlCharsInStrings(slice)) }
    catch (e2) { throw new Error(`${label}: JSON parse failed — ${e2.message}`) }
  }
}

function parseClaudeJson(text, label) {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
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
    if (c === '}') { depth--; if (depth === 0) return tryParse(cleaned.slice(start, i + 1), label) }
  }
  const lastBrace = cleaned.lastIndexOf('}')
  if (lastBrace > start) {
    try { return tryParse(cleaned.slice(start, lastBrace + 1), label) } catch { /* pass */ }
  }
  throw new Error(`${label}: unbalanced braces`)
}

function parseClaudeJsonArray(text, label) {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  const start = cleaned.indexOf('[')
  if (start === -1) throw new Error(`${label}: no [ found`)
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '[') depth++
    if (c === ']') { depth--; if (depth === 0) return tryParse(cleaned.slice(start, i + 1), label) }
  }
  const lastBracket = cleaned.lastIndexOf(']')
  if (lastBracket > start) {
    try { return tryParse(cleaned.slice(start, lastBracket + 1), label) } catch { /* pass */ }
  }
  throw new Error(`${label}: unbalanced brackets`)
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { console.log(`  ✅  ${label}`); passed++ }
  else { console.log(`  ❌  ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`); failed++ }
}

// ── parseClaudeJson — title-detect shape ─────────────────────────────────────
console.log('\n🧪 parseClaudeJson — 4 Haiku response patterns\n')

const EXPECTED_OBJ = { title: 'Why Human Skin Color Evolved', language: 'en' }

// Case 1: bare JSON (Haiku following instructions correctly)
check(
  'bare JSON',
  parseClaudeJson('{"title":"Why Human Skin Color Evolved","language":"en"}', 'test'),
  EXPECTED_OBJ,
)

// Case 2: ```json fence (the bug we saw in prod DB)
check(
  '```json fence',
  parseClaudeJson('```json\n{"title":"Why Human Skin Color Evolved","language":"en"}\n```', 'test'),
  EXPECTED_OBJ,
)

// Case 3: plain ``` fence
check(
  '``` fence',
  parseClaudeJson('```\n{"title":"Why Human Skin Color Evolved","language":"en"}\n```', 'test'),
  EXPECTED_OBJ,
)

// Case 4: preamble text + JSON (model adds explanation)
check(
  'preamble text before JSON',
  parseClaudeJson('Here is the JSON:\n{"title":"Why Human Skin Color Evolved","language":"en"}', 'test'),
  EXPECTED_OBJ,
)

// ── parseClaudeJson — regex fallback: language survives parse failure ─────────
// (This simulates the old catch block regex — verify parseClaudeJson handles it)
console.log('\n🧪 parseClaudeJson — multiline with indented JSON (Haiku pretty-print)\n')

check(
  'pretty-printed JSON in fence',
  parseClaudeJson(
    '```json\n{\n  "title": "Why Human Skin Color Evolved",\n  "language": "en"\n}\n```',
    'test',
  ),
  EXPECTED_OBJ,
)

// ── parseClaudeJsonArray ───────────────────────────────────────────────────────
console.log('\n🧪 parseClaudeJsonArray — 4 patterns\n')

const EXPECTED_ARR = [{ title: 'Intro', description: 'Opening hook' }]

check(
  'bare array',
  parseClaudeJsonArray('[{"title":"Intro","description":"Opening hook"}]', 'plan-test'),
  EXPECTED_ARR,
)

check(
  '```json fence around array',
  parseClaudeJsonArray('```json\n[{"title":"Intro","description":"Opening hook"}]\n```', 'plan-test'),
  EXPECTED_ARR,
)

check(
  'preamble text before array',
  parseClaudeJsonArray('Here is the plan:\n[{"title":"Intro","description":"Opening hook"}]', 'plan-test'),
  EXPECTED_ARR,
)

check(
  'multi-element array',
  parseClaudeJsonArray(
    '[{"title":"Intro","description":"Opening hook"},{"title":"Part 2","description":"Details"}]',
    'plan-test',
  ),
  [EXPECTED_ARR[0], { title: 'Part 2', description: 'Details' }],
)

// ── SEO topic sentinel filter (logic test) ────────────────────────────────────
console.log('\n🧪 SEO topic sentinel — "Свой текст" omitted from user message\n')

function buildTopicLine(topic) {
  return topic && topic !== 'Свой текст' ? `Тема: ${topic}` : ''
}

check('real topic: included',    buildTopicLine('Почему небо синее'), 'Тема: Почему небо синее')
check('real EN topic: included', buildTopicLine('Why is the sky blue?'), 'Тема: Why is the sky blue?')
check('"Свой текст": omitted',   buildTopicLine('Свой текст'), '')
check('empty topic: omitted',    buildTopicLine(''), '')

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`)
console.log(`Total: ${passed}/${passed + failed} passed`)
if (failed === 0) {
  console.log('✅ All parse tests passed.\n')
  process.exit(0)
} else {
  console.log('❌ Some tests failed.\n')
  process.exit(1)
}
