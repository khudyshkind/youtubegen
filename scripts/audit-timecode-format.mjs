/**
 * DRY-RUN audit of scene_images timecode format.
 *
 * Background (see commit da00ee3):
 *   The old fmtSec produced "MM:SS" format (e.g. "00:05") truncating centiseconds.
 *   A later buggy version produced "SS:cc" format (e.g. "07:98" for 7.98 s),
 *   placing whole-seconds in the MM position and centiseconds in the SS position.
 *   The current correct format is "MM:SS.cc" (e.g. "00:07.98").
 *
 * Distinguishing the three cases (all lack a dot in the broken/old formats):
 *
 *   1. NEW  "MM:SS.cc"  — has ':' AND '.'             e.g. "00:07.98"  → parseSecs = 7.98 s ✓
 *   2. OLD  "MM:SS"     — has ':', no '.', SS < 60    e.g. "00:05"     → parseSecs = 5 s ✓ (precision loss only)
 *   3. BROKEN "SS:cc"   — has ':', no '.', SS ≥ 60    e.g. "07:98"     → parseSecs = 518 s ✗ (catastrophic!)
 *
 * The video-server's parseSecs() correctly handles cases 1 and 2.
 * Only case 3 causes real video rendering corruption (wrong scene durations).
 *
 * Run:   node scripts/audit-timecode-format.mjs
 * NO writes to DB — read-only.
 */

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'
import path from 'path'

// ── Load .env.local (same pattern as scripts/migrate.mjs) ───────────────────
const __dir = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dir, '..', '.env.local')
const env = {}
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const stripped = line.replace(/^﻿/, '').trim()
    if (!stripped || stripped.startsWith('#')) continue
    const eq = stripped.indexOf('=')
    if (eq === -1) continue
    const k = stripped.slice(0, eq).trim()
    const v = stripped.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    env[k] = v
  }
  console.log('[env] loaded .env.local')
} catch {
  console.warn('[env] .env.local not found — relying on process.env')
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

// ── fmtSec — mirrors src/app/api/generate/images/route.ts:206-210 ───────────
// This function must stay byte-for-byte identical to the route's fmtSec.
// If the route is updated, update this copy too (or extract to a shared lib).
function fmtSec(s) {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(2)
  return `${String(m).padStart(2, '0')}:${sec.padStart(5, '0')}`
}

// ── Video-server parseSecs — mirrors video-server/index.js:2293-2298 ─────────
// Used for round-trip validation only (not for migration).
function parseSecs(tc) {
  const parts = String(tc || '0').split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0]
}

// ── Format classifiers ────────────────────────────────────────────────────────

function classifyTimecode(tc) {
  if (tc === null || tc === undefined || tc === '') return 'empty'

  const s = String(tc)
  const hasColon = s.includes(':')
  const hasDot   = s.includes('.')

  if (hasColon && hasDot)  return 'new'     // "00:07.98" — correct current format

  if (hasColon && !hasDot) {
    // Distinguish "MM:SS" (old-functional) from "SS:cc" (broken).
    // In "SS:cc" the "SS" part holds centiseconds (0-99 mapped from seconds fraction)
    // and the "MM" part holds whole seconds. Since centiseconds are 0-99, the
    // value after the colon would be 0-99. But in MM:SS, the value after the colon
    // is seconds (0-59). Values ≥ 60 after the colon can ONLY come from the broken
    // SS:cc format (centiseconds 60-99 encoded as if seconds > 59).
    const colonIdx = s.indexOf(':')
    const afterColon = Number(s.slice(colonIdx + 1))
    if (!isNaN(afterColon) && afterColon >= 60) return 'broken'  // e.g. "07:98" SS=98≥60
    return 'old'                                                   // e.g. "00:05" SS=5<60
  }

  return 'unexpected'  // no colon, or other unrecognised pattern
}

// Convert BROKEN "SS:cc" → realSeconds → new "MM:SS.cc" via fmtSec
// Only call this for broken-classified timecodes.
function convertBrokenToNew(tc) {
  const colonIdx  = tc.indexOf(':')
  const secPart   = tc.slice(0, colonIdx)   // whole seconds (in MM position)
  const centsPart = tc.slice(colonIdx + 1)  // centiseconds (in SS position)
  const cents     = Number(centsPart)
  const realSeconds = Number(secPart) + cents / 100
  return { secPart, centsPart, cents, realSeconds, newValue: fmtSec(realSeconds) }
}

// Convert OLD "MM:SS" → new "MM:SS.cc" by appending ".00"
// This is a precision upgrade only — semantics are unchanged.
function convertOldToNew(tc) {
  return { newValue: tc + '.00', realSeconds: parseSecs(tc) }
}

// Validate a broken-format conversion result
function validateBrokenConversion({ secPart, centsPart, cents, realSeconds, newValue }) {
  if (!isFinite(realSeconds) || realSeconds < 0) {
    return { ok: false, reason: `realSeconds=${realSeconds} (negative or NaN)` }
  }
  if (cents >= 100) {
    // Shouldn't happen given SS≥60 already caught in classifier, but be defensive
    return { ok: false, reason: `centsPart="${centsPart}" ≥ 100 (unexpected)` }
  }
  if (Number(secPart) < 0) {
    return { ok: false, reason: `secPart="${secPart}" is negative` }
  }
  if (!newValue.includes(':') || !newValue.includes('.')) {
    return { ok: false, reason: `converted value "${newValue}" is not new format` }
  }
  // Round-trip: re-parse the new value and check it matches
  const reparsed = parseSecs(newValue)
  if (Math.abs(reparsed - realSeconds) > 0.005) {
    return { ok: false, reason: `round-trip mismatch: reparsed=${reparsed.toFixed(4)} vs original=${realSeconds.toFixed(4)}` }
  }
  return { ok: true }
}

// ── Supabase REST helpers ─────────────────────────────────────────────────────
function sbHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function fetchAllProjects() {
  const rows = []
  let offset = 0
  const limit = 1000

  while (true) {
    const qs = new URLSearchParams({
      select: 'id,topic,scene_images',
      scene_images: 'not.is.null',
      order: 'id',
      offset: String(offset),
      limit: String(limit),
    })
    const url = `${SUPABASE_URL}/rest/v1/projects?${qs}`
    const res = await fetch(url, { headers: sbHeaders() })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Supabase fetch failed [${res.status}]: ${body}`)
    }
    const page = await res.json()
    rows.push(...page)
    if (page.length < limit) break
    offset += limit
  }

  return rows
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' AUDIT: scene_images timecode format  [DRY RUN — READ ONLY]')
  console.log('══════════════════════════════════════════════════════════\n')

  console.log('Fetching projects from Supabase...')
  const allRows = await fetchAllProjects()
  console.log(`Rows returned (scene_images not null): ${allRows.length}`)

  const projects = allRows.filter(p => Array.isArray(p.scene_images) && p.scene_images.length > 0)
  console.log(`Projects with non-empty scene_images:  ${projects.length}\n`)

  // ── Per-project analysis ──────────────────────────────────────────────────
  // broken = "SS:cc" format where SS≥60 — causes catastrophic video bug
  // old    = "MM:SS" format without decimal — functional but imprecise
  // new    = "MM:SS.cc" — correct current format
  const projectsWithBroken    = []
  const projectsWithOld       = []
  const projectsManualReview  = []
  const brokenExamples        = []   // up to 5 broken conversions for report
  const brokenErrors          = []   // anomalies in broken conversions
  const oldExamples           = []   // up to 5 old-format examples for report

  let totalScenesChecked      = 0
  let totalFieldsChecked      = 0
  let totalBrokenFields       = 0
  let totalOldFields          = 0
  let totalNewFields           = 0

  for (const project of projects) {
    const scenes = project.scene_images
    totalScenesChecked += scenes.length

    let projectBrokenCount    = 0
    let projectOldCount       = 0
    let projectConvErrorCount = 0
    const manualItems         = []

    for (const scene of scenes) {
      const fields = [
        { field: 'timecode_start', value: scene.timecode_start },
        { field: 'timecode_end',   value: scene.timecode_end   },
      ]

      for (const { field, value } of fields) {
        const kind = classifyTimecode(value)
        if (kind === 'empty') continue
        totalFieldsChecked++

        if (kind === 'new') {
          totalNewFields++

        } else if (kind === 'broken') {
          totalBrokenFields++
          projectBrokenCount++

          const conv = convertBrokenToNew(String(value))
          const validation = validateBrokenConversion(conv)

          const entry = {
            project_id:   project.id,
            project_name: project.topic || '(no topic)',
            scene_index:  scene.scene_index,
            field,
            old_value:    value,
            realSeconds:  conv.realSeconds,
            new_value:    conv.newValue,
            kind:         'broken',
          }

          if (!validation.ok) {
            brokenErrors.push({ ...entry, error: validation.reason })
            projectConvErrorCount++
          } else if (brokenExamples.length < 5) {
            brokenExamples.push(entry)
          }

        } else if (kind === 'old') {
          totalOldFields++
          projectOldCount++

          const conv = convertOldToNew(String(value))
          if (oldExamples.length < 5) {
            oldExamples.push({
              project_id:   project.id,
              project_name: project.topic || '(no topic)',
              scene_index:  scene.scene_index,
              field,
              old_value:    value,
              realSeconds:  conv.realSeconds,
              new_value:    conv.newValue,
              parseSecs_result: parseSecs(value),
              kind: 'old',
            })
          }

        } else {
          // 'unexpected'
          manualItems.push({ scene_index: scene.scene_index, field, raw_value: value })
        }
      }
    }

    if (projectBrokenCount > 0) {
      projectsWithBroken.push({
        project_id:              project.id,
        project_name:            project.topic || '(no topic)',
        broken_fields:           projectBrokenCount,
        conversion_error_fields: projectConvErrorCount,
        total_scenes:            scenes.length,
        ready_to_migrate:        projectConvErrorCount === 0,
      })
    }

    if (projectOldCount > 0 && projectBrokenCount === 0) {
      // Only add to old-format list if it has no broken fields
      projectsWithOld.push({
        project_id:     project.id,
        project_name:   project.topic || '(no topic)',
        old_fields:     projectOldCount,
        total_scenes:   scenes.length,
        note:           'MM:SS format (functional — parseSecs reads correctly, precision loss only)',
      })
    } else if (projectOldCount > 0 && projectBrokenCount > 0) {
      // Mixed: has both broken and old fields
      const existing = projectsWithBroken.find(p => p.project_id === project.id)
      if (existing) existing.old_format_fields_also = projectOldCount
    }

    if (manualItems.length > 0) {
      projectsManualReview.push({
        project_id:   project.id,
        project_name: project.topic || '(no topic)',
        items:        manualItems,
      })
    }
  }

  // ── Print report ─────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════')
  console.log(' SUMMARY')
  console.log('══════════════════════════════════════════')
  console.log(`Projects checked (non-empty images):          ${projects.length}`)
  console.log(`  → BROKEN format "SS:cc" (video bug!):       ${projectsWithBroken.length}`)
  console.log(`  → OLD format "MM:SS" (functional, imprecise): ${projectsWithOld.length}`)
  console.log(`  → needs manual review (unexpected format):  ${projectsManualReview.length}`)
  console.log(`  → clean (new format "MM:SS.cc" only):       ${projects.length - projectsWithBroken.length - projectsWithOld.length - projectsManualReview.length}`)
  console.log()
  console.log(`Timecode fields checked (non-null):           ${totalFieldsChecked}`)
  console.log(`  → BROKEN "SS:cc"  SS≥60 (video bug):        ${totalBrokenFields}`)
  console.log(`  → OLD    "MM:SS"  SS<60 (functional):       ${totalOldFields}`)
  console.log(`  → NEW    "MM:SS.cc"    (correct):           ${totalNewFields}`)
  console.log(`  → conversion errors in BROKEN:              ${brokenErrors.length}`)
  console.log()

  if (projectsWithBroken.length > 0) {
    console.log('══ CRITICAL: Projects with BROKEN "SS:cc" timecodes ════════')
    console.log('   These cause catastrophic video rendering: only scene 1 visible.')
    for (const p of projectsWithBroken) {
      const errTag = p.conversion_error_fields > 0 ? `  ⚠ ${p.conversion_error_fields} conversion error(s)` : ''
      console.log(`  ${p.project_id}`)
      console.log(`    name:   "${p.project_name}"`)
      console.log(`    broken: ${p.broken_fields} field(s) / ${p.total_scenes} scenes${errTag}`)
    }
    console.log()
  } else {
    console.log('══ CRITICAL: Projects with BROKEN "SS:cc" timecodes ════════')
    console.log('   ✓ NONE FOUND — no "07:98"-style broken values in this DB.')
    console.log()
  }

  if (projectsWithOld.length > 0) {
    console.log('── Projects with OLD "MM:SS" timecodes (functional, imprecise) ──')
    console.log('   parseSecs reads these CORRECTLY. Video rendering is fine.')
    console.log('   Migration optional: only adds ".00" centiseconds for uniformity.')
    for (const p of projectsWithOld) {
      console.log(`  ${p.project_id}  "${p.project_name}"  ${p.old_fields} field(s) / ${p.total_scenes} scenes`)
    }
    console.log()
  }

  if (brokenExamples.length > 0) {
    console.log('── BROKEN format conversion examples (up to 5) ────────────')
    console.log('   Formula: secPart + centsPart/100 = realSeconds → fmtSec(realSeconds)')
    for (const ex of brokenExamples) {
      console.log(`  project: ${ex.project_id}  scene: ${ex.scene_index}  field: ${ex.field}`)
      console.log(`    old:  "${ex.old_value}"  →  realSeconds: ${ex.realSeconds}  →  new: "${ex.new_value}"`)
      console.log(`    parseSecs(old): ${parseSecs(ex.old_value)} s (WRONG)  parseSecs(new): ${parseSecs(ex.new_value)} s (correct)`)
    }
    console.log()
  }

  if (oldExamples.length > 0) {
    console.log('── OLD "MM:SS" format examples (up to 5) ───────────────────')
    console.log('   parseSecs is already correct — these need NO urgent fix.')
    for (const ex of oldExamples) {
      console.log(`  project: ${ex.project_id}  scene: ${ex.scene_index}  field: ${ex.field}`)
      console.log(`    old:  "${ex.old_value}"  parseSecs: ${ex.parseSecs_result} s ✓  potential new: "${ex.new_value}"`)
    }
    console.log()
  }

  if (brokenErrors.length > 0) {
    console.log('⚠ BROKEN CONVERSION ERRORS (excluded from migration) ────────')
    for (const e of brokenErrors) {
      console.log(`  project: ${e.project_id}  scene: ${e.scene_index}  field: ${e.field}  value: "${e.old_value}"  error: ${e.error}`)
    }
    console.log()
  }

  if (projectsManualReview.length > 0) {
    console.log('── Unexpected format — manual review ───────────────────────')
    for (const p of projectsManualReview) {
      console.log(`  ${p.project_id}  "${p.project_name}"`)
      for (const item of p.items) {
        console.log(`    scene: ${item.scene_index}  field: ${item.field}  raw: "${item.raw_value}"`)
      }
    }
    console.log()
  }

  // ── Build JSON report ─────────────────────────────────────────────────────
  const report = {
    generated_at: new Date().toISOString(),
    format_guide: {
      new:      'MM:SS.cc — e.g. "00:07.98" — correct current format',
      old:      'MM:SS    — e.g. "00:05"    — old truncated format, functional (parseSecs correct)',
      broken:   'SS:cc    — e.g. "07:98"    — broken format, parseSecs gives wrong result (×60+ error)',
    },
    totals: {
      projects_checked:           projects.length,
      projects_with_broken:       projectsWithBroken.length,
      projects_with_old_only:     projectsWithOld.length,
      projects_needing_review:    projectsManualReview.length,
      projects_clean_new_format:  projects.length - projectsWithBroken.length - projectsWithOld.length - projectsManualReview.length,
      timecode_fields_checked:    totalFieldsChecked,
      broken_fields:              totalBrokenFields,
      old_fields:                 totalOldFields,
      new_fields:                 totalNewFields,
      broken_conversion_errors:   brokenErrors.length,
    },
    projects_with_broken_format:   projectsWithBroken,
    broken_conversion_examples:    brokenExamples,
    broken_conversion_errors:      brokenErrors,
    projects_with_old_format:      projectsWithOld,
    old_format_examples:           oldExamples,
    projects_needing_manual_review: projectsManualReview,
  }

  const reportPath = path.join(tmpdir(), 'timecode-migration-report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
  console.log(`Report saved → ${reportPath}`)

  // ── Final line ────────────────────────────────────────────────────────────
  const brokenReadyCount  = projectsWithBroken.filter(p => p.ready_to_migrate).length
  const brokenReadyFields = totalBrokenFields - brokenErrors.length
  const oldCount          = projectsWithOld.length

  console.log()
  console.log('══════════════════════════════════════════════════════════')
  if (totalBrokenFields === 0) {
    console.log(`DRY RUN — изменений в БД не внесено.`)
    console.log(`BROKEN (критичных) значений: 0. Активная миграция НЕ требуется.`)
    console.log(`OLD (MM:SS без сотых): ${totalOldFields} поле(й) в ${oldCount} проект(ах) — функциональны, миграция опциональна.`)
  } else {
    console.log(`DRY RUN — изменений в БД не внесено. ${brokenReadyCount} проект(ов) / ${brokenReadyFields} поле(й) готовы к миграции при подтверждении.`)
  }
  console.log('══════════════════════════════════════════════════════════')
}

main().catch(err => {
  console.error('\nFATAL:', err.message ?? err)
  process.exit(1)
})
