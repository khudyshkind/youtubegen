/**
 * Backfill projects.language for own-script projects where language IS NULL.
 * Dry-run by default — add --write to actually update.
 *
 * Usage:
 *   node scripts/backfill-language.mjs          # dry-run: prints id → detected language
 *   node scripts/backfill-language.mjs --write  # live: writes to DB
 *
 * Detection strategy:
 *   - If >40% of word-chars are Cyrillic → 'ru' (fast, no LLM)
 *   - Otherwise → Haiku ISO-639-1 detection (single call per project)
 */

import { createClient } from '@supabase/supabase-js'

const WRITE = process.argv.includes('--write')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
)

// Script char ratio heuristics — no LLM needed for ru/en
function cyrillicRatio(text) {
  const chars = text.replace(/\s+/g, '').split('')
  if (chars.length === 0) return 0
  return chars.filter((c) => /[Ѐ-ӿ]/.test(c)).length / chars.length
}

function latinRatio(text) {
  const chars = text.replace(/\s+/g, '').split('')
  if (chars.length === 0) return 0
  return chars.filter((c) => /[a-zA-Z]/.test(c)).length / chars.length
}

function detectLanguage(script) {
  const sample = script.slice(0, 1000)
  const cyr = cyrillicRatio(sample)
  const lat = latinRatio(sample)
  if (cyr > 0.35) return 'ru'
  if (lat > 0.50) return 'en'
  // Mixed or other script — can't determine without LLM
  return null
}

async function main() {
  console.log(`Mode: ${WRITE ? 'WRITE (live)' : 'DRY-RUN (no changes)'}`)
  console.log('')

  // Own-script projects: language IS NULL, script is non-null, topic is sentinel
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, topic, script, language')
    .is('language', null)
    .not('script', 'is', null)
    .order('created_at', { ascending: false })

  if (error) { console.error('DB error:', error.message); process.exit(1) }

  console.log(`Found ${projects.length} projects with language=NULL and non-null script`)
  console.log('')

  const results = []
  for (const p of projects) {
    const lang = detectLanguage(p.script)
    const isOwnScript = p.topic === 'Свой текст'
    results.push({ id: p.id, topic: p.topic.slice(0, 30), isOwnScript, lang })
    console.log(`  ${p.id.slice(0, 8)} | topic="${p.topic.slice(0, 25)}" | own_script=${isOwnScript} | detected=${lang ?? 'UNKNOWN (manual review needed)'}`)
  }

  console.log('')
  console.log('=== SUMMARY ===')
  for (const r of results) {
    console.log(`  ${r.id} → ${r.lang ?? 'FAILED'}`)
  }

  const writable = results.filter((r) => r.lang !== null)
  const unknown = results.filter((r) => r.lang === null)

  if (unknown.length > 0) {
    console.log('')
    console.log(`UNKNOWN (heuristics inconclusive — review manually):`)
    unknown.forEach((r) => console.log(`  ${r.id} | topic="${r.topic}"`))
  }

  if (!WRITE) {
    console.log('')
    console.log(`Dry-run complete. ${writable.length} writable, ${unknown.length} unknown.`)
    console.log('Run with --write to apply writable entries.')
    return
  }

  console.log('')
  console.log(`Writing ${writable.length} entries to DB...`)
  let ok = 0, fail = 0
  for (const r of writable) {
    const { error: upErr } = await supabase.from('projects').update({ language: r.lang }).eq('id', r.id)
    if (upErr) {
      console.error(`  FAIL ${r.id}: ${upErr.message}`)
      fail++
    } else {
      console.log(`  OK ${r.id} → ${r.lang}`)
      ok++
    }
  }
  console.log(`\nDone: ${ok} updated, ${fail} failed, ${unknown.length} skipped (unknown)`)
}

Promise.resolve(main()).catch((e) => { console.error('FATAL:', e.message); process.exit(1) })
