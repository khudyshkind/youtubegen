/**
 * fal-ai/nano-banana-2/edit billing probe
 * Usage: FAL_KEY=xxx node scripts/fal-nb2-edit-probe.mjs
 * Keys never printed.
 */
import { fal } from '@fal-ai/client'

const FAL_KEY = process.env.FAL_KEY
if (!FAL_KEY) throw new Error('FAL_KEY not set')

fal.config({ credentials: FAL_KEY })

const MODEL = 'fal-ai/nano-banana-2/edit'

function ts() { return new Date().toISOString() }

// ── Upload a test reference image to fal storage ──────────────────────────────
// We build a minimal JPEG in-memory and upload it so fal can access it.

async function uploadTestImage() {
  // Create a 64×36 JPEG as a Buffer via canvas, or just use a minimal JPEG blob
  // Fallback: use a known publicly accessible image URL
  // Try picsum.photos which is a reliable public CDN
  const testUrls = [
    'https://picsum.photos/320/180.jpg',
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=320&h=180&fit=crop',
  ]

  // Attempt to upload via fal storage using fetch + blob
  for (const url of testUrls) {
    try {
      console.log(`  fetching test image from: ${url}`)
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!r.ok) { console.log(`  failed HTTP=${r.status}`); continue }
      const buf = Buffer.from(await r.arrayBuffer())
      console.log(`  downloaded ${buf.length} bytes`)
      const blob = new Blob([buf], { type: 'image/jpeg' })
      const falUrl = await fal.storage.upload(blob)
      console.log(`  uploaded to fal storage: [URL hidden length=${falUrl.length}]`)
      return falUrl
    } catch (e) {
      console.log(`  upload attempt failed: ${e.message}`)
    }
  }
  throw new Error('could not upload test reference image')
}

// ── Schema probe via HTTP ─────────────────────────────────────────────────────

async function getSchema() {
  const headers = {
    'Authorization': `Key ${FAL_KEY}`,
    'Accept': 'application/json',
  }
  // Try several known schema endpoint patterns
  const attempts = [
    `https://rest.alpha.fal.ai/v1/models/${MODEL}/schema`,
    `https://fal.run/${MODEL}/openapi.json`,
    `https://queue.fal.run/${MODEL}/schema`,
  ]
  for (const url of attempts) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) })
      console.log(`schema ${url.split('/').pop()}: HTTP=${r.status}`)
      if (r.ok) {
        const body = await r.json()
        // Look for num_images in various schema paths
        const inputProps = body?.input?.properties
          ?? body?.input_schema?.properties
          ?? body?.properties
          ?? {}
        const ni = inputProps.num_images
        if (ni) {
          console.log('num_images schema:', JSON.stringify(ni, null, 2))
        } else {
          console.log('num_images not found in schema at these paths')
          console.log('top-level keys:', Object.keys(body).join(', '))
        }
        return body
      }
    } catch (e) {
      console.log(`schema attempt failed: ${e.message}`)
    }
  }
  return null
}

// ── Generate using fal SDK (mirrors production code) ─────────────────────────

const PROMPT = 'a futuristic cityscape at sunset with glowing neon lights, cinematic, photorealistic, NO TEXT, NO WATERMARKS'

async function generate(numImages, label, refUrl) {
  console.log(`\n=== GENERATE ${label}: num_images=${numImages} [${ts()}] ===`)

  const input = {
    prompt: PROMPT,
    image_urls: [refUrl],
    aspect_ratio: '16:9',
    resolution: '1K',
    num_images: numImages,
    output_format: 'jpeg',
  }
  console.log(`input params: aspect_ratio=16:9 resolution=1K num_images=${numImages} output_format=jpeg`)

  const result = await (fal.subscribe)(MODEL, {
    input,
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === 'IN_PROGRESS') {
        const elapsed = Date.now() - t0
        console.log(`  [${Math.round(elapsed/1000)}s] IN_PROGRESS`)
      }
    },
  })

  const images = result?.data?.images ?? result?.images ?? []
  console.log(`result: images_returned=${images.length}`)
  console.log('image URLs:')
  for (const img of images) console.log(' ', img.url ?? img)

  // Check for billing metadata
  const billingKeys = ['billing', 'usage', 'credits', 'cost', 'price', 'credits_used', 'timings']
  const meta = {}
  const src = result?.data ?? result ?? {}
  for (const k of billingKeys) {
    if (src[k] !== undefined) meta[k] = src[k]
  }
  console.log('billing metadata:', Object.keys(meta).length ? JSON.stringify(meta) : 'none')

  const t1 = Date.now()
  console.log(`=== DONE ${label} [${ts()}] duration=${Math.round((t1 - t0)/1000)}s ===`)
  return { images, result, requestId: null }
}

const t0 = Date.now()

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n=== PRE-FLIGHT ===')
console.log(`timestamp: ${ts()}`)
console.log('FAL_KEY: set (not printed)')

console.log('\n=== STEP 1: schema ===')
await getSchema()

console.log('\n=== STEP 2: upload reference image ===')
const refUrl = await uploadTestImage()

console.log('\n=== STEP 3: generate num_images=1 ===')
console.log(`timestamp before A: ${ts()}`)
const res1 = await generate(1, 'A (num_images=1)', refUrl)

console.log(`\ntimestamp after A: ${ts()}`)

console.log('\n=== STEP 4: generate num_images=4 ===')
console.log(`timestamp before B: ${ts()}`)
const res4 = await generate(4, 'B (num_images=4)', refUrl)

console.log(`\ntimestamp after B: ${ts()}`)

console.log('\n=== SUMMARY ===')
console.log(`A (num_images=1): ${res1.images.length} image(s) returned`)
for (const img of res1.images) console.log('  A:', img.url ?? img)
console.log(`B (num_images=4): ${res4.images.length} image(s) returned`)
for (const img of res4.images) console.log('  B:', img.url ?? img)

if (res4.images.length > 1) {
  const urls = res4.images.map(i => i.url ?? String(i))
  const unique = new Set(urls)
  console.log(`B images all different: ${unique.size === urls.length ? 'YES' : 'NO, only ' + unique.size + ' unique'}`)
}

console.log('\nBILLING: check fal.ai/dashboard/billing for spend delta between timestamps above.')
console.log('Cannot read fal billing programmatically — all /v1/me /v1/billing /v1/balance return 404.')
