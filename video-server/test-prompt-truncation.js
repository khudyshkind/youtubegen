'use strict'
// Synthetic test: same inputs, two engines.
// Run: node video-server/test-prompt-truncation.js

const LIMIT = 1000

// Exact flat 2D doodle fluxSuffix from image-style-configs.json
const SUFFIX = 'flat 2D doodle cartoon illustration, ALL characters — humans and animals alike — drawn as simple stick-figure doodles with round heads, dot eyes and thin limbs, bold thick black outlines, vibrant saturated flat colors, no shading, no 3D volume, colorful cartoon background environment with props and scenery, playful expressive poses'

// Four character descriptions, each ~160 chars (as added by imgInjectCharacterProfiles)
const DESC_A = 'mid-30s woman, short auburn hair in a neat bun, bright green eyes, no makeup, white lab coat with university badge on left chest, thin silver-rimmed round glasses'
const DESC_B = 'late-40s man, grey temples and short dark hair, strong square jaw, clean-shaven, navy blue suit jacket over white dress shirt, reading glasses pushed up forehead'
const DESC_C = 'early-20s woman, long black hair in a tight ponytail, dark brown eyes, camera strap over right shoulder, olive green field jacket with four pockets, worn boots'
const DESC_D = 'mid-50s man, completely bald with short grey beard, very broad shoulders, khaki tactical vest over black long-sleeve shirt, large black wristwatch, arms crossed'

// Base scene text — 144 chars without injections
const BASE_SCENE = 'Alice and Bob carefully study the ancient map in the laboratory while Carol photographs each detail and Dave stands guard near the main entrance'

// Injected scene (simulating imgInjectCharacterProfiles output — all 4 profiles)
const INJECTED_SCENE = `Alice (${DESC_A}) and Bob (${DESC_B}) carefully study the ancient map in the laboratory while Carol (${DESC_C}) photographs each detail and Dave (${DESC_D}) stands guard near the main entrance`

// ── Truncation function (verbatim from video-server/index.js) ─────────────────
function imgTruncateSecretSliderPrompt(sceneText, fluxSuffix, limit, jobId, sceneIdx) {
  const suffixPart = `, ${fluxSuffix}`
  const full = `${sceneText}${suffixPart}`
  if (full.length <= limit) return full

  const profiles = []
  const profileRe = /\s*\(([^)]{30,})\)/g
  let m
  while ((m = profileRe.exec(sceneText)) !== null) {
    profiles.push(m[0])
  }
  profiles.sort((a, b) => b.length - a.length)

  let trimmedScene = sceneText
  let removedCount = 0
  for (const profileMatch of profiles) {
    if (`${trimmedScene}${suffixPart}`.length <= limit) break
    trimmedScene = trimmedScene.replace(profileMatch, '').replace(/\s{2,}/g, ' ').trim()
    removedCount++
  }

  if (`${trimmedScene}${suffixPart}`.length > limit) {
    const maxSceneChars = limit - suffixPart.length
    let cut = maxSceneChars > 0 ? trimmedScene.slice(0, maxSceneChars) : ''
    const lastSpace = cut.lastIndexOf(' ')
    if (lastSpace > 0) cut = cut.slice(0, lastSpace)
    trimmedScene = cut.trim()
  }

  const result = `${trimmedScene}${suffixPart}`
  console.log(`[image-job:${jobId}] prompt truncated scene ${sceneIdx + 1}: было ${full.length} символов, стало ${result.length}, удалено профилей: ${removedCount}`)
  return result
}

// ── Prompt assembly with engine gate (mirrors processImageJob map) ─────────────
function buildPrompt(engine, sceneText, fluxSuffix, jobId, sceneIdx) {
  const cleanedScene = sceneText  // imgSanitizeScenePrompt is a no-op on this test data
  return engine === 'secretslider'
    ? imgTruncateSecretSliderPrompt(cleanedScene, fluxSuffix, LIMIT, jobId, sceneIdx)
    : `${cleanedScene}, ${fluxSuffix}`
}

// ── Shared inputs ──────────────────────────────────────────────────────────────
const fullInput = `${INJECTED_SCENE}, ${SUFFIX}`

console.log('=== ВХОДНЫЕ ДАННЫЕ (общие для обоих случаев) ===')
console.log(`Базовая сцена:     ${BASE_SCENE.length} символов`)
console.log(`Суффикс:           ${SUFFIX.length} символов`)
console.log(`Профиль A (Alice): ${DESC_A.length} символов`)
console.log(`Профиль B (Bob):   ${DESC_B.length} символов`)
console.log(`Профиль C (Carol): ${DESC_C.length} символов`)
console.log(`Профиль D (Dave):  ${DESC_D.length} символов`)
console.log(`Сцена с 4 инъекциями: ${INJECTED_SCENE.length} символов`)
console.log(`Полный промпт до обрезки: ${fullInput.length} символов`)
console.log()

// ── Случай а: secretslider ─────────────────────────────────────────────────────
console.log('=== СЛУЧАЙ А: engine=secretslider ===')
const resultSS = buildPrompt('secretslider', INJECTED_SCENE, SUFFIX, 'TEST-JOB', 0)
console.log(`Длина результата:      ${resultSS.length} символов`)
console.log(`В пределах лимита ${LIMIT}: ${resultSS.length <= LIMIT}`)
console.log(`Суффикс цел:           ${resultSS.endsWith(SUFFIX)}`)
console.log()

// ── Случай б: flux_schnell ────────────────────────────────────────────────────
console.log('=== СЛУЧАЙ Б: engine=flux_schnell ===')
const resultFS = buildPrompt('flux_schnell', INJECTED_SCENE, SUFFIX, 'TEST-JOB', 0)
console.log(`Длина результата:      ${resultFS.length} символов`)
console.log(`Промпт НЕ обрезан:     ${resultFS.length === fullInput.length}`)
console.log(`Все 4 профиля в тексте: ${resultFS.includes(DESC_A) && resultFS.includes(DESC_B) && resultFS.includes(DESC_C) && resultFS.includes(DESC_D)}`)
console.log(`Суффикс цел:           ${resultFS.endsWith(SUFFIX)}`)
