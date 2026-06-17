import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { requireCredits, spendCredits } from '@/lib/credits'
import { env } from '@/lib/env'

export const maxDuration = 60

function parseClaudeJson<T>(text: string, label: string): T {
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

const COUNTRY_LABELS: Record<string, string> = {
  ru: 'Россия',
  us: 'США',
  eu: 'Европа',
  cis: 'СНГ',
  mix: 'Смешанная аудитория',
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Необходима авторизация' }, { status: 401 })

    const body = await req.json() as { niche?: string; views?: number; country?: string }
    const niche = body.niche?.trim() ?? ''
    const views = Math.max(0, Math.round(body.views ?? 0))
    const country = body.country ?? 'mix'

    if (!niche) return NextResponse.json({ ok: false, error: 'Введите нишу' }, { status: 400 })
    if (views <= 0) return NextResponse.json({ ok: false, error: 'Введите количество просмотров' }, { status: 400 })

    const check = await requireCredits(user.id, 'revenue_calc', supabase)
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error, code: check.code }, { status: 402 })

    const countryLabel = COUNTRY_LABELS[country] ?? 'Смешанная аудитория'

    const prompt = `Ты эксперт по монетизации YouTube.
Ниша: ${niche}
Страна аудитории: ${countryLabel}

Определи реалистичный RPM (доход за 1000 просмотров после доли YouTube 45%).

Учитывай:
- США/Европа: RPM выше ($3-15, англоязычная аудитория)
- Россия/СНГ: RPM ниже ($0.5-3)
- Смешанная: RPM средний ($1.5-5)
- Финансы/бизнес/технологии: RPM выше
- Развлечения/юмор/игры: RPM ниже
- Авто/недвижимость/здоровье: RPM средний-высокий

Верни JSON СТРОГО в этом формате, только JSON, никакого текста до или после:
{"rpm_min":1.5,"rpm_max":3.5,"rpm_avg":2.5,"niche_factor":"Средний","explanation":"Авто-ниша в России имеет умеренный RPM из-за рекламодателей автодилеров и страховых компаний"}`

    const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    })
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

    await spendCredits(user.id, 3, 'revenue_calc')

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
    return NextResponse.json({ ok: false, error: `Ошибка расчёта: ${msg}` }, { status: 500 })
  }
}

function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}М`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}К`
  return String(n)
}
