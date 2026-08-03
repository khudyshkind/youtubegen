export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createServerSupabase, createServiceClient } from '@/lib/supabase-server'
import { env } from '@/lib/env'
import UsersTable from '@/components/admin/UsersTable'

const ADMIN_EMAILS = ['khudyshkin.d@gmail.com', 'denis-region@mail.ru']

interface Props {
  searchParams: Promise<{ q?: string; plan?: string }>
}

// ─── Paddle subscription lookup by customer_id ────────────────────────────────

interface PaddleSubInfo {
  status: string
  nextBilledAt: string | null
  totalSpent: number
  currency: string
}

async function fetchPaddleSubscriptions(): Promise<Map<string, PaddleSubInfo>> {
  const apiKey = env('PADDLE_API_KEY')
  const map = new Map<string, PaddleSubInfo>()
  if (!apiKey) return map

  const isProd = process.env.NODE_ENV === 'production'
  const base = isProd ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com'

  try {
    const [subRes, txRes] = await Promise.all([
      fetch(`${base}/subscriptions?per_page=200`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
      }),
      fetch(`${base}/transactions?status=billed&per_page=200`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
      }),
    ])

    const subJson = subRes.ok ? await subRes.json() : { data: [] }
    const txJson  = txRes.ok  ? await txRes.json()  : { data: [] }

    // Sum total spent per customer
    const spentByCustomer: Record<string, number> = {}
    for (const tx of txJson.data ?? []) {
      if (tx.customer_id && tx.details?.totals?.grand_total) {
        spentByCustomer[tx.customer_id] = (spentByCustomer[tx.customer_id] ?? 0) +
          parseInt(tx.details.totals.grand_total, 10)
      }
    }

    for (const sub of subJson.data ?? []) {
      map.set(sub.customer_id, {
        status: sub.status ?? 'unknown',
        nextBilledAt: sub.next_billed_at ?? null,
        totalSpent: (spentByCustomer[sub.customer_id] ?? 0) / 100,
        currency: sub.currency_code ?? 'USD',
      })
    }
  } catch (err) {
    console.error('[admin/users] Paddle fetch error:', err)
  }

  return map
}

// ─── data fetching ────────────────────────────────────────────────────────────

async function UsersList({ q, plan }: { q: string; plan: string }) {
  const svc = createServiceClient()

  // select('*') avoids hard-coding column names that may not exist after partial migrations
  let query = svc
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (q)    query = query.ilike('email', `%${q}%`)
  if (plan) query = query.eq('plan', plan)

  const { data: profiles, error: profilesError } = await query
  console.log('[admin/users] profiles count:', profiles?.length, '| error:', profilesError?.message)

  const { data: projects, error: projectsError } = await svc.from('projects').select('user_id')
  console.log('[admin/users] projects count:', projects?.length, '| error:', projectsError?.message)

  // Project counts per user
  const pcMap: Record<string, number> = {}
  for (const p of projects ?? []) pcMap[p.user_id] = (pcMap[p.user_id] ?? 0) + 1

  // Paddle subscription info (customer_id → sub info)
  const paddleSubs = await fetchPaddleSubscriptions()

  const users = (profiles ?? []).map((p) => {
    const paddleInfo = p.paddle_customer_id ? paddleSubs.get(p.paddle_customer_id) : undefined
    // signup_* and utm_* columns exist after migration 012; cast required until types are regenerated.
    const pEx = p as typeof p & {
      signup_ip?: string | null
      signup_country?: string | null
      signup_city?: string | null
      utm_source?: string | null
    }
    return {
      ...p,
      plan_expires_at:    (p.plan_expires_at as string | null) ?? null,
      projectCount:        pcMap[p.id] ?? 0,
      lastActivity:        null as string | null,
      subscriptionStatus:  paddleInfo?.status ?? null,
      nextBilledAt:        paddleInfo?.nextBilledAt ?? null,
      totalSpent:          paddleInfo?.totalSpent ?? 0,
      spentCurrency:       paddleInfo?.currency ?? 'USD',
      signup_ip:           pEx.signup_ip      ?? null,
      signup_country:      pEx.signup_country ?? null,
      signup_city:         pEx.signup_city    ?? null,
      utm_source:          pEx.utm_source     ?? null,
    }
  })

  const hasServiceKey = !!(env('SUPABASE_SERVICE_ROLE_KEY'))

  return (
    <UsersTable
      users={users}
      total={users.length}
      hasServiceKey={hasServiceKey}
      queryError={profilesError?.message}
    />
  )
}

// ─── duplicate IP detection ────────────────────────────────────────────────────
// Equivalent SQL (run in Supabase SQL Editor for full dataset):
//   SELECT signup_ip, COUNT(*) AS account_count,
//     array_agg(LEFT(split_part(email,'@',1),2)||'***@'||split_part(email,'@',2)) AS emails,
//     MIN(created_at) AS first_reg, MAX(created_at) AS last_reg
//   FROM public.profiles
//   WHERE signup_ip IS NOT NULL
//   GROUP BY signup_ip
//   HAVING COUNT(*) > 1
//   ORDER BY account_count DESC;

function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at < 0) return email
  return email.slice(0, 2) + '***' + email.slice(at)
}

function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

interface IpGroup {
  ip: string
  count: number
  emails: string[]
  countries: string[]
  firstReg: string
  lastReg: string
}

async function DuplicateIPs() {
  const svc = createServiceClient()

  const { data, error } = await svc
    .from('profiles')
    .select('id, email, plan, signup_ip, signup_country, signup_city, created_at')
    .not('signup_ip', 'is', null)
    .order('created_at', { ascending: true })

  if (error) {
    return (
      <p className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
        Ошибка загрузки IP-данных: {error.message}
      </p>
    )
  }

  const byIp = new Map<string, typeof data>()
  for (const p of data ?? []) {
    if (!p.signup_ip) continue
    const g = byIp.get(p.signup_ip) ?? []
    g.push(p)
    byIp.set(p.signup_ip, g)
  }

  const groups: IpGroup[] = [...byIp.entries()]
    .filter(([, users]) => users.length > 1)
    .map(([ip, users]) => ({
      ip,
      count: users.length,
      emails: users.map((u) => maskEmail(u.email)),
      countries: [...new Set(users.map((u) => u.signup_country ?? '?'))],
      firstReg: users[0]?.created_at ?? '',
      lastReg:  users[users.length - 1]?.created_at ?? '',
    }))
    .sort((a, b) => b.count - a.count)

  if (groups.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-4">
        Совпадающих IP при регистрации не найдено
      </p>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-amber-200 overflow-x-auto">
      <table className="w-full text-sm min-w-[700px]">
        <thead>
          <tr className="border-b border-amber-100 bg-amber-50">
            <th className="text-left px-4 py-3 text-xs font-semibold text-amber-700 uppercase tracking-wide">IP</th>
            <th className="text-center px-4 py-3 text-xs font-semibold text-amber-700 uppercase tracking-wide">Аккаунтов</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-amber-700 uppercase tracking-wide">Email (маск.)</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-amber-700 uppercase tracking-wide">Страна</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-amber-700 uppercase tracking-wide">Первая рег.</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-amber-700 uppercase tracking-wide">Последняя рег.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {groups.map((g) => (
            <tr key={g.ip} className="hover:bg-amber-50 transition-colors">
              <td className="px-4 py-3 font-mono text-xs text-gray-700">{g.ip}</td>
              <td className="px-4 py-3 text-center font-semibold text-red-600">{g.count}</td>
              <td className="px-4 py-3 text-xs text-gray-600 max-w-[260px]">
                {g.emails.join(', ')}
              </td>
              <td className="px-4 py-3 text-xs text-gray-500">{g.countries.join(', ')}</td>
              <td className="px-4 py-3 text-right text-xs text-gray-400">{fmtDateShort(g.firstReg)}</td>
              <td className="px-4 py-3 text-right text-xs text-gray-400">{fmtDateShort(g.lastReg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default async function AdminUsersPage({ searchParams }: Props) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email || !ADMIN_EMAILS.includes(user.email)) redirect('/dashboard')

  const { q = '', plan = '' } = await searchParams

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Пользователи</h1>
        <p className="text-gray-500 text-sm mt-1">Управление аккаунтами, балансами и подписками</p>
      </div>
      <Suspense fallback={<div className="text-sm text-gray-400 py-8 text-center">Загрузка данных...</div>}>
        <UsersList q={q} plan={plan} />
      </Suspense>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Совпадающие IP при регистрации</h2>
        <p className="text-xs text-gray-400 mb-3">
          Группировка по signup_ip, где число аккаунтов &gt; 1. Признак возможной множественной регистрации.
        </p>
        <Suspense fallback={<div className="text-sm text-gray-400 py-4 text-center">Анализ IP...</div>}>
          <DuplicateIPs />
        </Suspense>
      </div>
    </div>
  )
}
