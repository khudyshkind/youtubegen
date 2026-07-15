import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/types'
import { env } from '@/lib/env'
import { parseClaudeJson } from '@/lib/parse-claude-json'
import { isBillingError, notifyBillingError } from '@/lib/telegram'

export const maxDuration = 60


function getRevenuePrompt(lang: string): string {
  const isRu = lang !== 'en'
  return isRu ? `Ты эксперт по монетизации YouTube. На основе ниши и географии аудитории определи реалистичный RPM (доход на 1000 просмотров после вычета 45% YouTube).

ОРИЕНТИРЫ RPM ПО РЫНКАМ:
- США / Канада / Австралия / Великобритания: $4-15 (премиум рекламодатели)
- Западная Европа (DE/FR/NL/SE/CH): $3-10
- Восточная Европа / СНГ / Россия: $0.5-3
- LATAM (BR/MX/AR): $0.5-2
- ЮВА (TH/PH/ID/MY): $0.3-1.5
- Индия: $0.2-1
- Смешанная / глобальная аудитория: $1.5-5

МНОЖИТЕЛИ ПО НИШАМ: Финансы/бизнес/страхование: 2-3x | Технологии/ПО: 1.5-2x | Авто/здоровье: 1.2-1.8x | Образование: 1x | Развлечения/игры: 0.5-0.8x

ФОРМАТ ОТВЕТА — строго JSON без markdown без пояснений:
{"rpm_min":1.5,"rpm_max":3.5,"rpm_avg":2.5,"niche_factor":"Средний","explanation":"Автомобильная ниша — умеренный RPM благодаря рекламодателям из сферы автодилеров и страхования. Российская аудитория даёт более низкий RPM чем западная."}

ВАЖНО: Верни ТОЛЬКО валидный JSON. Все текстовые значения — строго на русском языке. Никаких \`\`\`json. Никаких пояснений. Начни с { и заканчивай с }.`
  : `You are a YouTube monetization expert. Based on the niche and audience geography, determine a realistic RPM (revenue per 1000 views after YouTube's 45% cut).

RPM BENCHMARKS BY MARKET:
- US / Canada / Australia / UK: $4-15 (premium advertisers)
- Western Europe (DE/FR/NL/SE/CH): $3-10
- Eastern Europe / CIS / Russia: $0.5-3
- LATAM (BR/MX/AR): $0.5-2
- SE Asia (TH/PH/ID/MY): $0.3-1.5
- India: $0.2-1
- Mixed / global audience: $1.5-5

NICHE MULTIPLIERS: Finance/business/insurance: 2-3x | Tech/software: 1.5-2x | Auto/health: 1.2-1.8x | Education: 1x | Entertainment/gaming: 0.5-0.8x

RESPONSE FORMAT — strict JSON without markdown:
{"rpm_min":2.0,"rpm_max":5.0,"rpm_avg":3.5,"niche_factor":"Medium-High","explanation":"Auto niche has moderate-to-good RPM driven by car dealer and insurance advertisers. US/Western audience commands premium rates from automotive brands."}

IMPORTANT: Return ONLY valid JSON. All text values must be in English. No \`\`\`json. No explanations. Start with { end with }.`
}

const COUNTRY_LABELS: Record<string, string> = {
  ru: 'Россия / СНГ',
  us: 'США / Канада / Австралия',
  eu: 'Западная Европа',
  cis: 'СНГ / Восточная Европа',
  latam: 'LATAM (Бразилия / Мексика / Аргентина)',
  sea: 'ЮВА (Таиланд / Филиппины / Индонезия)',
  india: 'Индия',
  mix: 'Смешанная / глобальная аудитория',
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { niche?: string; views?: number; country?: string; lang?: string; ui_lang?: string }
    const niche = body.niche?.trim() ?? ''
    const views = Math.max(0, Math.round(body.views ?? 0))
    const country = body.country ?? 'mix'
    const lang = body.ui_lang ?? body.lang ?? 'ru'

    if (!niche) return NextResponse.json({ ok: false, error: 'Введите нишу' }, { status: 400 })
    if (views <= 0) return NextResponse.json({ ok: false, error: 'Введите количество просмотров' }, { status: 400 })

    const check = await requireCredits(user.id, 'revenue_calc', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    const countryLabel = COUNTRY_LABELS[country] ?? 'Смешанная / глобальная аудитория'

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: [{ type: 'text', text: getRevenuePrompt(lang), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Ниша: ${niche}\nРынок аудитории: ${countryLabel}` }],
    })
    if (msg.stop_reason === 'max_tokens') console.warn('[revenue] claude truncated by max_tokens')
    const raw = (msg.content[0] as { text: string }).text

    interface RpmData {
      rpm_min: number
      rpm_max: number
      rpm_avg: number
      niche_factor: string
      explanation: string
    }
    const rpm = parseClaudeJson<RpmData>(raw, 'claude')

    const monthly_min = Math.round((views / 1000) * rpm.rpm_min)
    const monthly_max = Math.round((views / 1000) * rpm.rpm_max)
    const monthly_avg = Math.round((views / 1000) * rpm.rpm_avg)

    const result = {
      niche,
      views,
      country,
      country_label: countryLabel,
      rpm: {
        min: rpm.rpm_min,
        max: rpm.rpm_max,
        avg: rpm.rpm_avg,
        niche_factor: rpm.niche_factor,
        explanation: rpm.explanation,
      },
      monthly: { min: monthly_min, max: monthly_max, avg: monthly_avg },
      quarterly: { min: monthly_min * 3, max: monthly_max * 3, avg: monthly_avg * 3 },
      biannual: { min: monthly_min * 6, max: monthly_max * 6, avg: monthly_avg * 6 },
      annual: { min: monthly_min * 12, max: monthly_max * 12, avg: monthly_avg * 12 },
    }

    await spendCredits(user.id, CREDIT_COSTS.revenue_calc, 'revenue_calc')

    // Save to history (non-fatal)
    const svc = createServiceClient()
    try {
      const { data: old } = await svc
        .from('analytics_reports')
        .select('id')
        .eq('user_id', user.id)
        .eq('report_type', 'revenue')
        .order('created_at', { ascending: true })
      if ((old?.length ?? 0) >= 20) {
        await svc.from('analytics_reports').delete().eq('id', old![0].id)
      }
      await svc.from('analytics_reports').insert({
        user_id: user.id,
        report_type: 'revenue',
        title: `Доход: ${niche} · ${fmtViews(views)} просм./мес`,
        query: `${niche}|${views}|${country}`,
        result,
      })
    } catch (e) {
      console.warn('[revenue] report save failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analytics/revenue] error:', msg)
    if (isBillingError(msg)) await notifyBillingError('Anthropic', '/analytics/revenue').catch(() => {})
    return NextResponse.json({ ok: false, error: 'Сервис временно недоступен — попробуйте позже' }, { status: 500 })
  }
}

function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}М`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}К`
  return String(n)
}
