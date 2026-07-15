import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { env } from '@/lib/env'

export const maxDuration = 30

// ─── Types ─────────────────────────────────────────────────────────────────────

type Status = 'ok' | 'warn' | 'error' | 'unconfigured'

interface Metric {
  label: string
  value: string
  url?: string
}

export interface ServiceResult {
  key: string
  name: string
  icon: string
  link: string
  status: Status
  statusLabel?: string
  metrics: Metric[]
  error?: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

// NOTE: /v1/models returns 200 even when credit balance is zero — this check cannot detect billing exhaustion.
// Real billing errors surface only at inference time and are handled via notifyBillingError() in route catch blocks.
async function checkAnthropic(): Promise<ServiceResult> {
  const base = { key: 'anthropic', name: 'Anthropic (Claude)', icon: '🤖', link: 'https://console.anthropic.com' }
  const apiKey = env('ANTHROPIC_API_KEY')
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
        { label: 'Биллинг', value: '↗ Console Billing', url: 'https://console.anthropic.com/settings/billing' },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

async function checkOpenAI(): Promise<ServiceResult> {
  const base = { key: 'openai', name: 'OpenAI (Whisper)', icon: '🎤', link: 'https://platform.openai.com/usage' }
  const apiKey = env('OPENAI_API_KEY')
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
        { label: 'Использование', value: '↗ Platform Usage', url: 'https://platform.openai.com/usage' },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

async function checkElevenLabs(): Promise<ServiceResult> {
  const base = { key: 'elevenlabs', name: 'ElevenLabs (TTS)', icon: '🔊', link: 'https://elevenlabs.io/app/subscription' }
  const apiKey = env('ELEVENLABS_API_KEY')
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
    const remainingPct = 100 - pct
    // 'error' only from API failures (401/catch branches). Resource depletion = warn.
    const status: Status = remainingPct < 30 ? 'warn' : 'ok'
    const statusLabel = remainingPct < 10 ? 'Баланс на исходе' : remainingPct < 30 ? 'Баланс низкий' : undefined
    const resetDate = sub.next_character_count_reset_unix
      ? new Date(sub.next_character_count_reset_unix * 1000).toLocaleDateString('ru-RU')
      : '—'
    return {
      ...base, status, ...(statusLabel ? { statusLabel } : {}),
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
  const adminKey  = process.env.FAL_ADMIN_KEY ?? process.env.FAL_KEY ?? ''
  const threshold = parseFloat(process.env.FAL_BALANCE_ALERT_THRESHOLD ?? '10')

  if (!adminKey) return unconfigured(base, 'FAL_KEY')

  // Try live billing call (requires FAL_ADMIN_KEY; FAL_KEY returns 401)
  let liveBalance: number | null = null
  let liveCurrency = 'USD'
  let unauthorized = false
  try {
    const res = await safeFetch(
      'https://api.fal.ai/v1/account/billing?expand=credits',
      { headers: { Authorization: `Key ${adminKey}` } },
      10_000,
    )
    if (res.status === 401 || res.status === 403) {
      unauthorized = true
    } else if (res.ok) {
      const data = await res.json() as { credits?: { current_balance?: number; currency?: string } }
      const b = data?.credits?.current_balance
      if (typeof b === 'number') { liveBalance = b; liveCurrency = data?.credits?.currency ?? 'USD' }
    }
  } catch { /* timeout / network — fall through to cached */ }

  // Fallback: read balance cached by Railway cron (written to bot_settings every 30 min)
  let cachedBalance: number | null = null
  let cachedTs: string | null = null
  let cachedCurrency = 'USD'
  if (liveBalance === null) {
    try {
      const svc = createServiceClient()
      const { data } = await svc
        .from('bot_settings')
        .select('key, value')
        .in('key', ['fal_balance', 'fal_balance_ts', 'fal_balance_currency'])
      const s = Object.fromEntries((data ?? []).map(r => [r.key as string, r.value as string]))
      if (s['fal_balance'])          cachedBalance   = parseFloat(s['fal_balance'])
      if (s['fal_balance_ts'])       cachedTs        = s['fal_balance_ts']
      if (s['fal_balance_currency']) cachedCurrency  = s['fal_balance_currency']
    } catch { /* ignore — show what we have */ }
  }

  const balance  = liveBalance  ?? cachedBalance
  const currency = liveBalance !== null ? liveCurrency : cachedCurrency
  const fromCache = liveBalance === null && cachedBalance !== null

  if (unauthorized && balance === null) {
    return {
      ...base, status: 'warn', statusLabel: 'Нужен admin-ключ',
      metrics: [
        { label: 'Статус', value: '⚠ FAL_ADMIN_KEY не задан — баланс недоступен' },
        { label: 'Биллинг', value: '↗ fal.ai Billing', url: 'https://fal.ai/dashboard/billing' },
      ],
    }
  }

  if (balance === null) {
    return { ...base, status: 'error', metrics: [], error: 'Не удалось получить баланс' }
  }

  const status: Status      = balance < threshold ? 'warn' : 'ok'
  const statusLabel         = balance < threshold ? 'Баланс на исходе' : undefined
  const cacheNote           = fromCache && cachedTs
    ? ` (кэш ${new Date(cachedTs).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })})`
    : ''

  return {
    ...base,
    status,
    ...(statusLabel ? { statusLabel } : {}),
    metrics: [
      { label: 'Баланс', value: `$${balance.toFixed(2)} ${currency}${cacheNote}` },
      { label: 'Порог алерта', value: `$${threshold.toFixed(2)}` },
      { label: 'Биллинг', value: '↗ fal.ai Billing', url: 'https://fal.ai/dashboard/billing' },
    ],
  }
}

async function checkResend(): Promise<ServiceResult> {
  const base = { key: 'resend', name: 'Resend (Email)', icon: '📧', link: 'https://resend.com/overview' }
  const apiKey = env('RESEND_API_KEY')
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
        { label: 'Биллинг', value: '↗ Resend Settings', url: 'https://resend.com/settings/billing' },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

async function checkRailway(): Promise<ServiceResult> {
  const base = { key: 'railway', name: 'Railway (Video Server)', icon: '🎬', link: 'https://railway.app' }
  const railwayUrl = env('RAILWAY_VIDEO_SERVER_URL')
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
  const supabaseUrl = env('NEXT_PUBLIC_SUPABASE_URL')
  const base = {
    key: 'supabase', name: 'Supabase (БД + Storage)', icon: '🗄️',
    link: supabaseUrl
      ? `https://supabase.com/dashboard/project/${supabaseUrl.split('.')[0].split('//')[1]}`
      : 'https://supabase.com',
  }
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey) return unconfigured(base, 'SUPABASE_SERVICE_ROLE_KEY')
  try {
    const supabase = createServiceClient()

    // DB row counts (HEAD request — no data transferred)
    let profileCount: number | null = null
    let projectCount: number | null = null
    try {
      const [profRes, projRes] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('projects').select('*', { count: 'exact', head: true }),
      ])
      profileCount = profRes.count
      projectCount = projRes.count
    } catch { /* swallow — storage still shown */ }

    // Storage
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
    // >90% = error: storage won't accept new writes → service breaks (unlike TTS quota, this doesn't reset).
    // >60% = warn: still working, but trending toward full.
    const status: Status = usedPct > 90 ? 'error' : usedPct > 60 ? 'warn' : 'ok'
    const statusLabel = usedPct > 90 ? 'Хранилище почти заполнено' : usedPct > 60 ? 'Хранилище заполняется' : undefined
    return {
      ...base, status, ...(statusLabel ? { statusLabel } : {}),
      metrics: [
        ...(profileCount !== null ? [{ label: 'Пользователей (DB)', value: profileCount.toLocaleString('ru') }] : []),
        ...(projectCount !== null ? [{ label: 'Проектов (DB)', value: projectCount.toLocaleString('ru') }] : []),
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
  const apiKey = env('PADDLE_API_KEY')
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
      { headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Lefiro-Admin/1.0' } }
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

async function checkYouTubeAPI(): Promise<ServiceResult> {
  const base = {
    key: 'youtube_api',
    name: 'YouTube Data API v3',
    icon: '▶️',
    link: 'https://console.cloud.google.com/apis/api/youtube.googleapis.com',
  }
  const apiKey = env('YOUTUBE_API_KEY')
  if (!apiKey) return unconfigured(base, 'YOUTUBE_API_KEY')
  try {
    // i18nLanguages costs 1 quota unit — cheapest valid call
    const res = await safeFetch(
      `https://www.googleapis.com/youtube/v3/i18nLanguages?part=snippet&key=${apiKey}`
    )
    if (res.status === 403) {
      const data = await res.json().catch(() => ({})) as { error?: { message?: string } }
      return { ...base, status: 'error', metrics: [], error: data.error?.message ?? 'Доступ запрещён' }
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: { message?: string } }
      return { ...base, status: 'error', metrics: [], error: data.error?.message ?? `HTTP ${res.status}` }
    }
    return {
      ...base, status: 'ok',
      metrics: [
        { label: 'Статус', value: '✓ Ключ активен' },
        { label: 'Дневная квота', value: '10 000 единиц (по умолчанию)' },
        { label: 'Квоты', value: '↗ API Quotas', url: 'https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas' },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

async function checkApihost(): Promise<ServiceResult> {
  const base = {
    key: 'apihost',
    name: 'APIHOST.RU (TTS)',
    icon: '🎙️',
    link: 'https://apihost.ru',
  }
  const apiKey = env('APIHOST_API_KEY')
  if (!apiKey) return unconfigured(base, 'APIHOST_API_KEY')
  try {
    const res = await safeFetch('https://apihost.ru/api/v1/balance', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (res.status === 401 || res.status === 403) {
      return { ...base, status: 'error', metrics: [], error: 'Ключ недействителен' }
    }
    if (!res.ok) {
      // Balance endpoint unavailable — key is set, show as ok
      return {
        ...base, status: 'ok',
        metrics: [
          { label: 'Статус', value: '✓ Ключ настроен' },
          { label: 'Баланс', value: '↗ apihost.ru', url: 'https://apihost.ru' },
        ],
      }
    }
    const data = await res.json() as Record<string, unknown>
    const balance = (data.balance ?? data.amount ?? data.rub ?? null) as number | null
    const balanceStr = balance !== null ? `${Number(balance).toLocaleString('ru-RU')} ₽` : '—'
    const status: Status = balance !== null && balance < 50 ? 'warn' : 'ok'
    return {
      ...base, status,
      metrics: [
        { label: 'Статус', value: '✓ Ключ активен' },
        { label: 'Баланс', value: balanceStr },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

async function checkGoogleCloud(): Promise<ServiceResult> {
  const base = {
    key: 'google_cloud',
    name: 'Google Cloud (TTS)',
    icon: '☁️',
    link: 'https://console.cloud.google.com',
  }
  const apiKey = env('GOOGLE_TTS_API_KEY')
  if (!apiKey) return unconfigured(base, 'GOOGLE_TTS_API_KEY')
  try {
    const res = await safeFetch(
      `https://texttospeech.googleapis.com/v1/voices?key=${apiKey}&languageCode=ru-RU`
    )
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const data = await res.json().catch(() => ({})) as { error?: { message?: string } }
      return { ...base, status: 'error', metrics: [], error: data.error?.message ?? 'Ключ недействителен' }
    }
    if (!res.ok) return { ...base, status: 'error', metrics: [], error: `HTTP ${res.status}` }
    const data = await res.json() as { voices?: unknown[] }
    const voiceCount = Array.isArray(data.voices) ? data.voices.length : 0
    const youtubeConfigured = !!env('YOUTUBE_API_KEY')
    return {
      ...base, status: 'ok',
      metrics: [
        { label: 'Cloud TTS API', value: '✓ Активен' },
        { label: 'Голосов (ru-RU)', value: String(voiceCount) },
        { label: 'YouTube API', value: youtubeConfigured ? '✓ Настроен' : '⚠ Не задан' },
        { label: 'GCP Billing', value: '↗ Cloud Console', url: 'https://console.cloud.google.com/billing' },
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
  const token = env('VERCEL_TOKEN')
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
        { label: 'Деплой', value: deployment.url ? '↗ Preview URL' : '—', ...(deployment.url ? { url: `https://${deployment.url}` } : {}) },
        { label: 'Биллинг', value: '↗ Team Billing', url: 'https://vercel.com/you-tube-gen-s-projects/settings/billing' },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

async function checkBackup(): Promise<ServiceResult> {
  const base = {
    key: 'db_backup',
    name: 'Бэкап БД',
    icon: '💾',
    link: 'https://railway.app',
  }
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('bot_settings')
      .select('key, value')
      .in('key', ['last_backup_at', 'last_backup_status', 'last_backup_size_mb', 'last_backup_attempt_at', 'last_backup_error'])
    if (error) throw new Error(error.message)

    const s = Object.fromEntries((data ?? []).map(r => [r.key as string, r.value as string]))
    const lastSuccessAt = s['last_backup_at']        ?? null
    const backupStatus  = s['last_backup_status']     ?? null
    const sizeMb        = s['last_backup_size_mb']    ?? null
    const attemptAt     = s['last_backup_attempt_at'] ?? null
    const backupError   = s['last_backup_error']      ?? null

    if (!lastSuccessAt && !backupStatus) {
      return {
        ...base, status: 'warn',
        metrics: [{ label: 'Статус', value: '— Нет данных' }],
        error: 'Бэкап ещё не запускался или данные ещё не записаны',
      }
    }

    const successAgeH = lastSuccessAt
      ? (Date.now() - new Date(lastSuccessAt).getTime()) / 3_600_000
      : Infinity
    const isFailed = backupStatus === 'failed'

    const status: Status = !lastSuccessAt || isFailed || successAgeH > 49
      ? 'error'
      : successAgeH > 25
      ? 'warn'
      : 'ok'

    const metrics: Metric[] = []

    if (lastSuccessAt) {
      const dateStr = new Date(lastSuccessAt).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
      })
      const agoH = Math.round(successAgeH)
      metrics.push({ label: 'Последний успешный', value: `${dateStr} (${agoH}ч назад)` })
      if (sizeMb) metrics.push({ label: 'Размер', value: `${sizeMb} MB` })
    }

    if (isFailed) {
      const attemptStr = attemptAt
        ? new Date(attemptAt).toLocaleString('ru-RU', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit',
          })
        : '—'
      metrics.push({ label: 'Последняя попытка', value: `${attemptStr} — ✗ Ошибка` })
    } else if (backupStatus === 'success') {
      metrics.push({ label: 'Статус', value: '✓ Успешен' })
    }

    return {
      ...base, status, metrics,
      ...(isFailed && backupError ? { error: backupError } : {}),
    }
  } catch (err) {
    return {
      ...base, status: 'error', metrics: [],
      error: err instanceof Error ? err.message : 'Ошибка чтения Supabase',
    }
  }
}

// ─── Railway stats (shared between checkB2 + checkVGF — single network call) ───

interface RailwayStats {
  b2Media?:  { files?: number; sizeMb?: number; truncated?: boolean; error?: string }
  b2Backup?: { files?: number; lastBackupDate?: string | null; error?: string }
  vgf?:      { keySet: boolean; status: string; statusNote?: string }
}

async function fetchRailwayStats(): Promise<RailwayStats | null> {
  const url    = env('RAILWAY_VIDEO_SERVER_URL')
  const secret = env('RAILWAY_API_SECRET')
  if (!url || !secret) return null
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/admin/stats`, {
      headers: { 'x-api-secret': secret },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) return null
    return await res.json() as RailwayStats
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

// ─── New service checks ────────────────────────────────────────────────────────

async function checkSecretVoicer(): Promise<ServiceResult> {
  const base = { key: 'secretvoicer', name: 'SecretVoicer (TTS)', icon: '🗣️', link: 'https://secret-voicer.ru' }
  const apiKey = env('SECRETVOICER_API_KEY')
  if (!apiKey) return unconfigured(base, 'SECRETVOICER_API_KEY')
  try {
    const res = await safeFetch('https://secret-voicer.ru/api/v1/voices', {
      headers: { 'X-API-Key': apiKey },
    })
    if (res.status === 401 || res.status === 403) {
      return { ...base, status: 'error', metrics: [], error: 'Ключ недействителен' }
    }
    if (res.ok) {
      const raw = await res.json().catch(() => null) as unknown
      const apiCount = Array.isArray(raw) ? raw.length
        : (Array.isArray((raw as Record<string, unknown> | null)?.voices)
          ? ((raw as { voices: unknown[] }).voices.length) : null)
      return {
        ...base, status: 'ok',
        metrics: [
          { label: 'Статус', value: '✓ Ключ активен' },
          { label: 'Голосов (API)', value: apiCount !== null ? String(apiCount) : '—' },
          { label: 'Голосов (каталог)', value: '102' },
          { label: 'Движок', value: 'ElevenLabs-based (async)' },
          { label: 'Сайт', value: '↗ secret-voicer.ru', url: 'https://secret-voicer.ru' },
        ],
      }
    }
    // Non-2xx, non-401/403: endpoint unexpected response
    return {
      ...base, status: 'warn',
      metrics: [
        { label: 'Статус', value: `✓ Ключ настроен · API HTTP ${res.status}` },
        { label: 'Голосов (каталог)', value: '102' },
        { label: 'Сайт', value: '↗ secret-voicer.ru', url: 'https://secret-voicer.ru' },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

async function checkVoicer(): Promise<ServiceResult> {
  const base = { key: 'voicer', name: 'Voicer (Премиум TTS)', icon: '🔉', link: 'https://voicer.mat3u.com' }
  const apiKey = env('VOICER_API_KEY')
  if (!apiKey) return unconfigured(base, 'VOICER_API_KEY')
  try {
    // /api/v1/voices doesn't exist (404); probe /api/v1/voice/status/<fake> instead:
    // 401 = invalid token, 403 = no auth, 404/422 = key valid (task not found)
    const res = await safeFetch('https://voicer.mat3u.com/api/v1/voice/status/probe-fake-id', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (res.status === 401 || res.status === 403) {
      return { ...base, status: 'error', metrics: [], error: 'Ключ недействителен' }
    }
    return {
      ...base, status: 'ok',
      metrics: [
        { label: 'Статус', value: '✓ Ключ активен' },
        { label: 'Движок', value: 'ElevenLabs (реселлер)' },
        { label: 'Сайт', value: '↗ voicer.mat3u.com', url: 'https://voicer.mat3u.com' },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

async function checkGemini(): Promise<ServiceResult> {
  const base = { key: 'gemini', name: 'Gemini (Превью)', icon: '✨', link: 'https://aistudio.google.com' }
  const apiKey = env('GEMINI_API_KEY')
  if (!apiKey) return unconfigured(base, 'GEMINI_API_KEY')
  try {
    const res = await safeFetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const data = await res.json().catch(() => ({})) as { error?: { message?: string } }
      return { ...base, status: 'error', metrics: [], error: data.error?.message ?? 'Ключ недействителен' }
    }
    if (!res.ok) return { ...base, status: 'error', metrics: [], error: `HTTP ${res.status}` }
    const data = await res.json() as { models?: Array<{ name: string; displayName?: string }> }
    const models = Array.isArray(data.models) ? data.models : []
    const geminiModels = models.filter(m => m.name.toLowerCase().includes('gemini'))
    const imageModel   = geminiModels.find(m => /image|pro-image/.test(m.name.toLowerCase()))
    return {
      ...base, status: 'ok',
      metrics: [
        { label: 'Статус', value: '✓ Ключ активен' },
        { label: 'Gemini моделей', value: String(geminiModels.length) },
        { label: 'Картинки', value: imageModel
          ? `✓ ${imageModel.displayName ?? imageModel.name.split('/').pop() ?? imageModel.name}`
          : '— нет image-модели' },
        { label: 'Квота', value: '↗ AI Studio', url: 'https://aistudio.google.com/' },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    return { ...base, status: 'error', metrics: [], error: msg.includes('aborted') ? 'Таймаут' : msg }
  }
}

async function checkB2(statsP: Promise<RailwayStats | null>): Promise<ServiceResult> {
  const base = { key: 'b2', name: 'Backblaze B2 (Видео)', icon: '💿', link: 'https://secure.backblaze.com/b2_buckets.htm' }
  if (!env('RAILWAY_VIDEO_SERVER_URL')) return unconfigured(base, 'RAILWAY_VIDEO_SERVER_URL')
  try {
    const data = await statsP
    if (!data) return { ...base, status: 'error', metrics: [], error: 'Railway /admin/stats недоступен' }

    const metrics: Metric[] = []

    const bm = data.b2Media
    if (bm?.error) {
      metrics.push({ label: 'Медиа', value: `✗ ${bm.error.slice(0, 60)}` })
    } else if (bm) {
      const countStr = `${bm.files ?? 0}${bm.truncated ? '+' : ''}`
      metrics.push({ label: 'Медиа-файлов', value: `${countStr} · ${bm.sizeMb?.toFixed(1) ?? '?'} MB` })
    }

    const bb = data.b2Backup
    if (bb?.error) {
      metrics.push({ label: 'Бэкапы', value: `✗ ${bb.error.slice(0, 60)}` })
    } else if (bb) {
      metrics.push({ label: 'Бэкапов в хранилище', value: String(bb.files ?? 0) })
      metrics.push({ label: 'Дата последнего', value: bb.lastBackupDate ?? '—' })
    }

    const status: Status = (bm?.error && bb?.error) ? 'error' : 'ok'
    return { ...base, status, metrics }
  } catch (err) {
    return { ...base, status: 'error', metrics: [], error: err instanceof Error ? err.message : 'Ошибка' }
  }
}

async function checkVGF(statsP: Promise<RailwayStats | null>): Promise<ServiceResult> {
  const base = { key: 'vgf', name: 'VGF (Рендер видео)', icon: '🎞️', link: 'https://verygoodffmpeg.com' }
  if (!env('RAILWAY_VIDEO_SERVER_URL')) return unconfigured(base, 'RAILWAY_VIDEO_SERVER_URL')
  try {
    const data = await statsP
    if (!data) return { ...base, status: 'error', metrics: [], error: 'Railway /admin/stats недоступен' }

    const vgf = data.vgf
    if (!vgf?.keySet) return unconfigured(base, 'VGF_API_KEY')

    const status: Status = vgf.status === 'ok' ? 'ok' : vgf.status === 'error' ? 'error' : 'warn'
    return {
      ...base, status,
      metrics: [
        { label: 'Ключ',   value: '✓ Настроен (Railway)' },
        { label: 'API',    value: vgf.statusNote ?? '—' },
        { label: 'Рендер', value: 'verygoodffmpeg.com (Cloud FFmpeg)' },
        { label: 'Панель', value: '↗ VGF Dashboard', url: 'https://verygoodffmpeg.com' },
      ],
    }
  } catch (err) {
    return { ...base, status: 'error', metrics: [], error: err instanceof Error ? err.message : 'Ошибка' }
  }
}

// ─── Route ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const railwayStats = fetchRailwayStats()  // single shared call for checkB2 + checkVGF

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
    checkYouTubeAPI(),
    checkApihost(),
    checkGoogleCloud(),
    checkBackup(),
    checkSecretVoicer(),
    checkVoicer(),
    checkGemini(),
    checkB2(railwayStats),
    checkVGF(railwayStats),
  ])

  const FALLBACKS: Pick<ServiceResult, 'key' | 'name' | 'icon' | 'link'>[] = [
    { key: 'anthropic',    name: 'Anthropic',          icon: '🤖', link: 'https://console.anthropic.com' },
    { key: 'openai',       name: 'OpenAI',             icon: '🎤', link: 'https://platform.openai.com' },
    { key: 'elevenlabs',   name: 'ElevenLabs',         icon: '🔊', link: 'https://elevenlabs.io' },
    { key: 'fal',          name: 'fal.ai',             icon: '🎨', link: 'https://fal.ai' },
    { key: 'resend',       name: 'Resend',             icon: '📧', link: 'https://resend.com' },
    { key: 'railway',      name: 'Railway',            icon: '🎬', link: 'https://railway.app' },
    { key: 'supabase',     name: 'Supabase',           icon: '🗄️', link: 'https://supabase.com' },
    { key: 'paddle',       name: 'Paddle',             icon: '💳', link: 'https://vendors.paddle.com' },
    { key: 'github',       name: 'GitHub',             icon: '📦', link: 'https://github.com' },
    { key: 'vercel',       name: 'Vercel',             icon: '▲',  link: 'https://vercel.com' },
    { key: 'youtube_api',  name: 'YouTube Data API v3',icon: '▶️', link: 'https://console.cloud.google.com/apis/api/youtube.googleapis.com' },
    { key: 'apihost',      name: 'APIHOST.RU (TTS)',   icon: '🎙️', link: 'https://apihost.ru' },
    { key: 'google_cloud', name: 'Google Cloud (TTS)', icon: '☁️', link: 'https://console.cloud.google.com' },
    { key: 'db_backup',    name: 'Бэкап БД',          icon: '💾', link: 'https://railway.app' },
    { key: 'secretvoicer', name: 'SecretVoicer (TTS)', icon: '🗣️', link: 'https://secret-voicer.ru' },
    { key: 'voicer',       name: 'Voicer (Премиум TTS)',icon: '🔉', link: 'https://voicer.mat3u.com' },
    { key: 'gemini',       name: 'Gemini (Превью)',    icon: '✨', link: 'https://aistudio.google.com' },
    { key: 'b2',           name: 'Backblaze B2 (Видео)',icon: '💿', link: 'https://secure.backblaze.com/b2_buckets.htm' },
    { key: 'vgf',          name: 'VGF (Рендер видео)', icon: '🎞️', link: 'https://verygoodffmpeg.com' },
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
