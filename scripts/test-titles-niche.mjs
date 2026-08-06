// Test script — run via: railway run node scripts/test-titles-niche.mjs
const ytKey = process.env.YOUTUBE_API_KEY
const aiKey = process.env.ANTHROPIC_API_KEY
const niche  = 'дикие животные'
const YT     = 'https://www.googleapis.com/youtube/v3'

if (!ytKey || !aiKey) { console.error('ERR: YOUTUBE_API_KEY or ANTHROPIC_API_KEY not set'); process.exit(1) }

// 1. YT search
const sr = await fetch(`${YT}/search?part=snippet&q=${encodeURIComponent(niche)}&type=video&maxResults=50&order=viewCount&regionCode=RU&key=${ytKey}`, { signal: AbortSignal.timeout(20000) })
if (!sr.ok) { console.error('YT search:', sr.status, (await sr.text()).slice(0,200)); process.exit(1) }
const items = (await sr.json()).items ?? []
const videoIds = items.map(i => i.id.videoId).filter(Boolean)
console.log('[1] YT search OK — found', videoIds.length, 'videos')

// 2. Stats
const vr = await fetch(`${YT}/videos?part=statistics&id=${videoIds.join(',')}&key=${ytKey}`, { signal: AbortSignal.timeout(15000) })
const sm = new Map()
if (vr.ok) { for (const x of ((await vr.json()).items ?? [])) sm.set(x.id, parseInt(x.statistics?.viewCount ?? '0', 10)) }

const videos = items.map(i => ({ id: i.id.videoId ?? '', title: i.snippet.title, views: sm.get(i.id.videoId ?? '') ?? 0 })).filter(v => v.id).sort((a,b) => b.views - a.views)
console.log('[2] Top-3:', videos.slice(0,3).map(v => `"${v.title.slice(0,40)}" (${(v.views/1000).toFixed(0)}K)`).join('\n       '))

// 3. Claude
const list = videos.slice(0,50).map((v,i) => `${i+1}. [${v.id}] "${v.title}" (${(v.views/1000).toFixed(0)}K)`).join('\n')
const prompt = `Ты — YouTube-стратег. Ниша: "${niche}". Анализируй топ-50 видео и ответь строго JSON:
{"patterns":["паттерн 1","паттерн 2","паттерн 3"],"titles":[{"title":"Название 1","sources":["id1"]},{"title":"Название 2","sources":["id2"]},{"title":"Название 3","sources":["id3"]}],"hooks":[{"hook":"Хук 1","sources":["id4"]},{"hook":"Хук 2","sources":["id5"]}]}

ТОП-50:
${list}

ВАЖНО: верни ТОЛЬКО JSON, без markdown.`

console.log('[3] Calling Claude claude-sonnet-5...')
const cr = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': aiKey, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
  signal: AbortSignal.timeout(60000),
})
const cd = await cr.json()
if (!cr.ok) { console.error('Claude error:', JSON.stringify(cd).slice(0,400)); process.exit(1) }

const block = cd.content?.[0]
console.log('[3] block.type =', block?.type)
if (block?.type !== 'text') { console.error('ERROR: non-text block!', JSON.stringify(cd.content)); process.exit(1) }

// Parse JSON
const raw = block.text
console.log('[4] raw (first 300):', raw.slice(0,300))
const cl = raw.replace(/```json\s*/gi,'').replace(/```\s*/gi,'').trim()
const s  = cl.indexOf('{'), e = cl.lastIndexOf('}')
if (s === -1 || e === -1) { console.error('No JSON found'); process.exit(1) }
let parsed
try { parsed = JSON.parse(cl.slice(s, e+1)) } catch(err) { console.error('JSON parse fail:', err.message, '\nslice:', cl.slice(s, e+1).slice(0,200)); process.exit(1) }

console.log('\n✅ SUCCESS — ниша "дикие животные"\n')
console.log('=== 3 НАЗВАНИЯ ===')
for (const t of (parsed.titles ?? []).slice(0,3)) console.log(' •', t.title)
console.log('\n=== ХУКИ ===')
for (const h of (parsed.hooks ?? []).slice(0,2)) console.log(' •', h.hook.slice(0,120))
console.log('\n=== ПАТТЕРНЫ ===')
for (const p of (parsed.patterns ?? []).slice(0,3)) console.log(' •', p)
