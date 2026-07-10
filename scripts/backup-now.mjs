/**
 * Manual one-shot backup trigger. Replicates backupDatabase() from index.js.
 * Usage: railway run --service ytgen-video-server node scripts/backup-now.mjs
 */
import crypto from 'crypto'
import zlib   from 'zlib'

const SUPABASE_URL     = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY
const B2_ENDPOINT      = (process.env.B2_ENDPOINT || '').trim().replace(/\/$/, '')
const B2_REGION        = (process.env.B2_REGION   || 'us-east-005').trim()
const B2_BACKUP_BUCKET = (process.env.B2_BACKUP_BUCKET || 'youtubegen-db-backups').trim()
const B2_KEY_ID        = process.env.B2_BACKUP_KEY_ID  || process.env.B2_KEY_ID
const B2_APP_KEY       = process.env.B2_BACKUP_APPLICATION_KEY || process.env.B2_APPLICATION_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  console.error('Run with: railway run --service ytgen-video-server node scripts/backup-now.mjs')
  process.exit(1)
}
if (!B2_ENDPOINT || !B2_KEY_ID || !B2_APP_KEY) {
  console.error('ERROR: B2_ENDPOINT / B2_BACKUP_KEY_ID / B2_BACKUP_APPLICATION_KEY not set')
  process.exit(1)
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

const sbHdrs = () => ({
  apikey:        SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer:        'return=representation',
})

async function setSetting(key, value) {
  const url = `${SUPABASE_URL}/rest/v1/bot_settings?on_conflict=key`
  const res = await fetch(url, {
    method:  'POST',
    headers: { ...sbHdrs(), Prefer: 'resolution=merge-duplicates,return=representation' },
    body:    JSON.stringify({ key, value: String(value), updated_at: new Date().toISOString() }),
  })
  if (!res.ok) console.warn(`[backup-now] setSetting(${key}) HTTP ${res.status}`)
}

// ── B2 SigV4 helper ───────────────────────────────────────────────────────────

function b2Sign(method, key, queryString, contentType, bodyHash) {
  const now       = new Date()
  const amzDate   = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp = amzDate.slice(0, 8)
  const service   = 's3'
  const credScope = `${dateStamp}/${B2_REGION}/${service}/aws4_request`
  const baseUrl   = key ? `${B2_ENDPOINT}/${B2_BACKUP_BUCKET}/${key}` : `${B2_ENDPOINT}/${B2_BACKUP_BUCKET}`
  const fullUrl   = queryString ? `${baseUrl}?${queryString}` : baseUrl
  const parsed    = new URL(fullUrl)
  const canonQS   = [...parsed.searchParams.entries()]
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const ctLine    = contentType ? `content-type:${contentType}\n` : ''
  const ctSigned  = contentType ? 'content-type;' : ''
  const canonHdrs = `${ctLine}host:${parsed.hostname}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n`
  const signedHdrs = `${ctSigned}host;x-amz-content-sha256;x-amz-date`
  const canonReq  = [method, parsed.pathname, canonQS, canonHdrs, signedHdrs, bodyHash].join('\n')
  const sts       = ['AWS4-HMAC-SHA256', amzDate, credScope, crypto.createHash('sha256').update(canonReq).digest('hex')].join('\n')
  const hmac      = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const sigKey    = hmac(hmac(hmac(hmac(`AWS4${B2_APP_KEY}`, dateStamp), B2_REGION), service), 'aws4_request')
  const sig       = crypto.createHmac('sha256', sigKey).update(sts).digest('hex')
  return {
    fullUrl,
    headers: {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      'x-amz-content-sha256': bodyHash,
      'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${B2_KEY_ID}/${credScope}, SignedHeaders=${signedHdrs}, Signature=${sig}`,
    },
  }
}

async function b2Upload(buffer, key) {
  const contentType = 'application/gzip'
  const bodyHash    = crypto.createHash('sha256').update(buffer).digest('hex')
  const { fullUrl, headers } = b2Sign('PUT', key, '', contentType, bodyHash)
  const res = await fetch(fullUrl, {
    method:  'PUT',
    headers: { ...headers, 'Content-Length': String(buffer.length) },
    body:    buffer,
  })
  if (!res.ok) throw new Error(`B2 PUT ${key}: HTTP ${res.status} — ${(await res.text().catch(() => '')).slice(0, 200)}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const now = new Date()
  const ts  = now.toISOString().replace(/T/, '_').replace(/:/g, '').slice(0, 15)
  const key = `backup_${ts}.sql.gz`
  const t0  = Date.now()

  console.log('\n══════════════════════════════════════════════════')
  console.log(' backup-now.mjs — manual backup run')
  console.log('══════════════════════════════════════════════════')
  console.log(`Target key: ${B2_BACKUP_BUCKET}/${key}`)
  console.log(`SUPABASE_URL: ${SUPABASE_URL}`)
  console.log('')

  const tables = [
    'profiles', 'projects', 'credit_transactions',
    'analytics_events', 'analytics_reports',
    'bot_content_queue', 'bot_seen_urls', 'bot_settings',
    'support_tickets', 'sentry_alert_dedup',
  ]

  const hdrs = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  let sql = `-- Lefiro DB backup ${now.toISOString()}\n-- Source: scripts/backup-now.mjs (manual run)\n\n`

  for (const table of tables) {
    try {
      const PAGE   = 1000
      let allRows  = []
      let offset   = 0
      while (true) {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=${PAGE}&offset=${offset}`,
          { headers: { ...hdrs, 'Range-Unit': 'items', Range: `${offset}-${offset + PAGE - 1}` } }
        )
        if (!res.ok) { console.warn(`  ${table}: HTTP ${res.status}`); break }
        const rows = await res.json()
        if (!Array.isArray(rows) || rows.length === 0) break
        allRows = allRows.concat(rows)
        if (rows.length < PAGE) break
        offset += PAGE
      }
      if (allRows.length === 0) {
        sql += `-- Table ${table}: empty\n\n`
        console.log(`  ${table}: empty`)
        continue
      }
      sql += `-- Table: ${table} (${allRows.length} rows)\n`
      for (const row of allRows) {
        const cols = Object.keys(row)
        const vals = cols.map(c => {
          const v = row[c]
          if (v === null || v === undefined) return 'NULL'
          if (typeof v === 'number')  return String(v)
          if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
          if (typeof v === 'object')  return `'${JSON.stringify(v).replace(/'/g, "''")}'`
          return `'${String(v).replace(/'/g, "''")}'`
        })
        sql += `INSERT INTO public.${table} (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT DO NOTHING;\n`
      }
      sql += '\n'
      console.log(`  ${table}: ${allRows.length} rows`)
    } catch (e) {
      console.warn(`  ${table} error:`, e.message)
      sql += `-- Table ${table}: error — ${e.message}\n\n`
    }
  }

  const buffer = await new Promise((resolve, reject) => {
    const chunks = []
    const gz = zlib.createGzip({ level: 6 })
    gz.on('data', chunk => chunks.push(chunk))
    gz.on('end',  () => resolve(Buffer.concat(chunks)))
    gz.on('error', reject)
    gz.end(Buffer.from(sql, 'utf8'))
  })
  const sizeMb = (buffer.length / 1024 / 1024).toFixed(2)
  console.log(`\nDump ready: ${sizeMb} MB compressed`)

  process.stdout.write('Uploading to B2...')
  await b2Upload(buffer, key)
  console.log(` done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  process.stdout.write('Writing bot_settings...')
  await Promise.all([
    setSetting('last_backup_at',     now.toISOString()),
    setSetting('last_backup_status', 'success'),
    setSetting('last_backup_size_mb', sizeMb),
  ])
  console.log(' done')

  console.log('\n══════════════════════════════════════════════════')
  console.log('RESULT: backup complete')
  console.log(`  key:    ${key}`)
  console.log(`  size:   ${sizeMb} MB`)
  console.log(`  status: success`)
  console.log(`  at:     ${now.toISOString()}`)
  console.log('══════════════════════════════════════════════════\n')
}

main().catch(err => {
  console.error('\n[backup-now] FAILED:', err.message)
  process.exit(1)
})
