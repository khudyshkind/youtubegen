/**
 * Test script for character consistency and prompt quality.
 * Run: node scripts/test-prompts.mjs
 * Reads ANTHROPIC_API_KEY from .env.local
 */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import Anthropic from '@anthropic-ai/sdk'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Load .env.test (pulled from Vercel) or .env.local as fallback
for (const envFile of ['.env.test', '.env.local']) {
  try {
    const env = readFileSync(resolve(root, envFile), 'utf8')
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    break
  } catch { /* file not found */ }
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ═══════════════════════════════════════════════
// Same system prompt and extractCharacters as route
// ═══════════════════════════════════════════════

const SCENES_SYSTEM_PROMPT = `You are a film director and art director for YouTube videos with extensive experience creating visual sequences for educational and entertainment content.

Your task: for each video scene, write a brief description of what is happening and a specific English prompt for generating an illustration via AI.

═══ SCENE DESCRIPTION REQUIREMENTS (field "scene") ═══
• Brief description (1-2 sentences) of what is happening at this moment in the video
• Describe the action, object, or concept that illustrates the scene
• Avoid abstractions — be specific and concrete
• Write the scene description in the same language as the video content

═══ PROMPT REQUIREMENTS (field "prompt") ═══
• Only concrete visual imagery: objects, people, places, actions, atmosphere
• No abstractions: do not write "concept", "idea", "symbol", "metaphor"
• No text, inscriptions, logos, or watermarks
• Prompt must fully match the specified style (passed separately in the user message)
• Use concrete nouns: "aged leather-bound book on wooden desk" not "knowledge"
• LIGHTING — be specific: "soft diffused overcast light", "dramatic rim lighting from behind", "warm amber lamplight from lower-left", "cold blue moonlight with hard shadows" — never just "good lighting"
• COMPOSITION — specify the shot type: "extreme close-up filling the frame", "wide establishing shot", "low-angle looking up at subject", "bird's-eye overhead view", "Dutch tilt medium shot"
• MOOD — convey the emotional tone of the scene: "tense and claustrophobic", "serene and meditative", "chaotic and energetic", "eerie and mysterious"
• Prompts must be in English — AI image generators perform better with English prompts
• Target 40–60 words per prompt — enough detail for precise generation

═══ FEW-SHOT QUALITY EXAMPLES ═══

Scene — octopus hunting in the dark:
❌ Weak:   "An octopus in the ocean catching prey"
✓ Strong: "A reddish-brown octopus with textured mottled skin and large glowing amber eyes stretching a tentacle toward a fleeing silver fish, extreme close-up from below, dramatic deep-sea bioluminescent blue-green lighting with darkness at edges, tense and predatory atmosphere"

Scene — person researching in a library:
❌ Weak:   "A person reading old books"
✓ Strong: "Weathered hands turning pages of an aged leather-bound open book on a worn oak desk covered in scattered papers, warm incandescent amber lamplight casting soft left-side shadows, shallow depth of field with book spines blurred in background, contemplative and scholarly atmosphere"

Scene — vast ocean abyss:
❌ Weak:   "The deep ocean"
✓ Strong: "Vast dark ocean abyss stretching downward into blackness, wide establishing shot from above looking straight down, isolated beam of cold blue light piercing the darkness with tiny silhouettes of fish at different depths, awe-inspiring and vertiginous atmosphere"

═══ CHARACTER CONSISTENCY RULES ═══
If CHARACTER PROFILES are provided in the user message:
• Determine which characters are PHYSICALLY PRESENT (visible, actively participating) in each scene — not just mentioned in narration
• Copy character profile descriptions VERBATIM into the prompt for every scene they appear in
• Never paraphrase or vary the character description — exact repetition ensures visual consistency
• If two characters are both present in one scene — include BOTH descriptions in that prompt
• If a scene contains no characters from the profiles — write the prompt normally without any character description

═══ STYLE CONSISTENCY RULES ═══
• Every prompt MUST follow the style instruction provided in the user message
• Apply the style consistently across all scenes — do not switch between styles

═══ QUALITY AND VARIETY ═══
• Each scene must have a UNIQUE visual image — do not repeat the same objects or compositions
• Vary scale across scenes: extreme close-up detail → medium character shot → wide establishing shot
• Vary camera angle: eye level → low angle → bird's-eye → Dutch tilt

═══ RESPONSE FORMAT ═══
Respond ONLY with a valid JSON array without markdown wrappers.
The number of elements must exactly match the number of scenes in the request.
Format of each element: {"scene": "Description in content language", "prompt": "English prompt"}`

async function extractCharacters(fullText, topic) {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Analyze this video script about "${topic}".

Identify ALL recurring visual characters (animals, creatures, people, beings) that PHYSICALLY APPEAR across multiple scenes — not just mentioned abstractly as concepts or ideas.

For each recurring character, write a concise 15–25 word ENGLISH visual description: species/type, distinctive color, key physical features, size/scale.

Rules:
- Only include characters that visually appear in at least 2 different scenes
- If no such characters exist — return []
- Maximum 4 characters
- Descriptions must be purely visual — no personality, behavior, or story context

Respond ONLY with valid JSON, no markdown:
[{"name": "name as used in script", "description": "english visual description"}]

Script (first 3000 chars):
${fullText.slice(0, 3000)}`,
    }],
  })
  const raw = msg.content[0].text.trim()
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(cleaned)
}

async function generatePrompts(topic, scenes, characters, styleInstruction) {
  const charSection = characters.length > 0
    ? `\nПЕРСОНАЖИ — включать точные описания в промпты для сцен где они присутствуют:\n${characters.map(c => `• ${c.name}: ${c.description}`).join('\n')}\n`
    : ''

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: scenes.length * 120,
    system: [{ type: 'text', text: SCENES_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: `Видео на тему: "${topic}". Ниже — ${scenes.length} отрывков сценария.

СТИЛЬ ИЛЛЮСТРАЦИЙ (соблюдать в каждом промте):
${styleInstruction}
${charSection}
ОТРЫВКИ:
${scenes.map((s, i) => `Сцена ${i + 1} [${s.tc}]:\n"${s.text}"`).join('\n\n')}

Ответь JSON массивом ровно ${scenes.length} элементов.`,
    }],
  })
  const raw = msg.content[0].text.trim()
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(cleaned)
}

function sep(label) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  ${label}`)
  console.log('═'.repeat(60))
}

// ═══════════════════════════════════════════════
// TEST CASE 1: ONE recurring character (octopus)
// ═══════════════════════════════════════════════

const script1 = `
Сегодня мы поговорим об одном из самых удивительных существ океана — осьминоге.
Осьминог — хищник, который охотится на рыбу и ракообразных в тёмных глубинах.
Его мозг содержит 500 миллионов нейронов — больше, чем у многих позвоночных.
Каждое из восьми щупалец осьминога действует полуавтономно, как отдельный организм.
Осьминог способен мгновенно менять цвет и текстуру кожи для маскировки.
Когда осьминог чувствует угрозу, он выпускает чернильное облако и стремительно уплывает.
Учёные доказали, что осьминоги решают сложные головоломки и даже используют инструменты.
`

const scenes1 = [
  { tc: '0:00–0:30', text: 'Сегодня мы поговорим об одном из самых удивительных существ океана — осьминоге.' },
  { tc: '0:30–1:00', text: 'Осьминог — хищник, который охотится на рыбу и ракообразных в тёмных глубинах.' },
  { tc: '1:00–1:30', text: 'Его мозг содержит 500 миллионов нейронов — больше, чем у многих позвоночных.' },
  { tc: '1:30–2:00', text: 'Каждое из восьми щупалец осьминога действует полуавтономно, как отдельный организм.' },
  { tc: '2:00–2:30', text: 'Осьминог способен мгновенно менять цвет и текстуру кожи для маскировки.' },
  { tc: '2:30–3:00', text: 'Когда осьминог чувствует угрозу, он выпускает чернильное облако и стремительно уплывает.' },
]

// ═══════════════════════════════════════════════
// TEST CASE 2: TWO recurring characters (octopus + fish)
// ═══════════════════════════════════════════════

const script2 = `
В глубинах Тихого океана осьминог и маленькая рыба-клоун живут по соседству.
Осьминог медленно движется по дну, щупальца ощупывают каждый камень в поисках добычи.
Рыба-клоун стремительно снует между ветками анемоны, прячась от хищников.
Неожиданно осьминог замечает рыбу-клоун и начинает медленно сближаться.
Рыба-клоун резко разворачивается и прячется в густых щупальцах анемоны.
Осьминог разочарованно отплывает, меняя цвет с красного на серый.
Через час они снова встречаются у коралловой скалы — осьминог и рыба-клоун.
`

const scenes2 = [
  { tc: '0:00–0:30', text: 'В глубинах Тихого океана осьминог и маленькая рыба-клоун живут по соседству.' },
  { tc: '0:30–1:00', text: 'Осьминог медленно движется по дну, щупальца ощупывают каждый камень.' },
  { tc: '1:00–1:30', text: 'Рыба-клоун стремительно снует между ветками анемоны, прячась от хищников.' },
  { tc: '1:30–2:00', text: 'Неожиданно осьминог замечает рыбу-клоун и начинает медленно сближаться.' },
  { tc: '2:00–2:30', text: 'Рыба-клоун резко разворачивается и прячется в густых щупальцах анемоны.' },
  { tc: '2:30–3:00', text: 'Осьминог разочарованно отплывает, меняя цвет с красного на серый.' },
]

const STYLE = 'Cinematic photorealistic underwater photography: dramatic lighting, moody atmosphere, high detail.'

async function run() {
  // ─── TEST 1 ───
  sep('TEST 1: One recurring character (octopus)')
  console.log('Extracting characters...')
  const chars1 = await extractCharacters(script1, '7 фактов об осьминоге')
  console.log('\nCharacters extracted:', JSON.stringify(chars1, null, 2))

  console.log('\nGenerating prompts...')
  const prompts1 = await generatePrompts('7 фактов об осьминоге', scenes1, chars1, STYLE)

  console.log('\n── RESULTS ──')
  for (let i = 0; i < prompts1.length; i++) {
    console.log(`\nСцена ${i + 1}: "${scenes1[i].text.slice(0, 60)}..."`)
    console.log(`  scene:  ${prompts1[i].scene}`)
    console.log(`  prompt: ${prompts1[i].prompt}`)
    if (chars1.length > 0) {
      const charName = chars1[0].description.split(' ').slice(0, 3).join(' ')
      const hasChar = prompts1[i].prompt.toLowerCase().includes(chars1[0].description.toLowerCase().slice(0, 20))
      console.log(`  ✓ character injected: ${hasChar ? 'YES' : 'NO (scene may not feature octopus)'}`)
    }
  }

  // ─── TEST 2 ───
  sep('TEST 2: Two recurring characters (octopus + clownfish)')
  console.log('Extracting characters...')
  const chars2 = await extractCharacters(script2, 'Осьминог и рыба-клоун')
  console.log('\nCharacters extracted:', JSON.stringify(chars2, null, 2))

  console.log('\nGenerating prompts...')
  const prompts2 = await generatePrompts('Осьминог и рыба-клоун', scenes2, chars2, STYLE)

  console.log('\n── RESULTS ──')
  const bothPresent = [false, false, false, true, true, false] // scenes where both appear
  const octopusOnly = [false, true, false, false, false, true]
  const fishOnly    = [false, false, true, false, false, false]

  for (let i = 0; i < prompts2.length; i++) {
    console.log(`\nСцена ${i + 1}: "${scenes2[i].text.slice(0, 60)}..."`)
    console.log(`  Expected chars: ${bothPresent[i] ? 'BOTH' : octopusOnly[i] ? 'octopus only' : fishOnly[i] ? 'fish only' : 'none/landscape'}`)
    console.log(`  scene:  ${prompts2[i].scene}`)
    console.log(`  prompt: ${prompts2[i].prompt}`)
  }

  sep('DONE')
  console.log('Check that:')
  console.log('1. Test 1: octopus description appears in most prompts, consistently worded')
  console.log('2. Test 2: scene 4 (both characters) includes both descriptions')
  console.log('3. Test 2: scene 3 (fish only) includes only clownfish, not octopus')
  console.log('4. All prompts have specific lighting, composition, mood terms')
}

run().catch(console.error)
