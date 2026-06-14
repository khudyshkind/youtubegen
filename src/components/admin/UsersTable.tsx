'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { Plan } from '@/lib/types'

interface UserRow {
  id: string
  email: string
  full_name: string | null
  plan: Plan
  credits: number
  referral_code: string | null
  referral_count: number
  created_at: string
  projectCount: number
  lastActivity: string | null
  subscriptionStatus: string | null
  nextBilledAt: string | null
  totalSpent: number
  spentCurrency: string
}

interface Props {
  users: UserRow[]
  total: number
  hasServiceKey?: boolean
  queryError?: string
}

const PLANS: Plan[] = ['free', 'starter', 'pro', 'agency']

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function fmtMoney(amount: number, currency = 'USD') {
  if (amount === 0) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

const subStatusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  canceled: 'bg-gray-100 text-gray-500',
  past_due: 'bg-red-100 text-red-600',
  paused: 'bg-yellow-100 text-yellow-700',
  trialing: 'bg-blue-100 text-blue-700',
}

export default function UsersTable({ users, total, hasServiceKey, queryError }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const [editCreditsUser, setEditCreditsUser] = useState<UserRow | null>(null)
  const [editPlanUser, setEditPlanUser] = useState<UserRow | null>(null)

  const [creditAmount, setCreditAmount] = useState('')
  const [creditReason, setCreditReason] = useState('')
  const [creditLoading, setCreditLoading] = useState(false)
  const [creditError, setCreditError] = useState('')

  const [newPlan, setNewPlan] = useState<Plan>('free')
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState('')

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }

  async function handleSaveCredits() {
    if (!editCreditsUser) return
    const amount = parseInt(creditAmount)
    if (isNaN(amount)) { setCreditError('Введите число'); return }
    setCreditLoading(true); setCreditError('')
    try {
      const res = await fetch(`/api/admin/users/${editCreditsUser.id}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, reason: creditReason || 'admin_adjustment' }),
      })
      const json = await res.json()
      if (!json.ok) { setCreditError(json.error ?? 'Ошибка'); return }
      setEditCreditsUser(null); setCreditAmount(''); setCreditReason('')
      router.refresh()
    } catch { setCreditError('Ошибка соединения') }
    finally { setCreditLoading(false) }
  }

  async function handleSavePlan() {
    if (!editPlanUser) return
    setPlanLoading(true); setPlanError('')
    try {
      const res = await fetch(`/api/admin/users/${editPlanUser.id}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: newPlan }),
      })
      const json = await res.json()
      if (!json.ok) { setPlanError(json.error ?? 'Ошибка'); return }
      setEditPlanUser(null)
      router.refresh()
    } catch { setPlanError('Ошибка соединения') }
    finally { setPlanLoading(false) }
  }

  function openCredits(u: UserRow) { setEditCreditsUser(u); setCreditAmount(''); setCreditReason(''); setCreditError('') }
  function openPlan(u: UserRow)    { setEditPlanUser(u); setNewPlan(u.plan); setPlanError('') }

  const planColors: Record<Plan, string> = {
    free: 'bg-gray-100 text-gray-600',
    starter: 'bg-blue-100 text-blue-700',
    pro: 'bg-purple-100 text-purple-700',
    agency: 'bg-amber-100 text-amber-700',
  }

  return (
    <>
      {!hasServiceKey && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-2">
          ⚠️ <strong>SUPABASE_SERVICE_ROLE_KEY</strong> не задан — данные не загружены.
        </div>
      )}
      {queryError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 mb-2">
          ⚠️ Ошибка запроса: {queryError}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          defaultValue={searchParams.get('q') ?? ''}
          placeholder="Поиск по email..."
          className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-300 w-64"
          onChange={(e) => updateParam('q', e.target.value)}
        />
        <select
          value={searchParams.get('plan') ?? ''}
          onChange={(e) => updateParam('plan', e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-300 bg-white"
        >
          <option value="">Все тарифы</option>
          {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="ml-auto text-sm text-gray-500 self-center">{total} пользователей</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Тариф</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Кредиты</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Проекты</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Подписка</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Следующий платёж</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Потрачено $</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Реф.</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Дата</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-800 truncate max-w-[180px]">{u.email}</p>
                  {u.full_name && <p className="text-xs text-gray-400 truncate">{u.full_name}</p>}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${planColors[u.plan]}`}>
                    {u.plan}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-700">{u.credits}</td>
                <td className="px-4 py-3 text-right text-gray-600">{u.projectCount}</td>
                <td className="px-4 py-3">
                  {u.subscriptionStatus ? (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${subStatusColors[u.subscriptionStatus] ?? 'bg-gray-100 text-gray-500'}`}>
                      {u.subscriptionStatus}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-xs text-gray-500">
                  {fmtDate(u.nextBilledAt)}
                </td>
                <td className="px-4 py-3 text-right text-xs font-medium text-green-700">
                  {fmtMoney(u.totalSpent, u.spentCurrency)}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="font-mono text-xs text-gray-400">{u.referral_code ?? '—'}</span>
                  {u.referral_count > 0 && (
                    <span className="ml-1 text-xs text-violet-600 font-semibold">+{u.referral_count}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-xs text-gray-400">{fmtDate(u.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => openCredits(u)}
                      className="px-2 py-1 text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg transition-colors whitespace-nowrap">
                      Кредиты
                    </button>
                    <button onClick={() => openPlan(u)}
                      className="px-2 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition-colors whitespace-nowrap">
                      Тариф
                    </button>
                    <a href={`/admin/view?user_id=${u.id}`}
                      className="px-2 py-1 text-xs bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-lg transition-colors whitespace-nowrap">
                      Просмотр
                    </a>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={10} className="px-6 py-10 text-center text-sm text-gray-400">
                  {hasServiceKey === false
                    ? 'Данные недоступны — добавьте SUPABASE_SERVICE_ROLE_KEY в Vercel env vars'
                    : 'Пользователи не найдены'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Credits Modal */}
      {editCreditsUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Изменить кредиты</h3>
            <p className="text-sm text-gray-500 mb-4">
              {editCreditsUser.email} · сейчас: <strong>{editCreditsUser.credits} кр.</strong>
            </p>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Сумма (+ добавить / − вычесть)
                </label>
                <input type="number" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)}
                  placeholder="+50 или -10"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Причина</label>
                <input type="text" value={creditReason} onChange={(e) => setCreditReason(e.target.value)}
                  placeholder="Например: бонус за отзыв"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" />
              </div>
              {creditError && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{creditError}</p>}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditCreditsUser(null)}
                className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
                Отмена
              </button>
              <button onClick={handleSaveCredits} disabled={creditLoading}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold rounded-xl text-sm">
                {creditLoading ? 'Сохранение...' : 'Применить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Plan Modal */}
      {editPlanUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Изменить тариф</h3>
            <p className="text-sm text-gray-500 mb-4">
              {editPlanUser.email} · сейчас: <strong>{editPlanUser.plan}</strong>
            </p>
            <div className="flex flex-col gap-2">
              {PLANS.map((p) => (
                <label key={p} className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-colors ${
                  newPlan === p ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input type="radio" name="plan" value={p} checked={newPlan === p}
                    onChange={() => setNewPlan(p)} className="accent-blue-500" />
                  <span className="text-sm font-medium text-gray-800 capitalize">{p}</span>
                </label>
              ))}
            </div>
            {planError && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg mt-3">{planError}</p>}
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditPlanUser(null)}
                className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
                Отмена
              </button>
              <button onClick={handleSavePlan} disabled={planLoading}
                className="flex-1 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-semibold rounded-xl text-sm">
                {planLoading ? 'Сохранение...' : 'Применить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
