// Unit test for imgInjectCharacterProfiles — no external API calls

function imgInjectCharacterProfiles(prompts, characters) {
  if (!Array.isArray(characters) || !characters.length) return prompts
  return prompts.map((p) => {
    for (const char of characters) {
      if (!char.name || !char.description) continue
      const nameEscaped = char.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const namePattern = new RegExp(`(?<![\\p{L}\\p{N}_])${nameEscaped}(?![\\p{L}\\p{N}_])`, 'iu')
      if (!namePattern.test(p)) continue
      if (p.includes(char.description)) continue
      p = p.replace(namePattern, `${char.name} (${char.description})`)
    }
    return p
  })
}

let allPassed = true
function assert(label, value) {
  const ok = value === true
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) allPassed = false
}

// ── Suite 1: Latin name, basic cases ─────────────────────────────────────────
console.log('\n=== Suite 1: Latin name basic ===')
const charsMax = [{ name: 'Max', description: 'mid-30s man, short dark hair, no beard, olive skin, blue eyes, red jacket' }]
const prompts1 = [
  'Max runs across the field toward the horizon at sunset',
  'A wide establishing shot of the empty city square with pigeons landing',
  'Max stands at the window looking at the rain outside',
]
const r1 = imgInjectCharacterProfiles(prompts1, charsMax)
console.log('prompt 1:', r1[0])
console.log('prompt 2:', r1[1])
console.log('prompt 3:', r1[2])
assert('prompt 1 changed', r1[0] !== prompts1[0])
assert('prompt 2 unchanged', r1[1] === prompts1[1])
assert('prompt 3 changed', r1[2] !== prompts1[2])
assert('prompt 1 description injected exactly once', (r1[0].match(/mid-30s man/g) || []).length === 1)
assert('prompt 3 description injected exactly once', (r1[2].match(/mid-30s man/g) || []).length === 1)
assert('prompt 1 contains full description', r1[0].includes(charsMax[0].description))
assert('prompt 3 contains full description', r1[2].includes(charsMax[0].description))

// ── Suite 2: Double-injection guard ──────────────────────────────────────────
console.log('\n=== Suite 2: Double-injection guard ===')
const r1b = imgInjectCharacterProfiles(r1, charsMax)
assert('prompt 1 idempotent', r1b[0] === r1[0])
assert('prompt 3 idempotent', r1b[2] === r1[2])

// ── Suite 3: Empty characters guard ──────────────────────────────────────────
console.log('\n=== Suite 3: Empty characters ===')
const rEmpty = imgInjectCharacterProfiles(prompts1, [])
assert('prompt 1 unchanged with empty chars', rEmpty[0] === prompts1[0])

// ── Suite 4: Cyrillic name ────────────────────────────────────────────────────
console.log('\n=== Suite 4: Cyrillic name ===')
const charsAlexey = [{ name: 'Алексей', description: 'mid-40s man, short grey hair, no beard, fair skin, brown eyes, dark blue coat' }]

const promptsCyr = [
  'Алексей стоит у окна и смотрит на улицу',
  'Широкий план пустого городского сквера с голубями',
  'Алексей сидит за столом, заваленным бумагами и книгами',
]
const r4 = imgInjectCharacterProfiles(promptsCyr, charsAlexey)
console.log('prompt 1 (cyr):', r4[0])
console.log('prompt 2 (cyr):', r4[1])
console.log('prompt 3 (cyr):', r4[2])
assert('cyrillic: prompt 1 changed', r4[0] !== promptsCyr[0])
assert('cyrillic: prompt 2 unchanged (no name)', r4[1] === promptsCyr[1])
assert('cyrillic: prompt 3 changed', r4[2] !== promptsCyr[2])
assert('cyrillic: prompt 1 description injected', r4[0].includes(charsAlexey[0].description))
assert('cyrillic: prompt 3 description injected', r4[2].includes(charsAlexey[0].description))

// ── Suite 5: Cyrillic name at start and end of string ─────────────────────────
console.log('\n=== Suite 5: Cyrillic at start/end ===')
const rStartEnd = imgInjectCharacterProfiles([
  'Алексей выходит из подъезда рано утром',
  'Дверь открывается, и в проёме появляется Алексей',
], charsAlexey)
console.log('start:', rStartEnd[0])
console.log('end:  ', rStartEnd[1])
assert('cyrillic: name at start of string — injected', rStartEnd[0].includes(charsAlexey[0].description))
assert('cyrillic: name at end of string — injected', rStartEnd[1].includes(charsAlexey[0].description))

// ── Suite 6: Partial-word guard — "Max" must not match "Maximum" ──────────────
console.log('\n=== Suite 6: Partial-word guard ===')
const rPartial = imgInjectCharacterProfiles(
  ['Maximum effort shown in every scene'],
  charsMax,
)
console.log('partial:', rPartial[0])
assert('Max NOT injected inside "Maximum"', rPartial[0] === 'Maximum effort shown in every scene')

// ── Suite 7: Possessive form "Alexey\'s" ─────────────────────────────────────
console.log('\n=== Suite 7: Possessive form ===')
const charsAlexeyLatin = [{ name: 'Alexey', description: 'mid-40s man, short grey hair, no beard, fair skin, brown eyes, dark blue coat' }]
const rPossessive = imgInjectCharacterProfiles(
  ["Alexey's desk is covered with papers and books"],
  charsAlexeyLatin,
)
console.log('possessive:', rPossessive[0])
assert("possessive: Alexey's — injected", rPossessive[0].includes(charsAlexeyLatin[0].description))

// ── Suite 8: Latin prompt vs Cyrillic profile name — expected no match ────────
console.log('\n=== Suite 8: Cyrillic profile name vs Latin prompt ===')
const rCyrVsLat = imgInjectCharacterProfiles(
  ['Alexey stands by the window in the evening light'],
  charsAlexey, // name is "Алексей"
)
console.log('cyr-vs-lat:', rCyrVsLat[0])
const cyrVsLatNoChange = rCyrVsLat[0] === 'Alexey stands by the window in the evening light'
console.log('actual behavior — no substitution:', cyrVsLatNoChange)
assert('cyrillic name does NOT match latin spelling in prompt (expected)', cyrVsLatNoChange)

// ── Final result ──────────────────────────────────────────────────────────────
console.log('\n=== PASS:', allPassed, '===')
process.exit(allPassed ? 0 : 1)
