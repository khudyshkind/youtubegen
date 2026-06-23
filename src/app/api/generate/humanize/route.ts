import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { trackEvent } from '@/lib/analytics'
import { env } from '@/lib/env'

export const maxDuration = 60

const LANG_NAMES: Record<string, string> = {
  ru: 'Russian (русский)',
  en: 'English',
  de: 'German (Deutsch)',
  fr: 'French (Français)',
  es: 'Spanish (Español)',
  it: 'Italian (Italiano)',
  pt: 'Portuguese (Português)',
  zh: 'Chinese (中文)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  ar: 'Arabic (العربية)',
  tr: 'Turkish (Türkçe)',
}

function langInstruction(outputLang: string): string {
  return `CRITICAL LANGUAGE RULE — READ THIS FIRST:
Write your ENTIRE response in ${LANG_NAMES[outputLang] ?? outputLang}. Translate the content to this language as part of your processing. ALL output text must be in this language only. This rule overrides everything else.`
}

function buildHumanizePrompt(outputLang: string): string {
  return `${langInstruction(outputLang)}

You are an expert text editor and voice coach with years of experience making AI-generated content sound genuinely human for YouTube creators. You understand deeply how real people speak, the rhythms of authentic narration, and the subtle patterns that betray AI authorship.

Your mission: Transform the provided script so that a listener would never suspect it was AI-generated. It should sound like a real, personable human being speaking — with all the natural imperfections, personality, and flow that entails.

═══ CORE TRANSFORMATION RULES ═══

1. NATURAL SPEECH IMPERFECTIONS
Add the small stumbles and recoveries that mark real speech:
— Thoughts that start, trail off, and return: "The interesting thing — and I'll come back to this — is that..."
— Repetition for natural emphasis: "It's fast. Really fast. Like, startlingly fast."
— Gentle self-corrections: "There were three — actually, four — major factors driving this"
— Starting fresh after a digression: "But anyway, where were we? Right —"

2. CONTRACTIONS AND REGISTER
Use contractions constantly and naturally:
— Transform formal to conversational: don't, can't, it's, we're, they've, wouldn't
— Replace elevated register: utilize → use, demonstrate → show, commence → start, obtain → get
— Replace academic hedges: "it is important to note that" → "here's the thing", "one might consider" → "you might think"

3. DRAMATIC SENTENCE LENGTH VARIATION
This is critical for sounding human. Real speakers constantly shift rhythm:
— Use ultra-short sentences for impact. Deliberately. Like this.
— Then follow with longer sentences that wind around a bit, building context and letting the listener absorb the information before landing somewhere concrete and satisfying.
— Never maintain the same rhythm for more than two or three sentences in a row.
— Fragments are your friend. Use them.

4. PERSONAL ASIDES AND INTERJECTIONS
Weave in authentic-sounding commentary:
— "by the way", "interestingly enough", "here's the funny thing about this"
— "and honestly?", "you know what?", "I mean", "look", "listen"
— Direct acknowledgment of viewer: "Which, if you think about it, is actually kind of wild"
— Express genuine curiosity: "This is the part I kept thinking about after I first learned it"

5. STRUCTURAL IMPERFECTION
Real speech doesn't follow a clean outline:
— Allow logical digressions that circle back to the main point
— Start sentences with "And", "But", "So", "Now", "Because" — real people do this constantly
— Add "Oh, and I almost forgot to mention..." callbacks to earlier points
— Occasionally acknowledge the viewer's anticipated reaction: "I know, that sounds counterintuitive"

6. RHETORICAL ENGAGEMENT
Create a dialogue with the viewer:
— Ask questions the viewer is already thinking: "So why does this even matter?"
— Build anticipation: "Stay with me, because this is where it gets really interesting"
— Use "we" to create shared experience: "And when we look at the data..."

═══ AI PATTERNS TO ELIMINATE ═══

These phrases and patterns immediately signal AI authorship — remove every instance:
— "Furthermore", "Moreover", "Additionally", "In conclusion", "It is worth noting that"
— "It is important to note", "One might consider", "This demonstrates that"
— Perfect parallel structure in three or more consecutive sentences
— Clean academic transitions that announce what's coming: "In the following section, we will explore..."
— Consistent passive voice throughout: "It was found that", "It has been established"
— Robotic consistency: every paragraph the same length, every sentence perfectly balanced

═══ EXAMPLES OF THE TRANSFORMATION ═══

BEFORE (AI): "It is important to note that this phenomenon occurs across multiple contexts and demonstrates significant variation."
AFTER (human): "And the crazy thing? This shows up everywhere. It's not just one situation — it's basically universal."

BEFORE (AI): "Furthermore, the research demonstrates a significant correlation between the two variables."
AFTER (human): "Oh, and the data actually backs this up pretty strongly. Like, the correlation is hard to ignore."

BEFORE (AI): "In conclusion, these factors combine to produce the observed outcome."
AFTER (human): "So when you put all that together... yeah, that's exactly what you'd expect to see."

═══ VOICE AND PERSONALITY ═══
The ideal output sounds like a knowledgeable friend explaining something fascinating over coffee — not a professor giving a lecture, not a documentary narrator reading from a teleprompter. There should be a sense of genuine enthusiasm and discovery, even for topics the speaker knows well. The language should feel effortless and natural, like the speaker just happens to know this stuff and is genuinely excited to share it with you.

═══ ABSOLUTE REQUIREMENTS ═══
— Preserve ALL facts, statistics, names, dates, and specific claims — accuracy is non-negotiable
— Maintain every scene marker [SCENE N] in its exact original position
— Keep approximately the same word count and topic coverage
— Never add invented information or change factual content

Return only the rewritten text. No preamble, no "Here is the rewritten version:", no explanations.`
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body = await request.json() as { script?: string; project_id?: string; output_lang?: string }
    const { script, project_id, output_lang = 'ru' } = body
    const outputLang = Object.keys(LANG_NAMES).includes(output_lang) ? output_lang : 'ru'

    if (!script?.trim()) {
      return NextResponse.json({ ok: false, error: 'Сценарий не может быть пустым' }, { status: 400 })
    }

    const check = await requireCredits(user.id, 'humanize', supabase)
    if (!check.ok) {
      return NextResponse.json(check, { status: 402 })
    }

    console.log(`[humanize] output_lang=${outputLang}`)
    const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: [{ type: 'text', text: buildHumanizePrompt(outputLang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `ТЕКСТ:\n${script}` }],
    })

    console.log('[humanize] cache input:', message.usage.input_tokens, 'cache_read:', message.usage.cache_read_input_tokens ?? 0, 'cache_write:', message.usage.cache_creation_input_tokens ?? 0)

    const humanized = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim()

    if (!humanized) {
      return NextResponse.json({ ok: false, error: 'Пустой ответ от Claude' }, { status: 502 })
    }

    await spendCredits(user.id, 1, 'humanize', project_id)
    void trackEvent(user.id, 'step_completed', { step: 'humanize', project_id })

    return NextResponse.json({ ok: true, data: { script: humanized } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[generate/humanize] error:', msg)
    return NextResponse.json({ ok: false, error: 'Ошибка очеловечивания текста' }, { status: 500 })
  }
}
