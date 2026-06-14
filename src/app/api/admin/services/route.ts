import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'

export const maxDuration = 30

// ─── Types ─────────────────────────────────────────────────────────────────────

type Status = 'ok' | 'warn' | 'error' | 'unconfigured'

interface Metric {
  label: string
  value: string
}

export interface ServiceResult {
  key: string
  name: string
  icon: string
  link: string
  status: Status
  metrics: Metric[]
  error?: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function envVar(name: string): string {
  return process.env[name] ?? ''
}

async function safeFetch(url: string, init?: RequestInit, timeoutMs = 7000): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
  } finally {
    clearTimeout(t)
  }
}

function unconfigured(base: Omit<ServiceResult, 'status' | 'metrics'>, varName: string): ServiceResult {
  return { ...base, status: 'unconfigured', metrics: [], error: `${varName} не задан` }
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}д ${h}ч`
  if (h > 0) return `${h}ч ${m}м`
  return `${m}м`
}

// ─── Service checks ─────────────────────────────────────────────────────────────

async function checkAnthropic(): Promise<ServiceResult> {
  const base = { key: 'anthropic', name: 'Anthropic (Claude)', icon: '🤖', link: 'https://console.anthropic.com' }
  const apiKey = envVar('ANTHROPIC_API_KEY')
  if (!apiKey) return unconfigured(base, 'ANTHROPIC_API_KEY')
  try {
    const res = await safeFetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    })
    if (res.status === 401 || res.status === 403) return { ...base, status: 'error', metrics: [], error: 'Ключ недействителен' }
    if (!res.ok) return { ...base, status: 'error', metrics: [], error: `HTTP ${res.status}` }
    const data = await res.json()
    const modelCount = Array.isArray(data.data) ? data.data.length : '?'
    return {
      ...base, status: 'ok',
      metrics: [
        { label: 'Статус', value: '✓ Ключ активен' },
        { label: 'Доступно моделей', value: String(modelCount) },
        { label: 'Баланс', value: '↗ Проверить в консоли' },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

async function checkOpenAI(): Promise<ServiceResult> {
  const base = { key: 'openai', name: 'OpenAI (Whisper)', icon: '🎤', link: 'https://platform.openai.com/usage' }
  const apiKey = envVar('OPENAI_API_KEY')
  if (!apiKey) return unconfigured(base, 'OPENAI_API_KEY')
  try {
    const res = await safeFetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (res.status === 401 || res.status === 403) return { ...base, status: 'error', metrics: [], error: 'Ключ недействителен' }
    if (!res.ok) return { ...base, status: 'error', metrics: [], error: `HTTP ${res.status}` }
    return {
      ...base, status: 'ok',
      metrics: [
        { label: 'Статус', value: '✓ Ключ активен' },
        { label: 'Использование', value: '↗ Смотри в платформе' },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

async function checkElevenLabs(): Promise<ServiceResult> {
  const base = { key: 'elevenlabs', name: 'ElevenLabs (TTS)', icon: '🔊', link: 'https://elevenlabs.io/app/subscription' }
  const apiKey = envVar('ELEVENLABS_API_KEY')
  if (!apiKey) return unconfigured(base, 'ELEVENLABS_API_KEY')
  try {
    const res = await safeFetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': apiKey },
    })
    if (res.status === 401 || res.status === 403) return { ...base, status: 'error', metrics: [], error: 'Ключ недействителен' }
    if (!res.ok) return { ...base, status: 'error', metrics: [], error: `HTTP ${res.status}` }
    const data = await res.json()
    const sub = (data.subscription ?? {}) as {
      character_count?: number
      character_limit?: number
      tier?: string
      next_character_count_reset_unix?: number
    }
    const used = sub.character_count ?? 0
    const limit = sub.character_limit ?? 0
    const pct = limit > 0 ? Math.round((used / limit) * 100) : 0
    const remaining = limit - used
    const status: Status = pct > 90 ? 'error' : pct > 70 ? 'warn' : 'ok'
    const resetDate = sub.next_character_count_reset_unix
      ? new Date(sub.next_character_count_reset_unix * 1000).toLocaleDateString('ru-RU')
      : '—'
    return {
      ...base, status,
      metrics: [
        { label: 'Символов использовано', value: `${used.toLocaleString('ru')} / ${limit.toLocaleString('ru')}` },
        { label: 'Осталось', value: `${remaining.toLocaleString('ru')} (${100 - pct}%)` },
        { label: 'Тариф', value: sub.tier ?? '—' },
        { label: 'Сброс счётчика', value: resetDate },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

async function checkFal(): Promise<ServiceResult> {
  const base = { key: 'fal', name: 'fal.ai (Flux / Изображения)', icon: '🎨', link: 'https://fal.ai/dashboard' }
  const apiKey = envVar('FAL_KEY')
  if (!apiKey) return unconfigured(base, 'FAL_KEY')
  // fal.ai doesn't expose a public balance REST endpoint — just confirm key is set
  return {
    ...base, status: 'ok',
    metrics: [
      { label: 'Статус', value: '✓ Ключ настроен' },
      { label: 'Баланс', value: '↗ Проверить на fal.ai' },
    ],
  }
}

async function checkResend(): Promise<ServiceResult> {
  const base = { key: 'resend', name: 'Resend (Email)', icon: '📧', link: 'https://resend.com/overview' }
  const apiKey = envVar('RESEND_API_KEY')
  if (!apiKey) return unconfigured(base, 'RESEND_API_KEY')
  try {
    const res = await safeFetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (res.status === 401 || res.status === 403) return { ...base, status: 'error', metrics: [], error: 'Ключ недействителен' }
    if (!res.ok) return { ...base, status: 'error', metrics: [], error: `HTTP ${res.status}` }
    const data = await res.json()
    const domainCount = Array.isArray(data.data) ? data.data.length : 0
    const domainName = Array.isArray(data.data) && data.data[0]?.name ? data.data[0].name as string : '—'
    return {
      ...base, status: 'ok',
      metrics: [
        { label: 'Ключ', value: '✓ Активен' },
        { label: 'Доменов', value: String(domainCount) },
        { label: 'Основной домен', value: domainName },
        { label: 'Лимит free', value: '3 000 писем/мес' },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

async function checkRailway(): Promise<ServiceResult> {
  const base = { key: 'railway', name: 'Railway (Video Server)', icon: '🎬', link: 'https://railway.app' }
  const railwayUrl = envVar('RAILWAY_VIDEO_SERVER_URL')
  if (!railwayUrl) return unconfigured(base, 'RAILWAY_VIDEO_SERVER_URL')
  const healthUrl = `${railwayUrl.replace(/\/$/, '')}/health`
  try {
    const start = Date.now()
    const res = await safeFetch(healthUrl, {}, 8000)
    const latency = Date.now() - start
    if (!res.ok) return {
      ...base, status: 'error',
      metrics: [{ label: 'Статус', value: `HTTP ${res.status}` }],
      error: 'Сервер вернул ошибку',
    }
    let health: { status?: string; uptime?: number } = {}
    try { health = await res.json() } catch { /* non-JSON health response */ }
    return {
      ...base, status: 'ok',
      metrics: [
        { label: 'Статус', value: health.status ? `✓ ${health.status}` : '✓ Online' },
        { label: 'Latency', value: `${latency} ms` },
        { label: 'Uptime', value: health.uptime ? formatUptime(health.uptime) : '—' },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return {
      ...base, status: 'error',
      metrics: [{ label: 'Статус', value: '✗ Недоступен' }],
      error: msg.includes('aborted') ? 'Таймаут (>8с)' : msg,
    }
  }
}

async function checkSupabase(): Promise<ServiceResult> {
  const supabaseUrl = envVar('NEXT_PUBLIC_SUPABASE_URL')
  const base = {
    key: 'supabase', name: 'Supabase (БД + Storage)', icon: '🗄️',
    link: supabaseUrl
      ? `https://supabase.com/dashboard/project/${supabaseUrl.split('.')[0].split('//')[1]}`
      : 'https://supabase.com',
  }
  const serviceKey = envVar('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey) return unconfigured(base, 'SUPABASE_SERVICE_ROLE_KEY')
  try {
    const supabase = createServiceClient()
    const buckets = ['audio', 'images', 'videos'] as const
    const stats: { bucket: string; count: number; sizeMB: number }[] = []
    for (const bucket of buckets) {
      const { data } = await supabase.storage.from(bucket).list('', { limit: 2000 })
      if (data) {
        const count = data.length
        const bytes = data.reduce((sum, f) => sum + (((f.metadata as Record<string, number> | null)?.size) ?? 0), 0)
        stats.push({ bucket, count, sizeMB: bytes / 1024 / 1024 })
      }
    }
    const totalMB = stats.reduce((s, b) => s + b.sizeMB, 0)
    const usedPct = Math.round((totalMB / 1024) * 100)
    const status: Status = usedPct > 80 ? 'error' : usedPct > 60 ? 'warn' : 'ok'
    return {
      ...base, status,
      metrics: [
        { label: 'Storage использовано', value: `${totalMB.toFixed(1)} MB / 1 024 MB` },
        ...stats.map(b => ({ label: `${b.bucket}`, value: `${b.count} файл${b.count === 1 ? '' : 'ов'} · ${b.sizeMB.toFixed(1)} MB` })),
      ],
    }
  } catch (err) {
    return { ...base, status: 'error', metrics: [], error: err instanceof Error ? err.message : 'Ошибка Supabase' }
  }
}

async function checkPaddle(): Promise<ServiceResult> {
  const base = { key: 'paddle', name: 'Paddle (Платежи)', icon: '💳', link: 'https://vendors.paddle.com' }
  const apiKey = envVar('PADDLE_API_KEY')
  if (!apiKey) return unconfigured(base, 'PADDLE_API_KEY')
  try {
    const [subsRes, txRes] = await Promise.all([
      safeFetch('https://api.paddle.com/subscriptions?status=active&per_page=1', {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      safeFetch(`https://api.paddle.com/transactions?status=completed&per_page=1`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    ])
    if (!subsRes.ok) return { ...base, status: 'error', metrics: [], error: `HTTP ${subsRes.status}` }
    const subsData = await subsRes.json()
    const activeSubs = (subsData.meta?.pagination?.estimated_total ?? 0) as number
    let totalRevenue = '—'
    if (txRes.ok) {
      const txData = await txRes.json()
      const total = (txData.meta?.pagination?.estimated_total ?? 0) as number
      totalRevenue = String(total)
    }
    return {
      ...base, status: 'ok',
      metrics: [
        { label: 'Активных подписок', value: String(activeSubs) },
        { label: 'Транзакций всего', value: totalRevenue },
        { label: 'Детали', value: '↗ Смотри на дашборде' },
      ],
    }
  } catch (err) {
    return { ...base, status: 'error', metrics: [], error: err instanceof Error ? err.message : 'Ошибка' }
  }
}

async function checkGitHub(): Promise<ServiceResult> {
  const base = {
    key: 'github', name: 'GitHub (Репозиторий)', icon: '📦',
    link: 'https://github.com/khudyshkind/youtubegen',
  }
  try {
    const res = await safeFetch(
      'https://api.github.com/repos/khudyshkind/youtubegen/commits?per_page=1',
      { headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'YouTubeGen-Admin/1.0' } }
    )
    if (res.status === 404) return {
      ...base, status: 'warn',
      metrics: [{ label: 'Статус', value: 'Репозиторий не найден или приватный' }],
    }
    if (!res.ok) return { ...base, status: 'warn', metrics: [], error: `HTTP ${res.status}` }
    const data = await res.json()
    const commit = Array.isArray(data) ? data[0] : null
    if (!commit) return { ...base, status: 'ok', metrics: [{ label: 'Коммитов', value: '0' }] }
    const rawDate = (commit.commit as { committer?: { date?: string }; author?: { date?: string } })?.committer?.date
      ?? (commit.commit as { author?: { date?: string } })?.author?.date
    const date = rawDate ? new Date(rawDate) : null
    const dateStr = date && !isNaN(date.getTime())
      ? date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—'
    const msg = ((commit.commit as { message?: string })?.message ?? '').split('\n')[0].slice(0, 55)
    const author = (commit.commit as { author?: { name?: string } })?.author?.name ?? '—'
    return {
      ...base, status: 'ok',
      metrics: [
        { label: 'Последний коммит', value: dateStr },
        { label: 'Автор', value: author },
        { label: 'Сообщение', value: msg || '—' },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

async function checkVercel(): Promise<ServiceResult> {
  const base = {
    key: 'vercel', name: 'Vercel (Деплой)', icon: '▲',
    link: 'https://vercel.com/you-tube-gen-s-projects/youtubegen',
  }
  const token = envVar('VERCEL_TOKEN')
  if (!token) return unconfigured(base, 'VERCEL_TOKEN')
  try {
    const res = await safeFetch(
      'https://api.vercel.com/v6/deployments?limit=3&target=production',
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) return { ...base, status: 'error', metrics: [], error: `HTTP ${res.status}` }
    const data = await res.json()
    const deployment = (data.deployments as Array<{
      state?: string; readyState?: string; createdAt?: number; url?: string; source?: string
    }>)?.[0]
    if (!deployment) return { ...base, status: 'ok', metrics: [{ label: 'Деплоев', value: '0' }] }
    const state = deployment.state ?? deployment.readyState ?? 'UNKNOWN'
    const labels: Record<string, string> = {
      READY: '✓ Готов', ERROR: '✗ Ошибка', BUILDING: '⟳ Сборка',
      QUEUED: '⟳ Очередь', CANCELED: '— Отменён',
    }
    const status: Status = state === 'READY' ? 'ok' : state === 'ERROR' ? 'error' : 'warn'
    const date = deployment.createdAt ? new Date(deployment.createdAt) : null
    const dateStr = date && !isNaN(date.getTime())
      ? date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—'
    return {
      ...base, status,
      metrics: [
        { label: 'Статус деплоя', value: labels[state] ?? state },
        { label: 'Дата', value: dateStr },
        { label: 'URL', value: deployment.url ? `https://${deployment.url}` : '—' },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

// ─── Route ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const results = await Promise.allSettled([
    checkAnthropic(),
    checkOpenAI(),
    checkElevenLabs(),
    checkFal(),
    checkResend(),
    checkRailway(),
    checkSupabase(),
    checkPaddle(),
    checkGitHub(),
    checkVercel(),
  ])

  const FALLBACKS: Pick<ServiceResult, 'key' | 'name' | 'icon' | 'link'>[] = [
    { key: 'anthropic',  name: 'Anthropic',    icon: '🤖', link: 'https://console.anthropic.com' },
    { key: 'openai',     name: 'OpenAI',        icon: '🎤', link: 'https://platform.openai.com' },
    { key: 'elevenlabs', name: 'ElevenLabs',    icon: '🔊', link: 'https://elevenlabs.io' },
    { key: 'fal',        name: 'fal.ai',        icon: '🎨', link: 'https://fal.ai' },
    { key: 'resend',     name: 'Resend',        icon: '📧', link: 'https://resend.com' },
    { key: 'railway',    name: 'Railway',       icon: '🎬', link: 'https://railway.app' },
    { key: 'supabase',   name: 'Supabase',      icon: '🗄️', link: 'https://supabase.com' },
    { key: 'paddle',     name: 'Paddle',        icon: '💳', link: 'https://vendors.paddle.com' },
    { key: 'github',     name: 'GitHub',        icon: '📦', link: 'https://github.com' },
    { key: 'vercel',     name: 'Vercel',        icon: '▲',  link: 'https://vercel.com' },
  ]

  const services: ServiceResult[] = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    return {
      ...FALLBACKS[i]!,
      status: 'error' as Status,
      metrics: [],
      error: r.reason instanceof Error ? r.reason.message : 'Unexpected error',
    }
  })

  const checkedAt = new Date().toISOString()
  return NextResponse.json({ ok: true, services, checkedAt })
}
