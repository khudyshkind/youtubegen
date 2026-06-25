import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { env } from '@/lib/env'
import { createServerSupabase } from '@/lib/supabase-server'

// Temporary test endpoint — delete after testing
export const maxDuration = 60

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
• Apply the style consistently across all scenes

═══ QUALITY AND VARIETY ═══
• Each scene must have a UNIQUE visual image — do not repeat the same objects or compositions
• Vary scale across scenes: extreme close-up detail → medium character shot → wide establishing shot
• Vary camera angle: eye level → low angle → bird's-eye → Dutch tilt

═══ RESPONSE FORMAT ═══
Respond ONLY with a valid JSON array without markdown wrappers.
The number of elements must exactly match the number of scenes in the request.
Format of each element: {"scene": "Description in content language", "prompt": "English prompt"}`

async function extractCharacters(fullText: string, topic: string, anthropic: Anthropic) {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Analyze this video script about "${topic}". Identify ALL recurring visual characters (animals, creatures, people, beings) that PHYSICALLY APPEAR across multiple scenes — not just mentioned abstractly.

For each recurring character, write a concise 15–25 word ENGLISH visual description: species/type, distinctive color, key physical features, size/scale.

Rules: only characters appearing in 2+ scenes, max 4, purely visual descriptions, return [] if none.
Respond ONLY with valid JSON: [{"name": "...", "description": "..."}]

Script: ${fullText.slice(0, 3000)}`,
    }],
  })
  const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '[]'
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(cleaned) as Array<{ name: string; description: string }>
}

async function generatePrompts(
  topic: string,
  scenes: Array<{ tc: string; text: string }>,
  characters: Array<{ name: string; description: string }>,
  anthropic: Anthropic,
) {
  const charSection = characters.length > 0
    ? `\nПЕРСОНАЖИ — включать точные описания в промпты для сцен где они присутствуют:\n${characters.map(c => `• ${c.name}: ${c.description}`).join('\n')}\n`
    : ''

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: scenes.length * 120,
    system: [{ type: 'text', text: SCENES_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: `Видео на тему: "${topic}". ${scenes.length} отрывков сценария.

СТИЛЬ ИЛЛЮСТРАЦИЙ: Cinematic photorealistic underwater photography: dramatic lighting, moody atmosphere, high detail.
${charSection}
ОТРЫВКИ:
${scenes.map((s, i) => `Сцена ${i + 1} [${s.tc}]:\n"${s.text}"`).join('\n\n')}

Ответь JSON массивом ровно ${scenes.length} элементов.`,
    }],
  })
  const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '[]'
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(cleaned) as Array<{ scene: string; prompt: string }>
}

export async function GET() {
  // Require auth even for test endpoint
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

  const script1 = `Сегодня мы поговорим об одном из самых удивительных существ океана — осьминоге. Осьминог — хищник, который охотится на рыбу и ракообразных в тёмных глубинах. Его мозг содержит 500 миллионов нейронов — больше, чем у многих позвоночных. Каждое из восьми щупалец осьминога действует полуавтономно, как отдельный организм. Осьминог способен мгновенно менять цвет и текстуру кожи для маскировки. Когда осьминог чувствует угрозу, он выпускает чернильное облако и стремительно уплывает.`
  const scenes1 = [
    { tc: '0:00–0:30', text: 'Сегодня мы поговорим об одном из самых удивительных существ океана — осьминоге.' },
    { tc: '0:30–1:00', text: 'Осьминог — хищник, который охотится на рыбу и ракообразных в тёмных глубинах.' },
    { tc: '1:00–1:30', text: 'Его мозг содержит 500 миллионов нейронов — больше, чем у многих позвоночных.' },
    { tc: '1:30–2:00', text: 'Каждое из восьми щупалец осьминога действует полуавтономно, как отдельный организм.' },
    { tc: '2:00–2:30', text: 'Осьминог способен мгновенно менять цвет и текстуру кожи для маскировки.' },
    { tc: '2:30–3:00', text: 'Когда осьминог чувствует угрозу, он выпускает чернильное облако и стремительно уплывает.' },
  ]

  const script2 = `В глубинах Тихого океана осьминог и маленькая рыба-клоун живут по соседству. Осьминог медленно движется по дну, щупальца ощупывают каждый камень в поисках добычи. Рыба-клоун стремительно снует между ветками анемоны, прячась от хищников. Неожиданно осьминог замечает рыбу-клоун и начинает медленно сближаться. Рыба-клоун резко разворачивается и прячется в густых щупальцах анемоны. Осьминог разочарованно отплывает, меняя цвет с красного на серый.`
  const scenes2 = [
    { tc: '0:00–0:30', text: 'В глубинах Тихого океана осьминог и маленькая рыба-клоун живут по соседству.' },
    { tc: '0:30–1:00', text: 'Осьминог медленно движется по дну, щупальца ощупывают каждый камень.' },
    { tc: '1:00–1:30', text: 'Рыба-клоун стремительно снует между ветками анемоны, прячась от хищников.' },
    { tc: '1:30–2:00', text: 'Неожиданно осьминог замечает рыбу-клоун и начинает медленно сближаться.' },
    { tc: '2:00–2:30', text: 'Рыба-клоун резко разворачивается и прячется в густых щупальцах анемоны.' },
    { tc: '2:30–3:00', text: 'Осьминог разочарованно отплывает, меняя цвет с красного на серый.' },
  ]

  const [chars1, chars2] = await Promise.all([
    extractCharacters(script1, '7 фактов об осьминоге', anthropic),
    extractCharacters(script2, 'Осьминог и рыба-клоун', anthropic),
  ])
  const [prompts1, prompts2] = await Promise.all([
    generatePrompts('7 фактов об осьминоге', scenes1, chars1, anthropic),
    generatePrompts('Осьминог и рыба-клоун', scenes2, chars2, anthropic),
  ])

  return NextResponse.json({
    test1: {
      topic: '7 фактов об осьминоге',
      characters: chars1,
      scenes: scenes1.map((s, i) => ({ ...s, ...prompts1[i] })),
    },
    test2: {
      topic: 'Осьминог и рыба-клоун',
      characters: chars2,
      scenes: scenes2.map((s, i) => ({ ...s, ...prompts2[i] })),
    },
  })
}
