import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { env } from '@/lib/env'
import { resolveUserLang, langNote } from '@/lib/user-lang'
import { parseClaudeJson } from '@/lib/parse-claude-json'
import { resolveAnalyticsContext } from '@/lib/analytics-gate'

export const maxDuration = 60

const CACHE_TTL_DAYS = 30

// ─── Types ────────────────────────────────────────────────────────────────────

interface NicheDirection {
  name:        string
  description: string
  examples:    string[]
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function getDirectionsPrompt(lang: string): string {
  const isRu = lang !== 'en'
  return isRu
    ? `Ты эксперт по YouTube-стратегии. Разбей широкую нишу на 5–7 крупных РЫНОЧНЫХ СЕГМЕНТОВ.

Сегменты — это разные аудитории с разными мотивациями, а не подтемы.
Для «музыки»: Слушатели и аудитория / Обучение и инструменты / Производство и оборудование / Индустрия и культура — НЕ «рок, поп, джаз».
Для «личных финансов»: Начинающие инвесторы / Бизнес и самозанятость / Экономия и бюджет / Пассивный доход / Налоги и право.

По каждому сегменту:
• name — короткое название (3–6 слов)
• description — 1–2 предложения: что входит и кто аудитория
• examples — 3–5 конкретных примеров подниш внутри (только перечисление, без метрик)

ФОРМАТ — строго JSON без markdown:
{"directions":[{"name":"Слушатели и аудитория","description":"Люди, которые слушают и открывают музыку, а не играют сами. Контент — плейлисты, разборы альбомов, подборки.","examples":["Музыка для сна и медитации","Плейлисты по настроению","Разборы альбомов","Классика для начинающих слушателей"]},...]}

Верни ровно 5–7 сегментов. Только JSON. Начни с {.`
    : `You are a YouTube strategy expert. Break a broad niche into 5–7 major MARKET SEGMENTS.

Segments are different audiences with different motivations, not sub-topics.
For "music": Listeners & Fans / Learning & Instruments / Production & Gear / Industry & Culture — NOT "rock, pop, jazz".
For "personal finance": Beginner Investors / Business & Self-Employment / Saving & Budgeting / Passive Income / Tax & Legal.

For each segment:
• name — short label (3–6 words)
• description — 1–2 sentences: what's inside and who the audience is
• examples — 3–5 specific sub-niche examples (list only, no metrics)

FORMAT — strict JSON without markdown:
{"directions":[{"name":"Listeners & Fans","description":"People who want to listen and discover music, not play themselves. Content is playlists, album reviews, recommendations.","examples":["Sleep & meditation music","Mood playlists","Album breakdowns","Classical music for beginners"]},...]}

Return exactly 5–7 segments. JSON only. Start with {.`
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body        = await req.json() as { broad_niche?: string; ui_lang?: string }
    const broad_niche = body.broad_niche?.trim() ?? ''
    const lang        = body.ui_lang ?? 'ru'

    if (!broad_niche) {
      return NextResponse.json(
        { ok: false, error: lang !== 'en' ? 'Укажите широкую нишу' : 'Enter a broad niche' },
        { status: 400 }
      )
    }

    // Analytics gate — plan or BYOK required, no extra BYOK-only check (quota_used=0)
    const svc = createServiceClient()
    const ctx = await resolveAnalyticsContext(user.id, svc, lang)
    if (ctx.gateRes) return ctx.gateRes

    // Cache check — 30 days (directions rarely change)
    const cacheKey = `${broad_niche.toLowerCase().trim()}|${lang}|v1`
    try {
      const { data: cached } = await svc
        .from('analytics_cache')
        .select('result, created_at')
        .eq('cache_type', 'niche_directions')
        .eq('cache_key', cacheKey)
        .gt('created_at', new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString())
        .maybeSingle()
      if (cached) {
        console.log('[niche-directions] cache hit')
        return NextResponse.json({ ok: true, data: cached.result, cached: true })
      }
    } catch (e) {
      console.warn('[niche-directions] cache check failed:', e instanceof Error ? e.message : String(e))
    }

    // Haiku — no YouTube API at all
    const uiLangFull = resolveUserLang(req, lang)
    const anthropic  = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: 60_000 })
    const msg = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: [{ type: 'text', text: getDirectionsPrompt(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{
        role:    'user',
        content: `Ниша: "${broad_niche}".${langNote(uiLangFull)}`,
      }],
    })
    console.log('[niche-directions] haiku in:', msg.usage.input_tokens, 'out:', msg.usage.output_tokens)

    const raw = msg.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
    const { directions } = parseClaudeJson<{ directions: NicheDirection[] }>(raw, 'niche-directions-haiku')
    if (!directions?.length) throw new Error('Haiku returned no directions')

    const result = {
      broad_niche,
      directions:  directions.slice(0, 7),
      quota_used:  0,
      analyzed_at: new Date().toISOString(),
    }

    // Cache write — 30 days (non-fatal)
    try {
      await svc.from('analytics_cache').upsert({
        cache_type: 'niche_directions',
        cache_key:  cacheKey,
        result,
        created_at: new Date().toISOString(),
      }, { onConflict: 'cache_type,cache_key' })
    } catch (e) {
      console.warn('[niche-directions] cache write failed:', e instanceof Error ? e.message : String(e))
    }

    console.log(`[niche-directions] done | broad="${broad_niche}" segments=${result.directions.length} quota=0`)
    return NextResponse.json({ ok: true, data: result, cached: false })

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/niche-directions] error:', msg)
    return NextResponse.json({ ok: false, error: 'Сервис временно недоступен — попробуйте позже' }, { status: 500 })
  }
}
