import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase } from '@/lib/supabase-server'
import { requireCreditsAmount, spendCredits } from '@/lib/credits'
import { trackEvent } from '@/lib/analytics'
import { env } from '@/lib/env'
import { CREDIT_COSTS } from '@/lib/types'
import {
  countWords, calcMaxTokens, isGuardOk,
  runChunked, ChunkCallFn, CHUNK_THRESHOLD,
} from '@/lib/enhance-guard'

export const maxDuration = 120

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
  hi: 'Hindi (हिंदी)',
  nl: 'Dutch (Nederlands)',
  pl: 'Polish (Polski)',
  tr: 'Turkish (Türkçe)',
  sv: 'Swedish (Svenska)',
  no: 'Norwegian (Norsk)',
  da: 'Danish (Dansk)',
  fi: 'Finnish (Suomi)',
  uk: 'Ukrainian (Українська)',
  cs: 'Czech (Čeština)',
  ro: 'Romanian (Română)',
  hu: 'Hungarian (Magyar)',
  el: 'Greek (Ελληνικά)',
  he: 'Hebrew (עברית)',
  th: 'Thai (ภาษาไทย)',
  id: 'Indonesian (Bahasa Indonesia)',
  vi: 'Vietnamese (Tiếng Việt)',
}

function langInstruction(outputLang: string): string {
  return `CRITICAL LANGUAGE RULE — READ THIS FIRST:
Write your ENTIRE response in ${LANG_NAMES[outputLang] ?? outputLang}. Translate the content to this language as part of your processing. ALL output text must be in this language only. This rule overrides everything else.`
}

function buildUniqueizePrompt(outputLang: string): string {
  return `${langInstruction(outputLang)}

You are a professional text editor specializing in content uniqueness optimization for YouTube creators. Your expertise lies in restructuring text at the sentence, paragraph, and logical levels to create fully original content that passes plagiarism detection tools while preserving complete factual accuracy.

Your mission: Rewrite the provided text so that it registers as unique and original across anti-plagiarism systems, while keeping every piece of factual information, every statistic, and every key idea intact.

═══ UNIQUENESS TRANSFORMATION RULES ═══

1. SENTENCE STRUCTURE RECONSTRUCTION
Every sentence should have a fundamentally different grammatical structure from the original:
— Rearrange subject-verb-object order: "Scientists discovered X" → "X was identified by researchers when..."
— Convert active to passive and vice versa strategically
— Break compound sentences into simple ones, or merge simple sentences into complex ones
— Move adverbs, adjectives, and clauses to different positions within sentences
— Change sentence openings: if the original starts with the subject, start with time, place, or manner

2. VOCABULARY DIVERSIFICATION
Replace words with precise synonyms while preserving exact meaning:
— Never use the same significant word in the same position as the original
— Use synonyms from different registers when appropriate (formal, colloquial, technical)
— Replace phrase patterns: "as a result" → "consequently", "because of" → "due to", "shows" → "indicates", "found" → "discovered" → "identified"
— Change noun forms to verb forms and vice versa: "demonstrate" → "provide a demonstration of"

3. INFORMATION SEQUENCING
Restructure the order in which information is presented:
— If the original presents A then B then C, consider B then C then A when logical flow allows
— Move supporting evidence to different positions within arguments
— Present conclusions before the evidence they're drawn from when appropriate
— Merge or split thematic groups of information

4. STRUCTURAL DIVERSIFICATION
Vary paragraph and section structure:
— If the original uses flowing prose, consider bulleted lists, and vice versa
— Change how ideas connect: replace transition words with structural proximity
— Vary paragraph length — if the original has even paragraphs, mix short and long
— Change how examples are introduced: "For example" → "Consider the case of..." → "A good illustration is..."

5. SYNTACTIC VARIETY
Create maximum surface-level diversity:
— Use appositives, participial phrases, and subordinate clauses in new positions
— Vary sentence length from 5 words to 35 words within the same paragraph
— Use different punctuation patterns: em dashes, semicolons, colons in new positions

═══ WHAT TO PRESERVE EXACTLY ═══
— All numbers, statistics, percentages, dates, and measurements
— All proper nouns: names, places, brands, organizations, titles
— All technical terms that have no acceptable synonyms in context
— All factual claims — the meaning must not change at all
— Any structural markers or formatting in their exact original positions
— Approximate word count — do not significantly expand or shrink

FACTUAL ACCURACY IS ABSOLUTE: dates, numbers, names, abbreviations, and numeric
designations must be copied EXACTLY from the source — restyle the delivery, never
the content. Do not paraphrase, approximate, or reinterpret any specific fact.

═══ QUALITY CRITERIA ═══
A successfully uniqueized text should:
✓ Contain no sentence structurally similar to the original beyond 50%
✓ Use no consecutive sequence of more than 4-5 words from the original
✓ Preserve 100% of the factual content and meaning
✓ Read naturally and coherently — not like a thesaurus was applied blindly
✓ Have clearly different surface features: different word choices, openings, structure

═══ STYLE ═══
Neutral, clean, professional. No conversational phrases, no personality injected. The goal is clean, uniquely-worded neutral text — not humanization. Save personality and voice for other editing stages.

═══ COMMON PITFALLS TO AVOID ═══
— Thesaurus abuse: replacing words with awkward synonyms that don't fit context
— Destroying technical precision by over-synonymizing specialized terms
— Introducing grammatical errors in an attempt to vary structure
— Reducing readability in pursuit of uniqueness — the output must still read well and make sense

Return only the rewritten text. No preamble, no "Here is the rewritten version:", no explanations.`
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
— Clean academic transitions: "In the following section, we will explore..."
— Consistent passive voice: "It was found that", "It has been established"
— Robotic consistency: every paragraph the same length, every sentence perfectly balanced

═══ EXAMPLES OF THE TRANSFORMATION ═══

BEFORE (AI): "It is important to note that this phenomenon occurs across multiple contexts and demonstrates significant variation."
AFTER (human): "And the crazy thing? This shows up everywhere. It's not just one situation — it's basically universal."

BEFORE (AI): "Furthermore, the research demonstrates a significant correlation between the two variables."
AFTER (human): "Oh, and the data actually backs this up pretty strongly. Like, the correlation is hard to ignore."

BEFORE (AI): "In conclusion, these factors combine to produce the observed outcome."
AFTER (human): "So when you put all that together... yeah, that's exactly what you'd expect to see."

═══ VOICE AND PERSONALITY ═══
The ideal output sounds like a knowledgeable friend explaining something fascinating over coffee — not a professor giving a lecture, not a documentary narrator reading from a teleprompter. There should be a sense of genuine enthusiasm and discovery, even for topics the speaker knows well.

═══ ABSOLUTE REQUIREMENTS ═══
— Preserve ALL facts, statistics, names, dates, and specific claims
— Maintain any structural markers or formatting in their exact original position
— Keep approximately the same word count and topic coverage
— Never add invented information or change factual content
— FACTUAL ACCURACY IS ABSOLUTE: dates, numbers, names, abbreviations, and numeric
  designations must be copied EXACTLY from the source — restyle the delivery, never
  the content. Do not paraphrase, approximate, or reinterpret any specific fact.

Return only the rewritten text. No preamble, no "Here is the rewritten version:", no explanations.`
}

async function callClaude(
  client: Anthropic,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
  tag: string,
): Promise<{ text: string; stopReason: string | null }> {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userContent }],
  })
  console.log(`[uniqueize/${tag}] stop_reason=${msg.stop_reason} input_tokens=${msg.usage.input_tokens} cache_read=${msg.usage.cache_read_input_tokens ?? 0} cache_write=${msg.usage.cache_creation_input_tokens ?? 0}`)
  return {
    text: msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim(),
    stopReason: msg.stop_reason,
  }
}

async function runWithGuard(
  client: Anthropic,
  systemPrompt: string,
  input: string,
  maxTokens: number,
  inputWords: number,
  tag: string,
): Promise<string | null> {
  const userContent = `ТЕКСТ:\n${input}`
  const a1 = await callClaude(client, systemPrompt, userContent, maxTokens, tag)
  if (a1.text && isGuardOk(a1.stopReason, a1.text, inputWords)) return a1.text
  console.warn(`[uniqueize/${tag}] guard fail attempt=1 outputWords=${countWords(a1.text)} inputWords=${inputWords} stop_reason=${a1.stopReason} — retrying`)
  const a2 = await callClaude(client, systemPrompt, userContent, maxTokens, tag)
  if (a2.text && isGuardOk(a2.stopReason, a2.text, inputWords)) return a2.text
  console.error(`[uniqueize/${tag}] guard fail attempt=2 outputWords=${countWords(a2.text)} — aborting, credits not charged`)
  return null
}

async function processText(
  client: Anthropic,
  systemPrompt: string,
  text: string,
  inputWords: number,
  maxTokens: number,
  tag: string,
): Promise<string | null> {
  if (inputWords <= CHUNK_THRESHOLD) {
    return runWithGuard(client, systemPrompt, text, maxTokens, inputWords, tag)
  }
  const callFn: ChunkCallFn = (userContent, chunkMaxTokens, chunkTag) =>
    callClaude(client, systemPrompt, userContent, chunkMaxTokens, chunkTag)
  return runChunked(text, callFn, tag)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })
    }

    const body = await request.json() as { script?: string; project_id?: string; mode?: string; output_lang?: string }
    const { script, project_id, mode = 'unique', output_lang = 'ru' } = body
    const outputLang = Object.keys(LANG_NAMES).includes(output_lang) ? output_lang : 'ru'

    if (!script?.trim()) {
      return NextResponse.json({ ok: false, error: 'Текст не может быть пустым' }, { status: 400 })
    }

    if (!['unique', 'human', 'both'].includes(mode)) {
      return NextResponse.json({ ok: false, error: 'Неверный режим' }, { status: 400 })
    }

    const creditCost =
      mode === 'both'  ? CREDIT_COSTS.uniqueize + CREDIT_COSTS.humanize :
      mode === 'human' ? CREDIT_COSTS.humanize :
      CREDIT_COSTS.uniqueize
    const check = await requireCreditsAmount(user.id, creditCost, supabase)
    if (!check.ok) {
      return NextResponse.json({ ok: false, error: 'Недостаточно кредитов', code: 'NO_CREDITS' }, { status: 402 })
    }

    const inputWords = countWords(script)
    const maxTokens  = calcMaxTokens(script)
    console.log(`[uniqueize] mode=${mode} output_lang=${outputLang} maxTokens=${maxTokens} inputWords=${inputWords}`)
    const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    let result: string

    if (mode === 'unique') {
      const r = await processText(client, buildUniqueizePrompt(outputLang), script, inputWords, maxTokens, 'unique')
      if (r === null) {
        return NextResponse.json({ ok: false, error: 'Не удалось обработать текст целиком — попробуйте ещё раз или разбейте текст на части', code: 'UNIQUEIZE_TRUNCATED' }, { status: 422 })
      }
      result = r
    } else if (mode === 'human') {
      const r = await processText(client, buildHumanizePrompt(outputLang), script, inputWords, maxTokens, 'human')
      if (r === null) {
        return NextResponse.json({ ok: false, error: 'Не удалось обработать текст целиком — попробуйте ещё раз или разбейте текст на части', code: 'UNIQUEIZE_TRUNCATED' }, { status: 422 })
      }
      result = r
    } else {
      // both: uniqueize first, then humanise the result; neither step may truncate
      const r1 = await processText(client, buildUniqueizePrompt(outputLang), script, inputWords, maxTokens, 'unique')
      if (r1 === null) {
        return NextResponse.json({ ok: false, error: 'Не удалось обработать текст целиком — попробуйте ещё раз или разбейте текст на части', code: 'UNIQUEIZE_TRUNCATED' }, { status: 422 })
      }
      const r1Words = countWords(r1)
      const r2 = await processText(client, buildHumanizePrompt(outputLang), r1, r1Words, calcMaxTokens(r1), 'human')
      if (r2 === null) {
        return NextResponse.json({ ok: false, error: 'Не удалось обработать текст целиком — попробуйте ещё раз или разбейте текст на части', code: 'UNIQUEIZE_TRUNCATED' }, { status: 422 })
      }
      result = r2
    }

    await spendCredits(user.id, creditCost, `uniqueize_${mode}`, project_id)
    void trackEvent(user.id, 'step_completed', { step: 'uniqueize', mode, project_id })

    return NextResponse.json({ ok: true, data: { script: result } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[generate/uniqueize] error:', msg)
    return NextResponse.json({ ok: false, error: 'Ошибка обработки текста' }, { status: 500 })
  }
}
