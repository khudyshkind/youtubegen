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
  const apiKey = process.env.PADDLE_API_KEY?.replace(/^﻿/, '').trim()
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
    return {
      ...p,
      projectCount: pcMap[p.id] ?? 0,
      lastActivity: null as string | null,
      subscriptionStatus: paddleInfo?.status ?? null,
      nextBilledAt: paddleInfo?.nextBilledAt ?? null,
      totalSpent: paddleInfo?.totalSpent ?? 0,
      spentCurrency: paddleInfo?.currency ?? 'USD',
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
    </div>
  )
}
