/**
 * wipe-test-storage.mjs — DESTRUCTIVE CLEANUP of all test media.
 *
 * Without --confirm: dry-run only, prints what would be deleted.
 * With --confirm:    actually deletes.
 * With --confirm --hard-delete: also DELETEs all project/job rows instead of nulling.
 *
 * Usage:
 *   node scripts/wipe-test-storage.mjs                         # dry-run
 *   node scripts/wipe-test-storage.mjs --confirm               # wipe + soft DB clear
 *   node scripts/wipe-test-storage.mjs --confirm --hard-delete # wipe + delete all rows
 *
 * Touches:
 *   Supabase Storage: images, audio, videos buckets (all files)
 *   B2 youtubegen-videos: users/* and temp/*  (NOT youtubegen-db-backups)
 *   DB: projects.video_url/audio_url/scene_images reset (soft) or row DELETE (hard)
 *       video_jobs: all rows cleared
 *
 * B2 note: if B2_KEY_ID / B2_APPLICATION_KEY are not in .env.local
 *   the script will list what should be deleted and print instructions
 *   to run the deletion on Railway where the keys are present.
 */

import crypto from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { tmpdir } from 'os'

// ── Args ──────────────────────────────────────────────────────────────────────
const CONFIRM     = process.argv.includes('--confirm')
const HARD_DELETE = process.argv.includes('--hard-delete')

// ── Load .env.local ──────────────────────────────────────────────────────────
const __dir = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dir, '..', '.env.local')
const env = {}
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const stripped = line.replace(/^﻿/, '').trim()
    if (!stripped || stripped.startsWith('#')) continue
    const eq = stripped.indexOf('=')
    if (eq < 0) continue
    const k = stripped.slice(0, eq).trim()
    const v = stripped.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    env[k] = v
  }
} catch {
  console.warn('[env] .env.local not found — relying on process.env')
}
const E = k => env[k] || process.env[k] || ''

const SUPABASE_URL = E('NEXT_PUBLIC_SUPABASE_URL')
const SUPABASE_KEY = E('SUPABASE_SERVICE_ROLE_KEY')
const B2_ENDPOINT  = E('B2_ENDPOINT') || 'https://s3.us-east-005.backblazeb2.com'
const B2_REGION    = E('B2_REGION')   || 'us-east-005'
const B2_BUCKET    = E('B2_BUCKET')   || 'youtubegen-videos'
const B2_KEY_ID    = E('B2_KEY_ID')
const B2_APP_KEY   = E('B2_APPLICATION_KEY')
const HAS_B2       = Boolean(B2_KEY_ID && B2_APP_KEY)

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

// ── Utilities ─────────────────────────────────────────────────────────────────
const fmtBytes = n => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`
  return `${n} B`
}

const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

// SigV4 GET headers for B2 list
function b2GetHeaders(urlStr, keyId, appKey, region) {
  const parsed = new URL(urlStr)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp = amzDate.slice(0, 8)
  const credScope = `${dateStamp}/${region}/s3/aws4_request`
  const sortedParams = [...parsed.searchParams.entries()]
    .sort((a, b) => a[0] < b[0] ? -1 : 1)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const canonHeaders = `host:${parsed.host}\nx-amz-content-sha256:${EMPTY_HASH}\nx-amz-date:${amzDate}\n`
  const signedHdrs   = 'host;x-amz-content-sha256;x-amz-date'
  const canonReq = ['GET', parsed.pathname, sortedParams, canonHeaders, signedHdrs, EMPTY_HASH].join('\n')
  const sts = ['AWS4-HMAC-SHA256', amzDate, credScope,
    crypto.createHash('sha256').update(canonReq).digest('hex')].join('\n')
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const sigKey = hmac(hmac(hmac(hmac(`AWS4${appKey}`, dateStamp), region), 's3'), 'aws4_request')
  const sig = crypto.createHmac('sha256', sigKey).update(sts).digest('hex')
  return {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': EMPTY_HASH,
    'Authorization': `AWS4-HMAC-SHA256 Credential=${keyId}/${credScope}, SignedHeaders=${signedHdrs}, Signature=${sig}`,
  }
}

// SigV4 DELETE headers for B2
function b2DeleteHeaders(key, keyId, appKey, region) {
  const urlStr = `${B2_ENDPOINT}/${B2_BUCKET}/${key}`
  const parsed = new URL(urlStr)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp = amzDate.slice(0, 8)
  const credScope = `${dateStamp}/${region}/s3/aws4_request`
  const canonHeaders = `host:${parsed.hostname}\nx-amz-content-sha256:${EMPTY_HASH}\nx-amz-date:${amzDate}\n`
  const signedHdrs   = 'host;x-amz-content-sha256;x-amz-date'
  const canonReq = ['DELETE', parsed.pathname, '', canonHeaders, signedHdrs, EMPTY_HASH].join('\n')
  const sts = ['AWS4-HMAC-SHA256', amzDate, credScope,
    crypto.createHash('sha256').update(canonReq).digest('hex')].join('\n')
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const sigKey = hmac(hmac(hmac(hmac(`AWS4${appKey}`, dateStamp), region), 's3'), 'aws4_request')
  const sig = crypto.createHmac('sha256', sigKey).update(sts).digest('hex')
  return {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': EMPTY_HASH,
    'Authorization': `AWS4-HMAC-SHA256 Credential=${keyId}/${credScope}, SignedHeaders=${signedHdrs}, Signature=${sig}`,
  }
}

// Parse all <Key> values from S3 ListObjectsV2 XML
function parseXmlKeys(xml) {
  const re = /<Key>([\s\S]*?)<\/Key>/g
  const keys = []
  let m
  while ((m = re.exec(xml)) !== null) keys.push(m[1])
  return keys
}
function parseXmlSizes(xml) {
  const re = /<Size>([\s\S]*?)<\/Size>/g
  const sizes = []
  let m
  while ((m = re.exec(xml)) !== null) sizes.push(Number(m[1]))
  return sizes
}
function xmlOne(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
  return m ? m[1] : ''
}

// ── B2 list objects by prefix ─────────────────────────────────────────────────
async function b2List(prefix) {
  const items = []  // [{key, size}]
  let token = null
  do {
    const params = new URLSearchParams({ 'list-type': '2', 'max-keys': '1000', prefix })
    if (token) params.set('continuation-token', token)
    const urlStr = `${B2_ENDPOINT}/${B2_BUCKET}?${params}`
    const res = await fetch(urlStr, { headers: b2GetHeaders(urlStr, B2_KEY_ID, B2_APP_KEY, B2_REGION) })
    if (!res.ok) throw new Error(`B2 list [${prefix}] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const xml = await res.text()
    const keys  = parseXmlKeys(xml)
    const sizes = parseXmlSizes(xml)
    for (let i = 0; i < keys.length; i++) items.push({ key: keys[i], size: sizes[i] ?? 0 })
    token = xmlOne(xml, 'IsTruncated') === 'true' ? xmlOne(xml, 'NextContinuationToken') : null
  } while (token)
  return items
}

// ── Supabase Storage: BFS list all file paths in a bucket ────────────────────
async function sbListAll(bucket) {
  const sbHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  }
  const url = `${SUPABASE_URL}/storage/v1/object/list/${bucket}`
  const paths = []    // full paths for remove()
  let totalBytes = 0
  const queue = ['']
  while (queue.length) {
    const prefix = queue.shift()
    let offset = 0
    while (true) {
      const res = await fetch(url, {
        method: 'POST', headers: sbHeaders,
        body: JSON.stringify({ prefix, limit: 1000, offset }),
      })
      if (!res.ok) { console.warn(`  sb list ${bucket} at "${prefix}": ${res.status}`); break }
      const items = await res.json()
      if (!items.length) break
      for (const item of items) {
        if (!item.metadata) {
          queue.push(prefix + item.name + '/')
        } else {
          paths.push(prefix + item.name)
          totalBytes += item.metadata?.size ?? 0
        }
      }
      offset += items.length
      if (items.length < 1000) break
    }
  }
  return { paths, totalBytes }
}

// ── Supabase Storage: batch delete by path list ───────────────────────────────
async function sbDeleteAll(bucket, paths) {
  if (!paths.length) return 0
  const sbHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  }
  let deleted = 0
  const BATCH = 100
  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH)
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
      method: 'DELETE', headers: sbHeaders,
      body: JSON.stringify({ prefixes: batch }),
    })
    if (!res.ok) {
      console.warn(`  sb delete batch ${bucket} [${i}..${i + batch.length - 1}]: HTTP ${res.status}`)
    } else {
      deleted += batch.length
    }
  }
  return deleted
}

// ── B2 delete a list of keys ──────────────────────────────────────────────────
async function b2DeleteKeys(keys) {
  let deleted = 0
  // Parallel in batches of 20 to avoid hammering rate limits
  const BATCH = 20
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH)
    await Promise.all(batch.map(async key => {
      try {
        const url = `${B2_ENDPOINT}/${B2_BUCKET}/${key}`
        const res = await fetch(url, {
          method: 'DELETE',
          headers: b2DeleteHeaders(key, B2_KEY_ID, B2_APP_KEY, B2_REGION),
        })
        if (res.status === 204 || res.status === 200) {
          deleted++
        } else {
          console.warn(`  b2 delete ${key}: HTTP ${res.status}`)
        }
      } catch (e) {
        console.warn(`  b2 delete ${key}: ${e.message}`)
      }
    }))
  }
  return deleted
}

// ── Supabase DB helpers ───────────────────────────────────────────────────────
const dbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'count=exact',
}

async function dbCount(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, { method: 'HEAD', headers: dbHeaders })
  return parseInt(res.headers.get('content-range')?.split('/')[1] ?? '0', 10)
}

async function dbPatch(table, body) {
  // PostgREST rejects PATCH without a WHERE clause; use a universal filter
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'PATCH',
    headers: { ...dbHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${table}: ${res.status} ${await res.text()}`)
}

async function dbDelete(table) {
  // Supabase REST: DELETE without filters would require special header
  // Use "neq" on a column that always has a value to delete all rows
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers: { ...dbHeaders, 'Prefer': 'return=minimal' },
  })
  if (!res.ok) throw new Error(`DELETE ${table}: ${res.status} ${await res.text()}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const DRY = !CONFIRM

  console.log('══════════════════════════════════════════════════════════')
  console.log(` WIPE TEST STORAGE  [${DRY ? 'DRY-RUN — nothing deleted' : HARD_DELETE ? 'LIVE — HARD DELETE (rows)' : 'LIVE — SOFT CLEAR (null urls)'}]`)
  console.log('══════════════════════════════════════════════════════════\n')

  if (!DRY) {
    console.log('⚠  --confirm detected. This will DELETE media files and clear DB.')
    console.log('⚠  Backup bucket youtubegen-db-backups is NOT touched.\n')
  }

  // ── Scan Supabase Storage ─────────────────────────────────────────────────
  console.log('── Scanning Supabase Storage ───────────────────────────────')
  const sbBuckets = {}
  for (const bucket of ['images', 'audio', 'videos']) {
    process.stdout.write(`  ${bucket}... `)
    const result = await sbListAll(bucket)
    sbBuckets[bucket] = result
    console.log(`${result.paths.length} files, ${fmtBytes(result.totalBytes)}`)
  }

  // ── Scan B2 ───────────────────────────────────────────────────────────────
  console.log('\n── Scanning Backblaze B2 ───────────────────────────────────')
  let b2UsersItems = []
  let b2TempItems  = []
  if (HAS_B2) {
    process.stdout.write('  users/ prefix... ')
    b2UsersItems = await b2List('users/')
    console.log(`${b2UsersItems.length} objects, ${fmtBytes(b2UsersItems.reduce((s, x) => s + x.size, 0))}`)

    process.stdout.write('  temp/ prefix... ')
    b2TempItems = await b2List('temp/')
    console.log(`${b2TempItems.length} objects, ${fmtBytes(b2TempItems.reduce((s, x) => s + x.size, 0))}`)
  } else {
    console.log('  ⚠  B2_KEY_ID / B2_APPLICATION_KEY not found in .env.local')
    console.log('  ⚠  B2 scan SKIPPED. See section "B2 Manual Cleanup" below.')
  }

  // ── Scan DB ───────────────────────────────────────────────────────────────
  console.log('\n── Scanning Database ───────────────────────────────────────')
  const projectCount = await dbCount('projects')
  const jobCount     = await dbCount('video_jobs')
  console.log(`  projects:   ${projectCount} rows`)
  console.log(`  video_jobs: ${jobCount} rows`)

  // ── Print plan ────────────────────────────────────────────────────────────
  const totalSbBytes = Object.values(sbBuckets).reduce((s, b) => s + b.totalBytes, 0)
  const totalSbFiles = Object.values(sbBuckets).reduce((s, b) => s + b.paths.length, 0)
  const totalB2Bytes = [...b2UsersItems, ...b2TempItems].reduce((s, x) => s + x.size, 0)
  const totalB2Files = b2UsersItems.length + b2TempItems.length

  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' DELETION PLAN')
  console.log('══════════════════════════════════════════════════════════')
  console.log(`  Supabase images:  ${sbBuckets.images.paths.length} files  (${fmtBytes(sbBuckets.images.totalBytes)})`)
  console.log(`  Supabase audio:   ${sbBuckets.audio.paths.length} files  (${fmtBytes(sbBuckets.audio.totalBytes)})`)
  console.log(`  Supabase videos:  ${sbBuckets.videos.paths.length} files  (${fmtBytes(sbBuckets.videos.totalBytes)})`)
  console.log(`  ──────────────────────────────────────────────────────`)
  console.log(`  Supabase total:   ${totalSbFiles} files  (${fmtBytes(totalSbBytes)})`)

  if (HAS_B2) {
    console.log(`\n  B2 users/*:  ${b2UsersItems.length} files  (${fmtBytes(b2UsersItems.reduce((s, x) => s + x.size, 0))})`)
    console.log(`  B2 temp/*:   ${b2TempItems.length} files  (${fmtBytes(b2TempItems.reduce((s, x) => s + x.size, 0))})`)
    console.log(`  B2 total:    ${totalB2Files} files  (${fmtBytes(totalB2Bytes)})`)
    console.log(`  ⛔ NOT touched: youtubegen-db-backups`)
  } else {
    console.log('\n  B2 (no credentials):')
    console.log('    ⚠  Cannot delete remotely. See "B2 Manual Cleanup" instructions.')
  }

  console.log('\n  Database action:')
  if (HARD_DELETE) {
    console.log(`    ⚠  HARD DELETE: ${projectCount} projects rows + ${jobCount} video_jobs rows`)
  } else {
    console.log(`    SOFT CLEAR: ${projectCount} projects → video_url=null, audio_url=null, scene_images=[]`)
    console.log(`                ${jobCount} video_jobs → all rows deleted`)
    console.log('    (run with --hard-delete to also DELETE all project rows instead)')
  }

  if (DRY) {
    console.log('\n══════════════════════════════════════════════════════════')
    console.log(' DRY-RUN COMPLETE — nothing was deleted.')
    console.log(' To execute, re-run with --confirm:')
    console.log('   node scripts/wipe-test-storage.mjs --confirm')
    console.log('   node scripts/wipe-test-storage.mjs --confirm --hard-delete')

    if (!HAS_B2) {
      printB2ManualInstructions([...b2UsersItems, ...b2TempItems])
    }
    return
  }

  // ── EXECUTE DELETIONS ─────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' EXECUTING DELETIONS')
  console.log('══════════════════════════════════════════════════════════')

  // Supabase Storage
  for (const bucket of ['images', 'audio', 'videos']) {
    const { paths } = sbBuckets[bucket]
    if (!paths.length) { console.log(`  [sb:${bucket}] empty, skipping`); continue }
    process.stdout.write(`  [sb:${bucket}] deleting ${paths.length} files... `)
    const n = await sbDeleteAll(bucket, paths)
    console.log(`done (${n} deleted)`)
  }

  // B2
  if (HAS_B2) {
    const allB2Keys = [...b2UsersItems, ...b2TempItems].map(x => x.key)
    if (allB2Keys.length) {
      process.stdout.write(`  [b2] deleting ${allB2Keys.length} objects... `)
      const n = await b2DeleteKeys(allB2Keys)
      console.log(`done (${n} deleted)`)
    } else {
      console.log('  [b2] nothing to delete')
    }
  } else {
    console.log('\n  [b2] SKIPPED — no credentials. See B2 Manual Cleanup instructions below.')
  }

  // DB
  if (HARD_DELETE) {
    process.stdout.write('  [db] DELETE all video_jobs... ')
    await dbDelete('video_jobs')
    console.log('done')
    process.stdout.write('  [db] DELETE all projects... ')
    await dbDelete('projects')
    console.log('done')
  } else {
    process.stdout.write('  [db] PATCH projects (null urls + empty scene_images)... ')
    await dbPatch('projects', {
      video_url: null,
      audio_url: null,
      scene_images: [],
    })
    console.log('done')
    process.stdout.write('  [db] DELETE all video_jobs... ')
    await dbDelete('video_jobs')
    console.log('done')
  }

  // Final verification counts
  console.log('\n── Verification ────────────────────────────────────────────')
  for (const bucket of ['images', 'audio', 'videos']) {
    const { paths } = await sbListAll(bucket)
    console.log(`  sb:${bucket}: ${paths.length} files remaining`)
  }
  const projRemaining = await dbCount('projects')
  const jobsRemaining = await dbCount('video_jobs')
  console.log(`  projects remaining:   ${projRemaining}`)
  console.log(`  video_jobs remaining: ${jobsRemaining}`)

  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' DONE')
  if (!HAS_B2) {
    printB2ManualInstructions([...b2UsersItems, ...b2TempItems])
  }
}

function printB2ManualInstructions(items) {
  if (!items.length) {
    console.log('\n  [B2 Manual] No keys listed (scan skipped). Run on Railway to inspect.')
    return
  }
  const reportPath = path.join(tmpdir(), 'b2-wipe-keys.json')
  writeFileSync(reportPath, JSON.stringify({ bucket: B2_BUCKET, keys: items.map(x => x.key) }, null, 2))
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' B2 MANUAL CLEANUP (run this script on Railway with B2 keys)')
  console.log('══════════════════════════════════════════════════════════')
  console.log(`  Keys saved to: ${reportPath}`)
  console.log('\n  Option 1: Add B2 keys to .env.local and re-run:')
  console.log('    B2_KEY_ID=<your key id>')
  console.log('    B2_APPLICATION_KEY=<your app key>')
  console.log('    B2_BUCKET=youtubegen-videos')
  console.log('    B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com')
  console.log('\n  Option 2: On Railway, run:')
  console.log('    node scripts/wipe-test-storage.mjs --confirm')
  console.log('  (Railway has B2_KEY_ID etc. as env vars — keys will be found)')
}

main().catch(err => {
  console.error('\nFATAL:', err.message ?? err)
  process.exit(1)
})
