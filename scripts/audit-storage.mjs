/**
 * Storage audit — DRY RUN (read-only).
 *
 * Scans:
 *   - Backblaze B2: youtubegen-videos (main) + youtubegen-db-backups (backup)
 *   - Supabase Storage: images + audio + videos buckets
 *   - Supabase Database: project counts, scene_images sizes, pg_database_size
 *
 * Outputs: console summary + /tmp/storage-audit-report.json
 *
 * Run:
 *   node scripts/audit-storage.mjs
 *
 * Optional (needed for DB-size SQL and storage.objects query):
 *   SUPABASE_ACCESS_TOKEN=sbp_... in .env.local
 *   Get at: https://supabase.com/dashboard/account/tokens
 */

import crypto from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'
import path from 'path'

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
  console.log('[env] loaded .env.local\n')
} catch {
  console.warn('[env] .env.local not found — relying on process.env\n')
}

const E = k => env[k] || process.env[k] || ''

const SUPABASE_URL        = E('NEXT_PUBLIC_SUPABASE_URL')
const SUPABASE_KEY        = E('SUPABASE_SERVICE_ROLE_KEY')
const SUPABASE_TOKEN      = E('SUPABASE_ACCESS_TOKEN')   // optional, for Management API SQL
const B2_ENDPOINT         = E('B2_ENDPOINT') || 'https://s3.us-east-005.backblazeb2.com'
const B2_REGION           = E('B2_REGION')   || 'us-east-005'
const B2_BUCKET           = E('B2_BUCKET')   || 'youtubegen-videos'
const B2_KEY_ID           = E('B2_KEY_ID')
const B2_APP_KEY          = E('B2_APPLICATION_KEY')
const B2_BACKUP_BUCKET    = E('B2_BACKUP_BUCKET') || 'youtubegen-db-backups'
const B2_BACKUP_KEY_ID    = E('B2_BACKUP_KEY_ID')  || B2_KEY_ID
const B2_BACKUP_APP_KEY   = E('B2_BACKUP_APPLICATION_KEY') || B2_APP_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

// Extract Supabase project ref from URL  e.g. "https://abcdef.supabase.co" → "abcdef"
const PROJECT_REF = (SUPABASE_URL.match(/https?:\/\/([^.]+)\.supabase\.co/) || [])[1] || ''

// ── Utilities ────────────────────────────────────────────────────────────────
const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function fmtBytes(n) {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} TB`
  if (n >= 1e9)  return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6)  return `${(n / 1e6).toFixed(2)} MB`
  if (n >= 1e3)  return `${(n / 1e3).toFixed(1)} KB`
  return `${n} B`
}

function fmtGB(n) { return (n / 1e9).toFixed(4) }

// Parse repeated XML tag values
function xmlAll(xml, tag) {
  const re = new RegExp(`<${tag}>((?:.|\\n)*?)</${tag}>`, 'g')
  const out = []
  let m
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

function xmlOne(xml, tag) { return xmlAll(xml, tag)[0] ?? '' }

function daysAgo(d) { return (Date.now() - new Date(d).getTime()) / 86400000 }

// ── B2 S3-compatible SigV4 for GET requests ───────────────────────────────────
function b2GetHeaders(urlStr, keyId, appKey, region) {
  const parsed = new URL(urlStr)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp = amzDate.slice(0, 8)
  const service = 's3'
  const credScope = `${dateStamp}/${region}/${service}/aws4_request`

  // Canonical query string: sort params lexicographically
  const sortedParams = [...parsed.searchParams.entries()]
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const canonHeaders = `host:${parsed.host}\nx-amz-content-sha256:${EMPTY_HASH}\nx-amz-date:${amzDate}\n`
  const signedHdrs = 'host;x-amz-content-sha256;x-amz-date'
  const canonReq = ['GET', parsed.pathname, sortedParams, canonHeaders, signedHdrs, EMPTY_HASH].join('\n')

  const credHash = crypto.createHash('sha256').update(canonReq).digest('hex')
  const sts = ['AWS4-HMAC-SHA256', amzDate, credScope, credHash].join('\n')

  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const sigKey = hmac(hmac(hmac(hmac(`AWS4${appKey}`, dateStamp), region), service), 'aws4_request')
  const sig = crypto.createHmac('sha256', sigKey).update(sts).digest('hex')
  const auth = `AWS4-HMAC-SHA256 Credential=${keyId}/${credScope}, SignedHeaders=${signedHdrs}, Signature=${sig}`

  return { 'x-amz-date': amzDate, 'x-amz-content-sha256': EMPTY_HASH, 'Authorization': auth }
}

// ── B2 bucket full scan via S3 ListObjectsV2 ─────────────────────────────────
async function scanB2Bucket(label, bucket, keyId, appKey) {
  if (!keyId || !appKey) {
    console.log(`  [${label}] skipped — no credentials`)
    return null
  }

  const baseUrl = `${B2_ENDPOINT}/${bucket}`
  let token = null
  let totalBytes = 0n
  let totalCount = 0
  const byExt = {}   // ext → { count, bytes }
  const byPfx = {}   // prefix[0] (top-level folder) → { count, bytes }
  const top10 = []   // largest files
  const ageBuckets = { d30: 0, d90: 0, d180: 0, older: 0 }

  console.log(`  [${label}] listing ${bucket}...`)
  let pageNum = 0

  do {
    pageNum++
    const params = new URLSearchParams({ 'list-type': '2', 'max-keys': '1000' })
    if (token) params.set('continuation-token', token)
    const urlStr = `${baseUrl}?${params}`

    const headers = b2GetHeaders(urlStr, keyId, appKey, B2_REGION)
    const res = await fetch(urlStr, { headers })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`B2 list failed [${res.status}] ${bucket}: ${body.slice(0, 200)}`)
    }
    const xml = await res.text()

    // Parse object entries from XML
    // Each <Contents> block: <Key>, <Size>, <LastModified>
    const contentBlocks = xml.match(/<Contents>([\s\S]*?)<\/Contents>/g) || []
    for (const block of contentBlocks) {
      const key  = xmlOne(block, 'Key')
      const size = BigInt(xmlOne(block, 'Size') || '0')
      const lm   = xmlOne(block, 'LastModified')

      totalBytes += size
      totalCount++

      // By extension
      const ext = (key.match(/\.([a-z0-9]+)$/i) || ['', 'other'])[1].toLowerCase()
      byExt[ext] = byExt[ext] ?? { count: 0, bytes: 0n }
      byExt[ext].count++
      byExt[ext].bytes += size

      // By top-level prefix (first path segment)
      const pfx = key.includes('/') ? key.split('/')[0] : '__root__'
      byPfx[pfx] = byPfx[pfx] ?? { count: 0, bytes: 0n }
      byPfx[pfx].count++
      byPfx[pfx].bytes += size

      // Age
      const days = daysAgo(lm)
      if      (days <= 30)  ageBuckets.d30++
      else if (days <= 90)  ageBuckets.d90++
      else if (days <= 180) ageBuckets.d180++
      else                  ageBuckets.older++

      // Top-10 tracking
      top10.push({ key, bytes: size, lastModified: lm })
      top10.sort((a, b) => (b.bytes > a.bytes ? 1 : b.bytes < a.bytes ? -1 : 0))
      if (top10.length > 10) top10.pop()
    }

    const isTruncated = xmlOne(xml, 'IsTruncated') === 'true'
    token = isTruncated ? xmlOne(xml, 'NextContinuationToken') : null

    if (pageNum % 10 === 0) console.log(`    page ${pageNum}, objects so far: ${totalCount}`)
  } while (token)

  console.log(`  [${label}] done: ${totalCount} objects, ${fmtBytes(Number(totalBytes))}`)

  // Serialize BigInt for JSON
  const serializeExt = {}
  for (const [k, v] of Object.entries(byExt)) {
    serializeExt[k] = { count: v.count, bytes: Number(v.bytes) }
  }

  return {
    bucket, total_objects: totalCount, total_bytes: Number(totalBytes),
    by_extension: serializeExt,
    top10_largest: top10.map(f => ({ key: f.key, bytes: Number(f.bytes), size: fmtBytes(Number(f.bytes)), lastModified: f.lastModified })),
    age_distribution: ageBuckets,
  }
}

// ── Supabase Management API SQL ───────────────────────────────────────────────
async function mgmtSQL(sql) {
  if (!SUPABASE_TOKEN || !PROJECT_REF) return null
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn(`  [mgmtSQL] failed ${res.status}: ${body.slice(0, 150)}`)
    return null
  }
  return res.json()
}

// ── Supabase REST helpers ─────────────────────────────────────────────────────
function sbHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'count=exact',
  }
}

async function sbCount(table, filter = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=id&${filter}`
  const res = await fetch(url, { method: 'HEAD', headers: sbHeaders() })
  if (!res.ok) throw new Error(`sbCount ${table}: ${res.status}`)
  return parseInt(res.headers.get('content-range')?.split('/')[1] ?? '0', 10)
}

async function sbGet(table, qs) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${qs}`
  const res = await fetch(url, { headers: { ...sbHeaders(), 'Prefer': '' } })
  if (!res.ok) throw new Error(`sbGet ${table}: ${res.status}`)
  return res.json()
}

// Supabase storage API: list ALL objects in a bucket using BFS (handles arbitrary nesting)
async function scanSupabaseBucket(bucketName) {
  console.log(`  [sb:${bucketName}] listing (recursive)...`)
  const url = `${SUPABASE_URL}/storage/v1/object/list/${bucketName}`
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  }

  let totalBytes = 0
  let totalCount = 0
  const byExt = {}
  const top10 = []

  // BFS queue of prefix strings to explore ('' = bucket root)
  const prefixQueue = ['']

  while (prefixQueue.length > 0) {
    const prefix = prefixQueue.shift()
    let offset = 0

    while (true) {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prefix, limit: 1000, offset }),
      })
      if (!res.ok) {
        console.warn(`  [sb:${bucketName}] list failed at prefix="${prefix}": ${res.status}`)
        break
      }
      const items = await res.json()
      if (!items.length) break

      for (const item of items) {
        if (!item.metadata) {
          // It's a folder — push to queue for exploration
          const childPrefix = prefix + item.name + '/'
          prefixQueue.push(childPrefix)
        } else {
          // It's a file
          const size = item.metadata?.size ?? 0
          totalBytes += size
          totalCount++
          const key = prefix + item.name
          const ext = (item.name.match(/\.([a-z0-9]+)$/i) || ['', 'other'])[1].toLowerCase()
          byExt[ext] = byExt[ext] ?? { count: 0, bytes: 0 }
          byExt[ext].count++
          byExt[ext].bytes += size
          top10.push({ key, bytes: size })
          top10.sort((a, b) => b.bytes - a.bytes)
          if (top10.length > 10) top10.pop()
        }
      }

      offset += items.length
      if (items.length < 1000) break
    }
  }

  console.log(`  [sb:${bucketName}] done: ${totalCount} objects, ${fmtBytes(totalBytes)}`)
  return {
    bucket: bucketName, total_objects: totalCount, total_bytes: totalBytes,
    by_extension: byExt,
    top10_largest: top10.slice(0, 10).map(f => ({ key: f.key, bytes: f.bytes, size: fmtBytes(f.bytes) })),
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('══════════════════════════════════════════════════════════')
  console.log(' STORAGE AUDIT  [DRY RUN — READ ONLY]')
  console.log('══════════════════════════════════════════════════════════\n')

  const report = {
    generated_at: new Date().toISOString(),
    b2: {},
    supabase_storage: {},
    supabase_db: {},
    cost_estimate: {},
    summary: {},
  }

  // ── 1. B2 main bucket ─────────────────────────────────────────────────────
  console.log('── Backblaze B2 (main bucket) ──────────────────────────────')
  if (!B2_KEY_ID || !B2_APP_KEY) {
    console.log('  SKIPPED — B2_KEY_ID or B2_APPLICATION_KEY not set')
    report.b2.main = null
  } else {
    try {
      report.b2.main = await scanB2Bucket('b2:main', B2_BUCKET, B2_KEY_ID, B2_APP_KEY)
    } catch (e) {
      console.error('  ERROR:', e.message)
      report.b2.main = { error: e.message }
    }
  }

  // ── 2. B2 backup bucket ───────────────────────────────────────────────────
  console.log('\n── Backblaze B2 (backup bucket) ────────────────────────────')
  if (!B2_BACKUP_KEY_ID || !B2_BACKUP_APP_KEY) {
    console.log('  SKIPPED — backup B2 credentials not set')
    report.b2.backup = null
  } else {
    try {
      report.b2.backup = await scanB2Bucket('b2:backup', B2_BACKUP_BUCKET, B2_BACKUP_KEY_ID, B2_BACKUP_APP_KEY)
    } catch (e) {
      console.error('  ERROR:', e.message)
      report.b2.backup = { error: e.message }
    }
  }

  // ── 3. Supabase Storage ───────────────────────────────────────────────────
  console.log('\n── Supabase Storage ────────────────────────────────────────')

  // Try fast path via SQL if Management API token is available
  let storageFromSQL = null
  if (SUPABASE_TOKEN && PROJECT_REF) {
    console.log('  [sql] fetching storage.objects stats via Management API...')
    storageFromSQL = await mgmtSQL(`
      SELECT
        bucket_id,
        COUNT(*)                                                          AS file_count,
        COALESCE(SUM((metadata->>'size')::bigint), 0)                    AS total_bytes,
        COALESCE(AVG((metadata->>'size')::bigint), 0)::bigint            AS avg_bytes,
        COALESCE(MAX((metadata->>'size')::bigint), 0)                    AS max_bytes,
        MIN(created_at)                                                   AS oldest_file,
        MAX(created_at)                                                   AS newest_file
      FROM storage.objects
      WHERE owner IS NOT NULL
      GROUP BY bucket_id
      ORDER BY total_bytes DESC
    `)
    if (storageFromSQL) {
      console.log(`  [sql] got stats for ${storageFromSQL.length} bucket(s)`)
      for (const row of storageFromSQL) {
        console.log(`  ${row.bucket_id}: ${row.file_count} files, ${fmtBytes(Number(row.total_bytes))}`)
      }
      report.supabase_storage.from_sql = storageFromSQL
    }
  }

  // Also list per-bucket details (slower but gives per-extension breakdown)
  for (const bucket of ['images', 'audio', 'videos']) {
    try {
      report.supabase_storage[bucket] = await scanSupabaseBucket(bucket)
    } catch (e) {
      console.error(`  [sb:${bucket}] ERROR:`, e.message)
      report.supabase_storage[bucket] = { error: e.message }
    }
  }

  // ── 4. Supabase Database ──────────────────────────────────────────────────
  console.log('\n── Supabase Database ───────────────────────────────────────')

  const db = {}

  // Row counts via REST
  console.log('  counting projects...')
  db.projects_total      = await sbCount('projects')
  db.projects_with_video = await sbCount('projects', 'video_url=not.is.null')
  db.projects_no_video   = db.projects_total - db.projects_with_video

  console.log('  counting users...')
  db.unique_users = await sbCount('profiles')

  // Stale projects (no video, older than 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
  db.stale_projects_30d = await sbCount('projects', `video_url=is.null&created_at=lt.${thirtyDaysAgo}`)

  console.log(`  projects: ${db.projects_total} total | ${db.projects_with_video} with video | ${db.stale_projects_30d} stale (no video, >30d)`)
  console.log(`  unique users: ${db.unique_users}`)

  // DB size via Management API SQL
  if (SUPABASE_TOKEN && PROJECT_REF) {
    console.log('  fetching DB size via Management API...')
    const dbSize = await mgmtSQL(`SELECT pg_database_size(current_database()) AS db_bytes`)
    if (dbSize?.[0]) {
      db.database_bytes = Number(dbSize[0].db_bytes)
      console.log(`  DB size: ${fmtBytes(db.database_bytes)}`)
    }

    // scene_images JSONB column size stats
    const siSize = await mgmtSQL(`
      SELECT
        COUNT(*)                                        AS project_count,
        AVG(pg_column_size(scene_images))::bigint       AS avg_bytes,
        SUM(pg_column_size(scene_images))               AS total_bytes,
        MAX(pg_column_size(scene_images))               AS max_bytes,
        MIN(pg_column_size(scene_images))               AS min_bytes
      FROM projects
      WHERE scene_images IS NOT NULL AND jsonb_array_length(scene_images) > 0
    `)
    if (siSize?.[0]) {
      db.scene_images_col = {
        project_count: Number(siSize[0].project_count),
        avg_bytes:     Number(siSize[0].avg_bytes),
        total_bytes:   Number(siSize[0].total_bytes),
        max_bytes:     Number(siSize[0].max_bytes),
        min_bytes:     Number(siSize[0].min_bytes),
      }
      console.log(`  scene_images JSONB avg: ${fmtBytes(db.scene_images_col.avg_bytes)}/project, total: ${fmtBytes(db.scene_images_col.total_bytes)}`)
    }

    // Stale candidates by storage volume (projects with images but no video, >30 days)
    const stale = await mgmtSQL(`
      SELECT
        COUNT(*)                                                                   AS project_count,
        COALESCE(SUM(jsonb_array_length(scene_images)), 0)                         AS total_scenes
      FROM projects
      WHERE video_url IS NULL
        AND scene_images IS NOT NULL
        AND jsonb_array_length(scene_images) > 0
        AND created_at < NOW() - INTERVAL '30 days'
    `)
    if (stale?.[0]) {
      db.stale_with_images = {
        project_count: Number(stale[0].project_count),
        total_scenes:  Number(stale[0].total_scenes),
      }
      console.log(`  stale projects with images (>30d, no video): ${db.stale_with_images.project_count} projects, ${db.stale_with_images.total_scenes} scenes`)
    }

    // Data growth trend: uploads per week over last 90 days
    const growth = await mgmtSQL(`
      SELECT
        date_trunc('week', created_at)  AS week,
        COUNT(*)                         AS projects_created
      FROM projects
      WHERE created_at >= NOW() - INTERVAL '90 days'
      GROUP BY 1
      ORDER BY 1
    `)
    if (growth) {
      db.weekly_growth = growth.map(r => ({ week: r.week, projects_created: Number(r.projects_created) }))
    }
  } else {
    console.log('  SUPABASE_ACCESS_TOKEN not set — skipping DB size & SQL stats')
    console.log('  Add SUPABASE_ACCESS_TOKEN to .env.local for full report.')

    // Estimate scene_images size from a REST sample (first 100 rows)
    console.log('  sampling scene_images (100 rows)...')
    const sample = await sbGet('projects', 'select=scene_images&scene_images=not.is.null&limit=100')
    if (sample.length > 0) {
      const sizes = sample.map(r => JSON.stringify(r.scene_images || []).length)
      const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length
      db.scene_images_col = {
        note: 'estimated from 100-row sample (REST)',
        avg_bytes: Math.round(avg),
        sample_count: sample.length,
      }
      console.log(`  scene_images avg (sample): ${fmtBytes(avg)}/project`)
    }
  }

  report.supabase_db = db

  // ── 5. Cost estimates ─────────────────────────────────────────────────────
  // B2 pricing (as of 2025-07-01): https://www.backblaze.com/cloud-storage/pricing
  //   Storage:  $0.006/GB/month  ($6.00/TB/month)
  //   Egress:   $0.01/GB         (first 3×stored-amount/day free via partners)
  //   Note: egress to Cloudflare/Vercel and most CDNs is free via B2 Alliance
  //         Only direct-to-end-user downloads cost $0.01/GB
  // Supabase Pro ($25/month): 8GB DB + 100GB storage included;
  //   extra DB: $0.125/GB/month; extra storage: $0.021/GB/month

  const B2_STORAGE_PER_GB_MONTH = 0.006
  const B2_EGRESS_PER_GB        = 0.010   // direct egress only (CDN egress is free)
  const SB_STORAGE_PER_GB_MONTH = 0.021
  const SB_DB_PER_GB_MONTH      = 0.125
  const SB_INCLUDED_STORAGE_GB  = 100     // Pro plan included storage
  const SB_INCLUDED_DB_GB       = 8       // Pro plan included DB

  const b2MainGB   = (report.b2.main?.total_bytes   ?? 0) / 1e9
  const b2BackupGB = (report.b2.backup?.total_bytes ?? 0) / 1e9
  const b2TotalGB  = b2MainGB + b2BackupGB

  // Supabase storage: sum across buckets
  const sbStorageBytes = ['images', 'audio', 'videos'].reduce((sum, bkt) => {
    return sum + (report.supabase_storage[bkt]?.total_bytes ?? 0)
  }, 0)
  const sbStorageGB = sbStorageBytes / 1e9
  const sbExtraStorageGB = Math.max(0, sbStorageGB - SB_INCLUDED_STORAGE_GB)

  const dbBytes = report.supabase_db.database_bytes ?? 0
  const dbGB = dbBytes / 1e9
  const sbExtraDbGB = Math.max(0, dbGB - SB_INCLUDED_DB_GB)

  const cost = {
    pricing_date: '2025-07-01',
    pricing_source: 'https://www.backblaze.com/cloud-storage/pricing + https://supabase.com/pricing',
    b2: {
      storage_gb: +b2TotalGB.toFixed(4),
      storage_cost_month: +(b2TotalGB * B2_STORAGE_PER_GB_MONTH).toFixed(4),
      egress_note: 'Egress from B2 to Vercel/Next.js: $0 (B2-Cloudflare-Vercel alliance). Direct downloads: $0.01/GB.',
      rate_storage: '$0.006/GB/month',
    },
    supabase: {
      plan: 'Pro ($25/month base)',
      storage_gb_used: +sbStorageGB.toFixed(4),
      storage_included_gb: SB_INCLUDED_STORAGE_GB,
      storage_extra_gb: +sbExtraStorageGB.toFixed(4),
      storage_extra_cost: +(sbExtraStorageGB * SB_STORAGE_PER_GB_MONTH).toFixed(4),
      db_gb_used: dbGB > 0 ? +dbGB.toFixed(4) : 'N/A (need SUPABASE_ACCESS_TOKEN)',
      db_included_gb: SB_INCLUDED_DB_GB,
      db_extra_cost: dbGB > 0 ? +(sbExtraDbGB * SB_DB_PER_GB_MONTH).toFixed(4) : 'N/A',
    },
    total_estimate_month: null,
  }

  const b2Cost    = b2TotalGB * B2_STORAGE_PER_GB_MONTH
  const sbCost    = 25 + sbExtraStorageGB * SB_STORAGE_PER_GB_MONTH + (dbGB > 0 ? sbExtraDbGB * SB_DB_PER_GB_MONTH : 0)
  cost.total_estimate_month = +(b2Cost + sbCost).toFixed(2)

  report.cost_estimate = cost

  // ── 6. Summary ────────────────────────────────────────────────────────────
  const totalMediaBytes = (report.b2.main?.total_bytes ?? 0) +
                          (report.b2.backup?.total_bytes ?? 0) +
                          sbStorageBytes
  const avgBytesPerProject = db.projects_total > 0 ? totalMediaBytes / db.projects_total : 0
  const avgBytesPerUser    = db.unique_users   > 0 ? totalMediaBytes / db.unique_users   : 0

  report.summary = {
    total_storage_bytes: totalMediaBytes,
    total_storage_human: fmtBytes(totalMediaBytes),
    b2_total_gb:         +b2TotalGB.toFixed(4),
    supabase_storage_gb: +sbStorageGB.toFixed(4),
    projects_total:      db.projects_total,
    projects_with_video: db.projects_with_video,
    unique_users:        db.unique_users,
    avg_bytes_per_project: Math.round(avgBytesPerProject),
    avg_bytes_per_user:    Math.round(avgBytesPerUser),
    avg_per_project_human: fmtBytes(avgBytesPerProject),
    avg_per_user_human:    fmtBytes(avgBytesPerUser),
    stale_projects_30d:  db.stale_projects_30d,
    estimated_monthly_cost_usd: cost.total_estimate_month,
  }

  // ── Print summary ─────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' RESULTS')
  console.log('══════════════════════════════════════════════════════════')

  console.log('\n┌─ Storage volumes ────────────────────────────────────────')
  console.log(`│  B2 main   (${B2_BUCKET}): ${fmtBytes(report.b2.main?.total_bytes ?? 0)}  (${report.b2.main?.total_objects ?? 0} objects)`)
  if (report.b2.main) {
    const ext = report.b2.main.by_extension
    const sorted = Object.entries(ext).sort((a, b) => b[1].bytes - a[1].bytes)
    for (const [e, v] of sorted.slice(0, 5)) {
      console.log(`│    .${e}: ${v.count} files, ${fmtBytes(v.bytes)}`)
    }
    const ages = report.b2.main.age_distribution
    console.log(`│    age: <30d=${ages.d30} | 30-90d=${ages.d90} | 90-180d=${ages.d180} | >180d=${ages.older}`)
  }
  console.log(`│  B2 backup (${B2_BACKUP_BUCKET}): ${fmtBytes(report.b2.backup?.total_bytes ?? 0)}  (${report.b2.backup?.total_objects ?? 0} objects)`)
  console.log(`│  Supabase images:  ${fmtBytes(report.supabase_storage.images?.total_bytes ?? 0)}  (${report.supabase_storage.images?.total_objects ?? 0} files)`)
  console.log(`│  Supabase audio:   ${fmtBytes(report.supabase_storage.audio?.total_bytes ?? 0)}  (${report.supabase_storage.audio?.total_objects ?? 0} files)`)
  console.log(`│  Supabase videos:  ${fmtBytes(report.supabase_storage.videos?.total_bytes ?? 0)}  (${report.supabase_storage.videos?.total_objects ?? 0} files)`)
  console.log(`│  Supabase DB:      ${db.database_bytes ? fmtBytes(db.database_bytes) : 'N/A (need token)'}`)
  console.log(`│  ─────────────────────────────────────────────────────`)
  console.log(`│  TOTAL MEDIA:      ${report.summary.total_storage_human}`)

  console.log('\n┌─ Database ────────────────────────────────────────────────')
  console.log(`│  Projects total:   ${db.projects_total}`)
  console.log(`│  With video:       ${db.projects_with_video}  (${(100 * db.projects_with_video / (db.projects_total || 1)).toFixed(1)}%)`)
  console.log(`│  Stale >30d:       ${db.stale_projects_30d}  (no video)`)
  console.log(`│  Unique users:     ${db.unique_users}`)
  if (db.scene_images_col) {
    console.log(`│  scene_images avg: ${fmtBytes(db.scene_images_col.avg_bytes)}/project`)
  }

  console.log('\n┌─ Per-project / per-user averages ────────────────────────')
  console.log(`│  Avg per project:  ${report.summary.avg_per_project_human}`)
  console.log(`│  Avg per user:     ${report.summary.avg_per_user_human}`)

  if (db.weekly_growth?.length) {
    const weeks = db.weekly_growth
    const last4  = weeks.slice(-4)
    const avgWeekProjects = last4.reduce((s, w) => s + w.projects_created, 0) / last4.length
    console.log('\n┌─ Growth trend (last 90 days) ─────────────────────────────')
    for (const w of weeks) {
      console.log(`│  ${w.week.slice(0,10)}: ${w.projects_created} projects`)
    }
    console.log(`│  Avg last 4 weeks: ${avgWeekProjects.toFixed(1)} projects/week`)
    report.summary.avg_projects_per_week = +avgWeekProjects.toFixed(1)
  }

  console.log('\n┌─ Cost estimate (monthly) ─────────────────────────────────')
  console.log(`│  B2 storage (${fmtGB((report.b2.main?.total_bytes ?? 0) + (report.b2.backup?.total_bytes ?? 0))} GB × $0.006): $${cost.b2.storage_cost_month.toFixed(2)}/mo`)
  console.log(`│  B2 egress: $0 (via CDN alliance for main bucket delivery)`)
  console.log(`│  Supabase Pro base:  $25.00/mo`)
  if (sbExtraStorageGB > 0) {
    console.log(`│  Supabase extra storage (${sbExtraStorageGB.toFixed(2)} GB × $0.021): $${cost.supabase.storage_extra_cost.toFixed(2)}/mo`)
  }
  if (dbGB > 0 && sbExtraDbGB > 0) {
    console.log(`│  Supabase extra DB (${sbExtraDbGB.toFixed(2)} GB × $0.125): $${cost.supabase.db_extra_cost.toFixed(2)}/mo`)
  }
  console.log(`│  ─────────────────────────────────────────────────────`)
  console.log(`│  TOTAL ESTIMATED:  ~$${cost.total_estimate_month}/month`)
  console.log(`│  (pricing: ${cost.pricing_date}, source: ${cost.pricing_source.split(' + ')[0]})`)

  if (report.b2.main?.top10_largest?.length) {
    console.log('\n┌─ Top-10 largest B2 files ─────────────────────────────────')
    for (const f of report.b2.main.top10_largest) {
      console.log(`│  ${f.size.padEnd(10)}  ${f.key}`)
    }
  }

  // ── Save report ───────────────────────────────────────────────────────────
  const reportPath = path.join(tmpdir(), 'storage-audit-report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
  console.log(`\nReport saved → ${reportPath}`)
  console.log('══════════════════════════════════════════════════════════')
}

main().catch(err => {
  console.error('\nFATAL:', err.message ?? err)
  process.exit(1)
})
