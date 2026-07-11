// Compares RU vs EN translation keys in i18n.ts and reports missing keys.
// Usage: node scripts/check-i18n.mjs
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(__dir, '../src/lib/i18n.ts'), 'utf8')

// Match 'key': 'value', 'key': `value`, or 'key': "value"
function extractKeys(block) {
  const keys = new Set()
  for (const m of block.matchAll(/'([^']+)':\s*['"`]/g)) keys.add(m[1])
  return keys
}

// Split file into RU and EN sections
const ruMatch = src.match(/ru:\s*\{([\s\S]*?)(?=\n  en:)/)
const enMatch = src.match(/en:\s*\{([\s\S]*?)(?=\n\} as const)/)
if (!ruMatch || !enMatch) { console.error('Could not parse i18n.ts sections'); process.exit(1) }

const ruKeys = extractKeys(ruMatch[1])
const enKeys = extractKeys(enMatch[1])

const missingInEn = [...ruKeys].filter(k => !enKeys.has(k)).sort()
const missingInRu = [...enKeys].filter(k => !ruKeys.has(k)).sort()

const ok = missingInEn.length === 0 && missingInRu.length === 0

console.log(`\n📊 i18n parity check`)
console.log(`   RU keys: ${ruKeys.size}   EN keys: ${enKeys.size}\n`)

if (missingInEn.length) {
  console.log(`❌ Missing in EN (${missingInEn.length}):`)
  missingInEn.forEach(k => console.log(`   - ${k}`))
} else {
  console.log('✅ EN has all RU keys')
}

if (missingInRu.length) {
  console.log(`\n❌ Missing in RU (${missingInRu.length}):`)
  missingInRu.forEach(k => console.log(`   - ${k}`))
} else {
  console.log('✅ RU has all EN keys')
}

console.log(ok ? '\n✅ 0 расхождений — локали синхронны\n' : `\n❌ Найдено расхождений: ${missingInEn.length + missingInRu.length}\n`)
process.exit(ok ? 0 : 1)
