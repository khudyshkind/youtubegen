import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'

export const maxDuration = 120

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

async function ytFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const key = env('YOUTUBE_API_KEY')
  const qs = new URLSearchParams({ ...params, key }).toString()
  const res = await fetch(`${YT_BASE}${path}?${qs}`)
  const text = await res.text()
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

function parseClaudeJson<T>(text: string, label: string): T {
  console.log(`[niche-finder] ${label} raw:`, text.substring(0, 600))
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start === -1) throw new Error(`${label}: no { found`)
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '{') depth++
    if (c === '}') { depth--; if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T }
  }
  throw new Error(`${label}: unbalanced braces`)
}

function getNicheGenPrompt(lang: string): string {
  const isRu = lang !== 'en'
  return isRu
    ? `Ты эксперт по YouTube стратегии с 10-летним опытом помощи людям в запуске успешных каналов.

Задача: на основе профиля пользователя предложить 5 YouTube ниш, которые максимально ему подходят.

Для каждой ниши учитывай:
• Соответствие интересам и навыкам (САМОЕ ВАЖНОЕ — человек должен разбираться и гореть темой)
• Потенциал монетизации на указанном рынке
• Конкурентность — насколько легко войти новичку с нуля
• Реалистичность с учётом доступного времени

ФОРМАТ ОТВЕТА — строго JSON без markdown:
{"niches":[{"name":"Название ниши","match_score":9,"reason":"Почему подходит именно этому человеку — 2-3 конкретных предложения","monetization":"Высокий","difficulty":"Средняя","time_required":"5-10 ч/нед","example_channels":["Канал 1","Канал 2"],"first_video_idea":"Конкретная идея первого видео для этой темы"}]}

match_score: от 1 до 10 (10 = идеальное совпадение с профилем)
monetization: "Высокий" / "Средний" / "Низкий"
difficulty: "Лёгкая" / "Средняя" / "Сложная"

Верни РОВНО 5 ниш. Только JSON. Начни с { и заканчивай с }.`
    : `You are a YouTube strategy expert with 10 years of experience helping people launch successful channels.

Task: Based on the user profile, suggest 5 YouTube niches that are the best possible fit for this person.

For each niche consider:
• Alignment with interests and skills (MOST IMPORTANT — person must know and love the topic)
• Monetization potential in the specified market
• Competition level — how easy is it for a complete beginner to enter
• Realistic given the user's available time

RESPONSE FORMAT — strict JSON without markdown:
{"niches":[{"name":"Niche Name","match_score":9,"reason":"Why this niche suits this person specifically — 2-3 concrete sentences","monetization":"High","difficulty":"Medium","time_required":"5-10 hrs/week","example_channels":["Channel 1","Channel 2"],"first_video_idea":"Specific first video idea for this topic"}]}

match_score: 1-10 (10 = perfect match with the profile)
monetization: "High" / "Medium" / "Low"
difficulty: "Easy" / "Medium" / "Hard"

Return EXACTLY 5 niches. JSON only. Start with { end with }.`
}

function getFinalPrompt(lang: string): string {
  const isRu = lang !== 'en'
  return isRu
    ? `Ты эксперт по YouTube стратегии. Ты получишь данные о 5 потенциальных YouTube нишах с реальной статистикой YouTube API.

Задача:
1. Выбери ЛУЧШУЮ нишу для старта
2. Дай конкретный план действий (5 шагов)
3. Напиши реалистичный прогноз роста
4. Выбери 2 альтернативы для рассмотрения позже
5. Укажи 1-2 ниши которых стоит ИЗБЕГАТЬ именно этому человеку

ВАЖНО: Учитывай данные YouTube API. Ниша с более высокими средними просмотрами и большим числом видео — значит есть спрос. Низкие просмотры + мало видео — ниша слишком узкая или не интересна зрителям.

ФОРМАТ — строго JSON:
{"winner":{"name":"Лучшая ниша","why_best":"3-4 предложения: почему именно эта ниша лучшая для данного человека с учётом его профиля И данных YouTube","action_plan":["Шаг 1: ...","Шаг 2: ...","Шаг 3: ...","Шаг 4: ...","Шаг 5: ..."],"realistic_timeline":"Реалистичный прогноз: 3 месяца — ..., 6 месяцев — ..., год — ...","potential_income":"Оценка дохода через год при регулярной публикации"},"alternatives":[{"name":"Альтернатива 1","when_to_consider":"Когда стоит переключиться"},{"name":"Альтернатива 2","when_to_consider":"Когда стоит переключиться"}],"avoid":[{"name":"Ниша для избегания","reason":"Почему НЕ подходит именно этому человеку"}]}

Только JSON. Начни с { и заканчивай с }.`
    : `You are a YouTube strategy expert. You will receive data about 5 potential YouTube niches with real YouTube API statistics.

Task:
1. Choose the BEST niche to start with
2. Give a concrete action plan (5 steps)
3. Write a realistic growth timeline
4. Choose 2 alternatives worth considering later
5. Identify 1-2 niches this person should AVOID

IMPORTANT: Consider YouTube API data. A niche with higher average views and more videos = there is demand. Low views + few videos = too narrow or not interesting to viewers.

FORMAT — strict JSON:
{"winner":{"name":"Best Niche","why_best":"3-4 sentences: why this is the best niche for this person given their profile AND YouTube data","action_plan":["Step 1: ...","Step 2: ...","Step 3: ...","Step 4: ...","Step 5: ..."],"realistic_timeline":"Realistic forecast: 3 months — ..., 6 months — ..., 1 year — ...","potential_income":"Estimated income after one year of consistent posting"},"alternatives":[{"name":"Alternative 1","when_to_consider":"When to consider switching"},{"name":"Alternative 2","when_to_consider":"When to consider switching"}],"avoid":[{"name":"Niche to Avoid","reason":"Why this niche specifically doesn't suit this person"}]}

JSON only. Start with { end with }.`
}

interface NicheItem {
  name: string
  match_score: number
  reason: string
  monetization: string
  difficulty: string
  time_required: string
  example_channels: string[]
  first_video_idea: string
  youtube_data?: { video_count: number; avg_views: number } | null
}

interface RecommendationResult {
  winner: { name: string; why_best: string; action_plan: string[]; realistic_timeline: string; potential_income: string }
  alternatives: Array<{ name: string; when_to_consider: string }>
  avoid: Array<{ name: string; reason: string }>
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as {
      interests?: string; skills?: string; time_per_week?: string
      goal?: string; country?: string; content_lang?: string; ui_lang?: string
    }
    const {
      interests = '', skills = '',
      time_per_week = '5-10', goal = 'money',
      country = 'RU', content_lang = 'ru', ui_lang = 'ru',
    } = body

    if (!interests.trim()) return NextResponse.json({ ok: false, error: 'Укажите ваши интересы' }, { status: 400 })
    if (!skills.trim()) return NextResponse.json({ ok: false, error: 'Укажите ваши навыки' }, { status: 400 })

    const check = await requireCredits(user.id, 'niche_finder', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })

    const userCtx = ui_lang === 'en'
      ? `Interests: ${interests}\nSkills: ${skills}\nTime per week: ${time_per_week} hours\nGoal: ${goal}\nTarget market: ${country}, content language: ${content_lang}`
      : `Интересы: ${interests}\nНавыки: ${skills}\nВремя в неделю: ${time_per_week} часов\nЦель: ${goal}\nЦелевой рынок: ${country}, язык контента: ${content_lang}`

    // Step 1: Claude generates 5 niches
    console.log('[niche-finder] step 1: generating niches')
    const msg1 = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: [{ type: 'text', text: getNicheGenPrompt(ui_lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userCtx }],
    })
    console.log('[niche-finder] claude1 tokens:', msg1.usage.input_tokens, 'cache_read:', msg1.usage.cache_read_input_tokens ?? 0)
    const text1 = (msg1.content[0] as { text: string }).text
    const { niches } = parseClaudeJson<{ niches: NicheItem[] }>(text1, 'claude1')
    if (!niches?.length) throw new Error('No niches returned from Claude')

    // Step 2: YouTube data for top 3 niches (parallel)
    console.log('[niche-finder] step 2: YouTube data for top 3')
    const ytBase: Record<string, string> = { part: 'snippet', type: 'video', maxResults: '10', order: 'viewCount' }
    if (content_lang && content_lang !== 'auto') ytBase.relevanceLanguage = content_lang
    if (country && country !== 'worldwide') ytBase.regionCode = country

    const ytResults = await Promise.all(niches.slice(0, 3).map(async (niche) => {
      try {
        const search = await ytFetch('/search', { ...ytBase, q: niche.name }) as {
          items?: Array<{ id: { videoId: string } }>
          pageInfo?: { totalResults: number }
        }
        const ids = (search.items ?? []).map(v => v.id?.videoId).filter(Boolean).join(',')
        let avgViews = 0
        if (ids) {
          const stats = await ytFetch('/videos', { part: 'statistics', id: ids }) as {
            items?: Array<{ statistics: { viewCount?: string } }>
          }
          const views = (stats.items ?? []).map(v => parseInt(v.statistics.viewCount ?? '0')).filter(v => v > 0)
          if (views.length) avgViews = Math.round(views.reduce((a, b) => a + b, 0) / views.length)
        }
        return { name: niche.name, video_count: search.pageInfo?.totalResults ?? 0, avg_views: avgViews }
      } catch (e) {
        console.warn(`[niche-finder] YT failed for "${niche.name}":`, e instanceof Error ? e.message : String(e))
        return { name: niche.name, video_count: 0, avg_views: 0 }
      }
    }))

    const enrichedNiches: NicheItem[] = niches.map((niche, idx) => ({
      ...niche,
      youtube_data: idx < 3 ? (ytResults.find(r => r.name === niche.name) ?? { video_count: 0, avg_views: 0 }) : null,
    }))

    // Step 3: Claude finalizes recommendation
    console.log('[niche-finder] step 3: finalizing recommendation')
    const finalCtx = ui_lang === 'en'
      ? `User profile:\n${userCtx}\n\nNiches with YouTube data:\n${JSON.stringify(enrichedNiches, null, 2)}`
      : `Профиль пользователя:\n${userCtx}\n\nНиши с данными YouTube:\n${JSON.stringify(enrichedNiches, null, 2)}`

    const msg2 = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: [{ type: 'text', text: getFinalPrompt(ui_lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: finalCtx }],
    })
    console.log('[niche-finder] claude2 tokens:', msg2.usage.input_tokens, 'cache_read:', msg2.usage.cache_read_input_tokens ?? 0)
    const text2 = (msg2.content[0] as { text: string }).text
    const rec = parseClaudeJson<RecommendationResult>(text2, 'claude2')

    const result = {
      niches: enrichedNiches,
      winner: rec.winner,
      alternatives: rec.alternatives ?? [],
      avoid: rec.avoid ?? [],
      user_profile: { interests, skills, time_per_week, goal },
    }

    await spendCredits(user.id, 6, 'niche_finder')

    // Save to reports (non-fatal)
    try {
      const svc = createServiceClient()
      const { data: old } = await svc.from('analytics_reports').select('id')
        .eq('user_id', user.id).eq('report_type', 'niche_finder')
        .order('created_at', { ascending: true })
      if ((old?.length ?? 0) >= 20) await svc.from('analytics_reports').delete().eq('id', old![0].id)
      await svc.from('analytics_reports').insert({
        user_id: user.id, report_type: 'niche_finder',
        title: `Поиск ниши: ${rec.winner.name}`,
        query: interests.slice(0, 80),
        result,
      })
    } catch (e) {
      console.warn('[niche-finder] report save failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/niche-finder] error:', msg)
    return NextResponse.json({ ok: false, error: `Ошибка: ${msg}` }, { status: 500 })
  }
}
