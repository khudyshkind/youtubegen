export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { env } from '@/lib/env'

const ADMIN_EMAILS = ['khudyshkin.d@gmail.com', 'denis-region@mail.ru']

async function fetchPaddleRevenue() {
  const apiKey = env('PADDLE_API_KEY')
  if (!apiKey) return { monthlyTotal: 0, currency: 'USD', txCount: 0, avgCheck: 0, activeSubs: 0, error: 'PADDLE_API_KEY not set' }

  const isProd = process.env.NODE_ENV === 'production'
  const base = isProd ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com'
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('.')[0] + 'Z'

  try {
    const [txRes, subRes] = await Promise.all([
      fetch(`${base}/transactions?status=billed&billed_at[gte]=${monthStart}&per_page=200`, {
        headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store',
      }),
      fetch(`${base}/subscriptions?status=active&per_page=200`, {
        headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store',
      }),
    ])
    const txJson  = txRes.ok  ? await txRes.json()  : { data: [] }
    const subJson = subRes.ok ? await subRes.json() : { data: [] }

    let total = 0, currency = 'USD'
    for (const tx of txJson.data ?? []) {
      const cents = parseInt(tx.details?.totals?.grand_total ?? '0', 10)
      if (!isNaN(cents)) total += cents
      if (tx.currency_code) currency = tx.currency_code
    }
    const activeSubs = (subJson.data ?? []).length
    const txCount = txJson.data?.length ?? 0
    const monthlyTotal = total / 100
    return { monthlyTotal, currency, txCount, avgCheck: txCount > 0 ? monthlyTotal / txCount : 0, activeSubs }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[api/admin/dashboard] Paddle error:', msg)
    return { monthlyTotal: 0, currency: 'USD', txCount: 0, avgCheck: 0, activeSubs: 0, error: msg }
  }
}

export async function GET() {
  // Auth: only admins
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email || !ADMIN_EMAILS.includes(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Diagnostics
  const cleanSvcKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const svcKeyPresent = cleanSvcKey.length > 0
  console.log('[api/admin/dashboard] service key present:', svcKeyPresent)
  console.log('[api/admin/dashboard] service key length:', cleanSvcKey.length)
  console.log('[api/admin/dashboard] service key prefix:', cleanSvcKey.slice(0, 4))
  console.log('[api/admin/dashboard] supabase url:', env('NEXT_PUBLIC_SUPABASE_URL').slice(0, 30))

  const svc = createServiceClient()

  // Test query to verify service client works
  const { data: testData, error: testError } = await svc.from('profiles').select('id').limit(1)
  console.log('[api/admin/dashboard] svc test — data:', JSON.stringify(testData), '| error:', JSON.stringify(testError))

  const now = new Date()
  const todayIso  = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const weekIso   = new Date(Date.now() - 7 * 86400_000).toISOString()
  const thirtyIso = new Date(Date.now() - 30 * 86400_000).toISOString()

  const [
    usersRes, todayRes, weekRes, projectsRes, completedRes,
    recentRegsRes, opsRes, allProfilesRes, allProjectsRes, paddle,
  ] = await Promise.all([
    svc.from('profiles').select('*', { count: 'exact', head: true }),
    svc.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', todayIso),
    svc.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', weekIso),
    svc.from('projects').select('*', { count: 'exact', head: true }),
    svc.from('projects').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
    svc.from('profiles').select('created_at').gte('created_at', thirtyIso).order('created_at'),
    svc.from('credit_transactions').select('operation').gte('created_at', thirtyIso),
    svc.from('profiles').select('id, email, full_name, plan, credits').limit(500),
    svc.from('projects').select('user_id').limit(2000),
    fetchPaddleRevenue(),
  ])

  console.log('[api/admin/dashboard] users count:', usersRes.count, '| error:', usersRes.error?.message)
  console.log('[api/admin/dashboard] projects count:', projectsRes.count, '| error:', projectsRes.error?.message)

  // Registrations chart last 30 days
  const regByDay: Record<string, number> = {}
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000)
    regByDay[d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })] = 0
  }
  for (const r of recentRegsRes.data ?? []) {
    const key = new Date(r.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
    if (key in regByDay) regByDay[key] = (regByDay[key] ?? 0) + 1
  }

  // Operations chart
  const opCounts: Record<string, number> = {}
  for (const t of opsRes.data ?? []) opCounts[t.operation] = (opCounts[t.operation] ?? 0) + 1
  const opEntries = Object.entries(opCounts).sort(([, a], [, b]) => b - a)

  // Top 5 users by project count
  const pcMap: Record<string, number> = {}
  for (const p of allProjectsRes.data ?? []) pcMap[p.user_id] = (pcMap[p.user_id] ?? 0) + 1
  const profileMap = Object.fromEntries((allProfilesRes.data ?? []).map((p) => [p.id, p]))
  const topUsers = Object.entries(pcMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([id, count]) => ({ ...(profileMap[id] ?? { id, email: '—', full_name: null, plan: 'free', credits: 0 }), id, projectCount: count }))

  return NextResponse.json({
    totalUsers:     usersRes.count     ?? 0,
    newToday:       todayRes.count     ?? 0,
    newWeek:        weekRes.count      ?? 0,
    totalProjects:  projectsRes.count  ?? 0,
    completedVideos: completedRes.count ?? 0,
    regDays: Object.entries(regByDay),
    opEntries,
    topUsers,
    paddle,
    svcKeyPresent,
    svcKeyLength: cleanSvcKey.length,
    svcKeyPrefix: cleanSvcKey.slice(0, 4),
    hasQueryError: !!(usersRes.error || projectsRes.error),
    queryError: usersRes.error?.message ?? projectsRes.error?.message,
  })
}
