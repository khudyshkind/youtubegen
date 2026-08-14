// Probe: verify that Content-MD5 fixes B2 S3 DeleteObjects HTTP 400.
// Sends DeleteObjects for a dummy key that does not exist in the bucket.
// Expected after fix: HTTP 200 + XML body with <Error><Code>NoSuchKey</Code>...
// Before fix: HTTP 400 (Content-MD5 missing).
import crypto from 'crypto'

const endpoint = (process.env.B2_ENDPOINT || '').replace(/\/$/, '')
const region   = process.env.B2_REGION || 'us-east-005'
const bucket   = process.env.B2_BUCKET
const keyId    = process.env.B2_KEY_ID
const appKey   = process.env.B2_APPLICATION_KEY

if (!endpoint || !bucket || !keyId || !appKey) {
  console.error('Missing B2 env vars. Expected: B2_ENDPOINT, B2_BUCKET, B2_KEY_ID, B2_APPLICATION_KEY')
  process.exit(1)
}

const body      = '<Delete><Object><Key>test-probe-cc/b2-md5-probe.txt</Key></Object></Delete>'
const bodyHash  = crypto.createHash('sha256').update(body).digest('hex')
const bodyMd5   = crypto.createHash('md5').update(body).digest('base64')

// Replicate b2MediaSign logic exactly (queryString='delete', contentType='application/xml')
const now        = new Date()
const amzDate    = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
const dateStamp  = amzDate.slice(0, 8)
const service    = 's3'
const credScope  = `${dateStamp}/${region}/${service}/aws4_request`
const fullUrl    = `${endpoint}/${bucket}?delete`
const parsed     = new URL(fullUrl)
const canonicalQS = [...parsed.searchParams.entries()]
  .sort(([a], [b]) => a < b ? -1 : 1)
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  .join('&')
const canonHeaders = `content-type:application/xml\nhost:${parsed.hostname}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n`
const signedHdrs   = `content-type;host;x-amz-content-sha256;x-amz-date`
const canonReq = ['POST', parsed.pathname, canonicalQS, canonHeaders, signedHdrs, bodyHash].join('\n')
const sts      = ['AWS4-HMAC-SHA256', amzDate, credScope, crypto.createHash('sha256').update(canonReq).digest('hex')].join('\n')
const hmac     = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
const sigKey   = hmac(hmac(hmac(hmac(`AWS4${appKey}`, dateStamp), region), service), 'aws4_request')
const sig      = crypto.createHmac('sha256', sigKey).update(sts).digest('hex')

const authHeader = `AWS4-HMAC-SHA256 Credential=${keyId}/${credScope}, SignedHeaders=${signedHdrs}, Signature=${sig}`

console.log('POST', fullUrl)
console.log('Content-MD5:', bodyMd5)

const res = await fetch(fullUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/xml',
    'Content-Length': String(Buffer.byteLength(body)),
    'Content-MD5': bodyMd5,
    'x-amz-content-sha256': bodyHash,
    'x-amz-date': amzDate,
    'Authorization': authHeader,
  },
  body,
})

const text = await res.text()
console.log('HTTP status:', res.status)
console.log('Response body:', text.slice(0, 600))
