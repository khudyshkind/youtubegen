/**
 * Generates preview audio samples for all SecretVoicer voices.
 *
 * Run ONCE manually:
 *   node scripts/generate-sv-previews.mjs
 *
 * Phase 1 — audio generation (always runs, requires only SECRETVOICER_API_KEY):
 *   Downloads MP3 for each voice → saves to tmp/sv-previews/{voice_id}.mp3
 *   Skips voices whose file already exists (safe to re-run after partial failure).
 *
 * Phase 2 — Supabase upload (runs if both Supabase vars are set):
 *   Uploads each MP3 to Storage bucket "voice-previews" → public URL
 *   Writes src/data/secretvoicer-previews.json  (voice_id → publicUrl)
 *
 * Required in .env.local:
 *   SECRETVOICER_API_KEY               (mandatory)
 *   NEXT_PUBLIC_SUPABASE_URL           (optional — Phase 2)
 *   SUPABASE_SERVICE_ROLE_KEY          (optional — Phase 2)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

// ─── Load .env.local ────────────────────────────────────────────────────────────

const ROOT      = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP_DIR   = path.join(ROOT, 'tmp', 'sv-previews')
const OUT_PATH  = path.join(ROOT, 'src', 'data', 'secretvoicer-previews.json')
const BUCKET    = 'voice-previews'

function loadEnv() {
  const vars = {}
  try {
    for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
      const stripped = line.replace(/^﻿/, '').trim()
      if (!stripped || stripped.startsWith('#')) continue
      const eq = stripped.indexOf('=')
      if (eq === -1) continue
      const k = stripped.slice(0, eq).trim()
      const v = stripped.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      vars[k] = v
    }
  } catch {
    console.error('Could not read .env.local')
    process.exit(1)
  }
  return vars
}

const envVars = loadEnv()
const e = (key) => (envVars[key] ?? process.env[key] ?? '').replace(/^﻿/, '').trim()

// ─── Config ─────────────────────────────────────────────────────────────────────

const SV_KEY     = e('SECRETVOICER_API_KEY')
const SB_URL     = e('NEXT_PUBLIC_SUPABASE_URL')
const SB_SERVICE = e('SUPABASE_SERVICE_ROLE_KEY')
const SV_BASE    = 'https://secret-voicer.ru/api/v1'
const BATCH_SIZE = 1
const POLL_MS    = 3000
const TIMEOUT_MS = 600_000

if (!SV_KEY) { console.error('Missing SECRETVOICER_API_KEY in .env.local'); process.exit(1) }

const supabaseEnabled = !!(SB_URL && SB_SERVICE)
if (!supabaseEnabled) {
  console.log('ℹ  Supabase vars not found — Phase 2 (upload) will be skipped.')
  console.log('   Add NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to run Phase 2.\n')
}

// ─── Language map (from catalog audit) ──────────────────────────────────────────

const VOICE_LANG = {
  // Russian
  txnCCHHGKmYIwrn7HfHQ: 'ru',
  rQOBu7YxCDxGiFdTm28w: 'ru',
  hU3rD0Yk7DoiYULTX1pD: 'ru',
  m0OQuJtWCw1V23P0pQmG: 'ru',
  MYw0upsxdtxs1n97djly: 'ru',
  eLDtXX7z65CuLasDRxrP: 'ru',
  WczBIOau2qV9z7nLeDqq: 'ru',
  BTL5iDLqtiUxgJtpekus: 'ru',
  // Spanish
  l1zE9xgNpUTaQCZzpNJa: 'es',
  JH302OKVzGGJc47f08ex: 'es',
  Wl3O9lmFSMgGFTTwuS6f: 'es',
  '6sFKzaJr574YWVu4UuJF': 'es',
  // Portuguese
  '80lPKtzJMPh1vjYMUgwe': 'pt',
  x6uRgOliu4lpcrqMH3s1: 'pt',
  '4r3G9XKliGgVZLKMgjik': 'pt',
  cyD08lEy76q03ER1jZ7y: 'pt',
  // German
  Cqbq4nsuUe1we6J45miU: 'de',
  v3V1d2rk6528UrLKRuy8: 'de',
  // French
  tKaoyJLW05zqV0tIH9FD: 'fr',
  // Polish
  g8ZOdhoD9R6eYKPTjKbE: 'pl',
  // Japanese
  G3EZ8O36A0x9lmeOtr0f: 'ja',
}

const SAMPLE_TEXTS = {
  ru: 'Привет! Так звучит мой голос. Этим голосом будет озвучено ваше видео.',
  en: 'Hi! This is how my voice sounds. Your video will be voiced like this.',
  es: '¡Hola! Así suena mi voz. Tu vídeo sonará así.',
  pt: 'Olá! É assim que a minha voz soa. O seu vídeo terá esta voz.',
  de: 'Hallo! So klingt meine Stimme. Dein Video wird so vertont.',
  fr: 'Bonjour ! Voici à quoi ressemble ma voix.',
  pl: 'Cześć! Tak brzmi mój głos.',
  ja: 'こんにちは！これが私の声です。',
}

// ─── SecretVoicer helpers ────────────────────────────────────────────────────────

const svHeaders = {
  'X-API-Key': SV_KEY,
  'Content-Type': 'application/json; charset=utf-8',
}

async function getBalance() {
  const res = await fetch(`${SV_BASE}/balance`, { headers: svHeaders })
  if (!res.ok) throw new Error(`balance HTTP ${res.status}`)
  return (await res.json()).balance
}

async function synthesize(voiceId, text) {
  const body = Buffer.from(JSON.stringify({ voice_id: voiceId, text, mode: 'standard' }), 'utf-8')
  const res = await fetch(`${SV_BASE}/synthesize`, {
    method: 'POST',
    headers: svHeaders,
    body,
  })
  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    throw new Error(`synthesize HTTP ${res.status}: ${raw.slice(0, 200)}`)
  }
  const j = await res.json()
  if (!j.task_id) throw new Error('no task_id in response')
  return String(j.task_id)
}

async function pollTask(taskId) {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_MS))
    try {
      const res = await fetch(`${SV_BASE}/task/${taskId}`, { headers: svHeaders })
      if (!res.ok) continue
      const j = await res.json()
      if (j.status === 'COMPLETED') {
        if (!j.audio_url) throw new Error(`COMPLETED but no audio_url`)
        return j.audio_url
      }
      if (j.status === 'FAILED') throw new Error(`FAILED: ${j.error_message ?? 'unknown'}`)
      // PENDING / LOCAL_PROCESSING — keep waiting
    } catch (inner) {
      if (inner.message.startsWith('FAILED') || inner.message.startsWith('COMPLETED')) throw inner
      // network error — retry next poll
    }
  }
  throw new Error(`timeout after ${TIMEOUT_MS / 1000}s`)
}

async function downloadBuffer(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

// ─── Supabase Storage (Phase 2) ──────────────────────────────────────────────────

async function supabaseFetch(method, urlPath, body, contentType) {
  const res = await fetch(`${SB_URL}/storage/v1${urlPath}`, {
    method,
    headers: {
      apikey: SB_SERVICE,
      Authorization: `Bearer ${SB_SERVICE}`,
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
    ...(body !== undefined ? { body } : {}),
  })
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) }
}

async function ensureBucket() {
  const { json } = await supabaseFetch('GET', '/bucket', undefined)
  const buckets = Array.isArray(json) ? json : []
  if (buckets.some(b => b.name === BUCKET)) return

  const { ok, json: cj } = await supabaseFetch(
    'POST', '/bucket',
    JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
    'application/json'
  )
  if (!ok) throw new Error(`createBucket: ${JSON.stringify(cj)}`)
  console.log(`  ✓ Created bucket "${BUCKET}" (public)`)
}

async function uploadToSupabase(voiceId, buf) {
  const urlPath = `/object/${BUCKET}/secretvoicer/${voiceId}.mp3`
  const { ok, status, json } = await supabaseFetch('PUT', urlPath, buf, 'audio/mpeg')
  if (!ok) {
    // 409 = exists, try upsert via DELETE + PUT
    if (status === 400 || status === 409) {
      await supabaseFetch('DELETE', urlPath, undefined)
      const r2 = await supabaseFetch('POST', urlPath, buf, 'audio/mpeg')
      if (!r2.ok) throw new Error(`upload (retry): ${JSON.stringify(r2.json)}`)
    } else {
      throw new Error(`upload: ${JSON.stringify(json)}`)
    }
  }
  return `${SB_URL}/storage/v1/object/public/${BUCKET}/secretvoicer/${voiceId}.mp3`
}

// ─── Process one voice ────────────────────────────────────────────────────────────

async function processVoice(voice, index, total) {
  const lang    = VOICE_LANG[voice.voice_id] ?? 'en'
  const text    = SAMPLE_TEXTS[lang] ?? SAMPLE_TEXTS.en
  const label   = `[${String(index + 1).padStart(3)}/${total}] ${voice.name.slice(0, 38).padEnd(38)}`
  const localPath = path.join(TMP_DIR, `${voice.voice_id}.mp3`)

  let buf

  // Skip synthesis if local file already exists (allows re-run after partial failure)
  if (existsSync(localPath)) {
    buf = readFileSync(localPath)
    process.stdout.write(`  ~ ${label}  local cache  [${lang}]\n`)
  } else {
    try {
      const taskId  = await synthesize(voice.voice_id, text)
      const audioUrl = await pollTask(taskId)
      buf = await downloadBuffer(audioUrl)
      writeFileSync(localPath, buf)
      process.stdout.write(`  ✓ ${label}  ${(buf.length / 1024).toFixed(0)} KB  [${lang}]\n`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stdout.write(`  ✗ ${label}  ${msg.slice(0, 80)}\n`)
      return { ok: false, error: msg }
    }
  }

  // Phase 2: upload to Supabase
  if (supabaseEnabled) {
    try {
      const publicUrl = await uploadToSupabase(voice.voice_id, buf)
      return { ok: true, publicUrl }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stdout.write(`    ↑ upload failed: ${msg.slice(0, 80)}\n`)
      return { ok: false, error: msg }
    }
  }

  // Phase 1 only — return local path as a placeholder URL
  return { ok: true, publicUrl: null, localPath }
}

// ─── Confirm prompt ───────────────────────────────────────────────────────────────

async function confirm(question) {
  process.stdout.write(question)
  return new Promise(resolve => {
    process.stdin.setEncoding('utf8')
    process.stdin.resume()
    process.stdin.once('data', d => { process.stdin.pause(); resolve(String(d).trim().toLowerCase()) })
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────────────

async function main() {
  // Fetch catalog
  console.log('Fetching SecretVoicer voice catalog...')
  const vRes = await fetch(`${SV_BASE}/voices`, { headers: svHeaders })
  if (!vRes.ok) { console.error('Failed to fetch voices:', vRes.status); process.exit(1) }
  const voices = (await vRes.json()).voices
  console.log(`  ${voices.length} voices`)

  // Count already cached locally
  const alreadyCached = voices.filter(v => existsSync(path.join(TMP_DIR, `${v.voice_id}.mp3`))).length
  const toSynthesize  = voices.length - alreadyCached

  // Balance check (only for voices that need synthesis)
  const balanceBefore = await getBalance()
  const estTokens = voices
    .filter(v => !existsSync(path.join(TMP_DIR, `${v.voice_id}.mp3`)))
    .reduce((sum, v) => {
      const lang = VOICE_LANG[v.voice_id] ?? 'en'
      return sum + (SAMPLE_TEXTS[lang] ?? SAMPLE_TEXTS.en).length
    }, 0)

  console.log(`\nBalance:         ${balanceBefore.toLocaleString()} tokens`)
  console.log(`To synthesize:   ${toSynthesize} voices (~${estTokens.toLocaleString()} tokens)`)
  if (alreadyCached > 0)
    console.log(`Cached locally:  ${alreadyCached} voices (will skip synthesis)`)
  console.log(`Supabase upload: ${supabaseEnabled ? 'YES' : 'NO (Phase 1 only)'}`)

  if (toSynthesize > 0 && balanceBefore < estTokens) {
    console.error(`\n✗ Balance (${balanceBefore}) < estimated usage (${estTokens}). Top up and retry.`)
    process.exit(1)
  }

  if (toSynthesize > 0) {
    const answer = await confirm(`\nProceed with ${toSynthesize} synthesis jobs? (y/N) `)
    if (answer !== 'y') { console.log('Aborted.'); process.exit(0) }
  }

  // Create dirs
  mkdirSync(TMP_DIR, { recursive: true })
  if (supabaseEnabled) mkdirSync(path.join(ROOT, 'src', 'data'), { recursive: true })

  // Ensure Supabase bucket
  if (supabaseEnabled) {
    console.log(`\nChecking bucket "${BUCKET}"...`)
    await ensureBucket()
  }

  // Generate + upload
  console.log(`\nProcessing ${voices.length} voices (batch ${BATCH_SIZE})...\n`)

  const results = {}
  const failed  = []

  for (let i = 0; i < voices.length; i += BATCH_SIZE) {
    const batch = voices.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map((v, bi) => processVoice(v, i + bi, voices.length))
    )
    for (let bi = 0; bi < batch.length; bi++) {
      const voice = batch[bi]
      const res   = batchResults[bi]
      if (res.ok) {
        results[voice.voice_id] = res.publicUrl ?? `file://${path.join(TMP_DIR, `${voice.voice_id}.mp3`)}`
      } else {
        failed.push({ voice_id: voice.voice_id, name: voice.name, error: res.error })
      }
    }
    if (i + BATCH_SIZE < voices.length) await new Promise(r => setTimeout(r, 1500))
  }

  // Balance after
  const balanceAfter = await getBalance()

  // Write JSON (only if Supabase upload ran — local paths aren't useful for runtime)
  if (supabaseEnabled) {
    const publicResults = Object.fromEntries(
      Object.entries(results).filter(([, url]) => url && !url.startsWith('file://'))
    )
    writeFileSync(OUT_PATH, JSON.stringify(publicResults, null, 2) + '\n', 'utf8')
    console.log(`\n  JSON saved: src/data/secretvoicer-previews.json (${Object.keys(publicResults).length} entries)`)
  }

  // Summary
  const successCount = Object.keys(results).length
  console.log('\n' + '═'.repeat(62))
  console.log(`  Generated:         ${successCount} / ${voices.length}`)
  console.log(`  Failed:            ${failed.length}`)
  console.log(`  Tokens spent:      ${(balanceBefore - balanceAfter).toLocaleString()}`)
  console.log(`  Balance remaining: ${balanceAfter.toLocaleString()}`)
  console.log(`  Audio files:       tmp/sv-previews/ (${successCount} MP3s)`)

  if (!supabaseEnabled) {
    console.log('\n  ──────────────────────────────────────────────────────────')
    console.log('  Phase 2 skipped. To upload to Supabase, add to .env.local:')
    console.log('    NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co')
    console.log('    SUPABASE_SERVICE_ROLE_KEY=eyJ...')
    console.log('  Then re-run — already-synthesized voices are cached and')
    console.log('  won\'t cost tokens again.')
    console.log('  ──────────────────────────────────────────────────────────')
  }

  if (failed.length > 0) {
    console.log('\n  Failed voices:')
    for (const f of failed) console.log(`    ${f.voice_id}  ${f.name}\n      → ${f.error}`)
  }

  if (successCount > 0) {
    console.log(`\nFirst 5 results:`)
    for (const [id, url] of Object.entries(results).slice(0, 5)) {
      const name = (voices.find(v => v.voice_id === id)?.name ?? '').slice(0, 35)
      console.log(`  ${id}  ${name.padEnd(35)}  ${url}`)
    }
  }
}

main().catch(err => {
  console.error('\nFatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
